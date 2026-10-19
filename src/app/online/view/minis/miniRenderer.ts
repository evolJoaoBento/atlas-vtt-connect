/**
 * Draws the minis of one frame (the Tabletop extension's 3D GLBs on tokens) with three.js, top-down: an orthographic
 * camera looks straight down on the world area being drawn, so a mini stands where its token is in world units. Each
 * mini is sized to its token's footprint and turned with it, leans away from the way it moves and springs back, plays
 * its GLB's idle clip (a walk or run clip while it moves) and wobbles when asked to. Loaded on demand (`miniLayer.ts`),
 * so a scene without minis never loads three.js. Shared with the web page.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { WorldRect } from '../camera';

/** Share of the token's diameter the mini's footprint fills at scale 1. */
const FILL = 0.9;
/** Lean per screen pixel per second of movement, and the most it leans. */
const LEAN_PER_SPEED = 0.0009;
const MAX_LEAN = THREE.MathUtils.degToRad(32);
const SPRING_K = 140;
const SPRING_D = 16;
/** How much bigger a mini looks while it is carried. */
const LIFT = 0.08;
/** Below this speed (screen px/s) a mini stands still. */
const MOVING_SPEED = 25;
const SHAKE_SECONDS = 0.9;
/** The longest frame a spring steps by, so a tab that was hidden does not fling a mini. */
const LONGEST_STEP_S = 1 / 15;
/** The largest side of the drawing buffer, in device pixels. */
const MAX_BUFFER_PX = 4096;
const CAMERA_HEIGHT = 100_000;

export interface MiniFrameEntry {
  id: string;
  asset: string;
  /** Where the token is drawn this frame (gliding or dragged), in world units. */
  x: number;
  y: number;
  /** The token's diameter in world units. */
  size: number;
  /** The token's rotation and the mini's own turn, in degrees. */
  rotation: number;
  turn: number;
  scale: number;
}

interface LoadedModel {
  scene: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  footprint: number;
}

interface Spring { value: number; velocity: number }

interface Instance {
  readonly asset: string;
  readonly anchor: THREE.Group;
  readonly lean: THREE.Group;
  readonly yaw: THREE.Group;
  readonly model: LoadedModel;
  readonly mixer: THREE.AnimationMixer | null;
  readonly idle: THREE.AnimationAction | null;
  readonly move: THREE.AnimationAction | null;
  readonly materials: THREE.Material[];
  moving: boolean;
  last: { x: number; y: number } | null;
  leanX: Spring;
  leanZ: Spring;
  lift: Spring;
  shakeAt: number | null;
}

function step(spring: Spring, target: number, dt: number): void {
  spring.velocity += (SPRING_K * (target - spring.value) - SPRING_D * spring.velocity) * dt;
  spring.value += spring.velocity * dt;
}

const settled = (spring: Spring): boolean => Math.abs(spring.value) < 1e-3 && Math.abs(spring.velocity) < 1e-3;
const findClip = (clips: readonly THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null => clips.find((clip) => pattern.test(clip.name)) ?? null;

/** Reads a GLB, standing it on y = 0 on its origin (or its footprint's centre when the origin lies outside it). */
async function parseModel(bytes: ArrayBuffer): Promise<LoadedModel> {
  // Only what the GLB holds itself: a file it links to elsewhere is never fetched (no request leaves the player's device).
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : 'data:,'));
  const loader = new GLTFLoader(manager);
  const gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(bytes.slice(0), '', resolve, reject));
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  if (box.isEmpty()) throw new Error('The mini has no visible geometry.');
  const size = box.getSize(new THREE.Vector3());
  const origin = new THREE.Vector3().setFromMatrixPosition(model.matrixWorld);
  const onOrigin = origin.x >= box.min.x && origin.x <= box.max.x && origin.z >= box.min.z && origin.z <= box.max.z;
  const stand = onOrigin ? origin : box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(stand.x, box.min.y, stand.z));
  const root = new THREE.Group();
  root.add(model);
  return { scene: root, animations: gltf.animations, footprint: Math.max(size.x, size.z, 1e-6) };
}

export class MiniRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, CAMERA_HEIGHT * 2);
  private readonly models = new Map<string, Promise<LoadedModel | null>>();
  private readonly ready = new Map<string, LoadedModel | null>();
  private readonly instances = new Map<string, Instance>();
  private time = 0;
  private busy = false;

  /** `canvas`: a bare canvas of the view's document to draw on; `loaded`: a model finished reading, so the view draws again. */
  constructor(canvas: HTMLCanvasElement, private readonly loaded: () => void) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    // World x is screen right and world y is screen down (+z here): the camera looks down with -z as its up.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-0.6, 1, -0.8);
    this.scene.add(sun);
  }

  /** Wobbles a token's mini, if it has one. */
  shake(id: string): void {
    const instance = this.instances.get(id);
    if (instance) instance.shakeAt = this.time;
  }

  /** Whether something moves on its own (a clip, a lean settling, a wobble, a model loading): the view keeps drawing. */
  animating(): boolean {
    if (this.busy) return true;
    for (const instance of this.instances.values()) {
      if (instance.mixer || instance.shakeAt !== null || instance.moving) return true;
      if (!settled(instance.leanX) || !settled(instance.leanZ) || !settled(instance.lift)) return true;
    }
    return false;
  }

  /**
   * Draws the minis of `entries` over the world area `area`, `pixel` world units to a device pixel, and returns the
   * picture to lay over that area; null when there is nothing to show yet.
   */
  frame(entries: readonly MiniFrameEntry[], models: (asset: string) => ArrayBuffer | null, area: WorldRect, pixel: number, zoom: number, elapsedMs: number): HTMLCanvasElement | null {
    const dt = Math.min(LONGEST_STEP_S, Math.max(0, elapsedMs / 1000));
    this.time += dt;
    const wanted = new Set<string>();
    let shown = 0;
    this.busy = false;
    for (const entry of entries) {
      wanted.add(entry.id);
      const instance = this.instanceFor(entry, models);
      if (!instance) continue;
      this.pose(instance, entry, dt, zoom);
      shown++;
    }
    for (const id of [...this.instances.keys()]) if (!wanted.has(id)) this.drop(id);
    if (shown === 0 || !(area.width > 0) || !(area.height > 0)) return null;
    const scale = Math.min(1 / pixel, MAX_BUFFER_PX / area.width, MAX_BUFFER_PX / area.height);
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(area.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) this.renderer.setSize(width, height, false);
    this.camera.left = area.x;
    this.camera.right = area.x + area.width;
    this.camera.top = -area.y;
    this.camera.bottom = -(area.y + area.height);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  private instanceFor(entry: MiniFrameEntry, models: (asset: string) => ArrayBuffer | null): Instance | null {
    const existing = this.instances.get(entry.id);
    if (existing?.asset === entry.asset) return existing;
    if (existing) this.drop(entry.id);
    const model = this.model(entry.asset, models);
    if (!model) return null;
    const anchor = new THREE.Group();
    const lean = new THREE.Group();
    const yaw = new THREE.Group();
    anchor.add(lean);
    lean.add(yaw);
    const copy = cloneSkinned(model.scene);
    const materials: THREE.Material[] = [];
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => material.clone());
      materials.push(...own);
      mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
    });
    yaw.add(copy);
    this.scene.add(anchor);
    let mixer: THREE.AnimationMixer | null = null;
    let idle: THREE.AnimationAction | null = null;
    let move: THREE.AnimationAction | null = null;
    if (model.animations.length > 0) {
      mixer = new THREE.AnimationMixer(copy);
      const moveClip = findClip(model.animations, /walk|run|move|jog/i);
      const idleClip = findClip(model.animations, /idle|stand|breath/i) ?? (moveClip ? null : model.animations[0]!);
      idle = idleClip ? mixer.clipAction(idleClip) : null;
      move = moveClip ? mixer.clipAction(moveClip) : null;
      idle?.play();
    }
    const instance: Instance = {
      asset: entry.asset, anchor, lean, yaw, model, mixer, idle, move, materials, moving: false, last: null,
      leanX: { value: 0, velocity: 0 }, leanZ: { value: 0, velocity: 0 }, lift: { value: 0, velocity: 0 }, shakeAt: null,
    };
    this.instances.set(entry.id, instance);
    return instance;
  }

  /** The model for an asset once read; starts reading it when its bytes are here. */
  private model(asset: string, models: (asset: string) => ArrayBuffer | null): LoadedModel | null {
    if (this.ready.has(asset)) return this.ready.get(asset) ?? null;
    if (!this.models.has(asset)) {
      const bytes = models(asset);
      if (!bytes) return null;
      const reading = parseModel(bytes).catch((error: unknown) => {
        console.warn('[Atlas online] A mini could not be read:', error);
        return null;
      });
      this.models.set(asset, reading);
      void reading.then((model) => {
        this.ready.set(asset, model);
        this.loaded();
      });
    }
    this.busy = true;
    return null;
  }

  private pose(instance: Instance, entry: MiniFrameEntry, dt: number, zoom: number): void {
    instance.anchor.position.set(entry.x, 0, entry.y);
    let vx = 0;
    let vz = 0;
    if (instance.last && dt > 0) {
      vx = ((entry.x - instance.last.x) * zoom) / dt;
      vz = ((entry.y - instance.last.y) * zoom) / dt;
    }
    instance.last = { x: entry.x, y: entry.y };
    const speed = Math.hypot(vx, vz);
    const angle = Math.min(MAX_LEAN, speed * LEAN_PER_SPEED);
    // About the axis across the movement, so the top trails behind.
    step(instance.leanX, speed > 1 ? (-vz / speed) * angle : 0, dt);
    step(instance.leanZ, speed > 1 ? (vx / speed) * angle : 0, dt);
    const moving = speed > MOVING_SPEED;
    step(instance.lift, moving ? LIFT : 0, dt);
    const tilt = Math.hypot(instance.leanX.value, instance.leanZ.value);
    if (tilt > 1e-4) instance.lean.quaternion.setFromAxisAngle(new THREE.Vector3(instance.leanX.value / tilt, 0, instance.leanZ.value / tilt), tilt);
    else instance.lean.quaternion.identity();
    let wobble = 0;
    let squash = 0;
    if (instance.shakeAt !== null) {
      const t = this.time - instance.shakeAt;
      if (t > SHAKE_SECONDS) instance.shakeAt = null;
      else {
        const fade = Math.exp(-t * 5);
        wobble = 0.45 * Math.sin(t * 32) * fade;
        squash = 0.12 * Math.sin(t * 24) * fade;
      }
    }
    // Atlas turns tokens clockwise on screen; about +y that is a negative turn.
    instance.yaw.rotation.y = -THREE.MathUtils.degToRad(entry.rotation + entry.turn) + wobble;
    const base = (entry.size * entry.scale * FILL * (1 + instance.lift.value)) / instance.model.footprint;
    instance.yaw.scale.set(base * (1 - squash / 2), base * (1 + squash), base * (1 - squash / 2));
    if (moving !== instance.moving && instance.move) {
      const [from, to] = moving ? [instance.idle, instance.move] : [instance.move, instance.idle];
      to?.reset().play();
      if (from && to) from.crossFadeTo(to, 0.25, false);
      else from?.fadeOut(0.25);
    }
    instance.moving = moving;
    instance.mixer?.update(dt);
  }

  private drop(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    this.instances.delete(id);
    instance.mixer?.stopAllAction();
    this.scene.remove(instance.anchor);
    for (const material of instance.materials) material.dispose();
  }

  dispose(): void {
    for (const id of [...this.instances.keys()]) this.drop(id);
    this.models.clear();
    this.ready.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
