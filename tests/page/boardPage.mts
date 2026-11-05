// tests/page/boardPage.mts
/**
 * The join page's 3D board, for a phone browser test (run.mjs): the page's scene switch with Tabletop's player board
 * (the vendored chunk, as the page loads it) and a fake scene, without a GM: the test plays the session's part.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SceneSwitch } from '../../online-client/sceneSwitch.mts';
import { BoardSceneView } from '../../src/app/online/obsidian/BoardSceneView';
import type { SceneViewport } from '../../src/app/online/obsidian/sceneViewport';
import type { BoardExtras } from '../../src/app/online/scene/boardTypes';
import type { PlayerScene } from '../../src/app/online/scene/sceneTypes';

const MAP = 'M'.repeat(43);
const ART = 'A'.repeat(43);
const GLB = 'G'.repeat(43);

function drawn(width: number, height: number, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#000';
  for (let x = 0; x < width; x += 70) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  for (let y = 0; y < height; y += 70) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
  return canvas.toDataURL('image/png');
}

async function heroGlb(): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
  body.position.y = 0.6;
  root.add(body);
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true }));
}

const scene = {
  sceneId: 's1',
  map: { asset: MAP, width: 1400, height: 1000, cellSize: 70 },
  grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.4, lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null },
  tokens: {
    mine: { x: 385, y: 385, size: 1, rotation: 0, layer: 0, image: ART, ring: '#2266ff', conditions: [], name: 'Anna', hp: { current: 8, max: 10 }, stress: null, mini: { asset: GLB, scale: 1, turn: 0 } },
    theirs: { x: 665, y: 385, size: 1, rotation: 0, layer: 0, image: ART, ring: '#ff2222', conditions: [], name: 'Goblin', hp: null, stress: null },
  },
  fog: {}, texts: {}, drawings: {}, widgets: [], initiative: null,
  measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true, coneAngle: 53 },
  pins: [],
} as unknown as PlayerScene;

const extras = {
  sceneId: 's1',
  walls: [
    { id: 'w1', type: 'solid', p1: { x: 280, y: 280 }, p2: { x: 840, y: 280 }, height: null, material: null },
    { id: 'w2', type: 'solid', p1: { x: 840, y: 280 }, p2: { x: 840, y: 700 }, height: null, material: null },
  ],
  lights: [], props: [], materials: [],
  ambient: 0.8, fogHeight: 1, wallThickness: 0.12,
  lighting: { enabled: false, ambient: 0.8, ambientColor: null },
} as unknown as BoardExtras;

/** A 2D map that does nothing: the page's own is tested elsewhere; here it only stands where the board is not. */
function quietMap(): SceneViewport {
  const nothing = (): void => undefined;
  return {
    setScene: nothing, setSheets: nothing, setGmCamera: nothing, setControlled: nothing, setConnected: nothing, moveRefused: nothing,
    setPaused: nothing, selectTool: nothing, followGm: nothing, fitMap: nothing, selectTemplateShape: nothing, clearOwnTemplates: nothing,
    selectShape: nothing, selectLaserColor: nothing, selectLaserSize: nothing,
    toolState: () => ({ tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, laserColor: '#ff0059', laserSize: 16 }) as ReturnType<SceneViewport['toolState']>,
    setPlayers: nothing, receiveNote: nothing, receiveTemplates: nothing, receivePing: nothing, receiveLaser: nothing, refresh: nothing, measure: nothing, dispose: nothing,
  };
}

async function main(): Promise<void> {
  const images = new Map<string, string>([[MAP, drawn(1400, 1000, '#9c8a6e')], [ART, drawn(64, 64, '#3a8a3a')]]);
  const glb = await heroGlb();
  const record = { requests: [] as boolean[], moves: [] as unknown[] };
  const el = (id: string): HTMLElement => document.getElementById(id)!;
  let board: BoardSceneView | null = null;
  const view = new SceneSwitch({
    makeMap: quietMap,
    makeBoard: (factory, parent) => {
      board = new BoardSceneView({
        parent, factory,
        image: () => null,
        imageUrl: (id) => images.get(id) ?? null,
        model: (id) => (id === GLB ? glb : null),
        sendMove: (tokenId, x, y) => { record.moves.push([tokenId, x, y]); return true; },
        sendLaser: () => true, sendPing: () => true, sendTemplate: () => true,
        onToolsChange: () => undefined,
        hoverCard: el('hover-card'), statblockPreview: el('statblock-preview'), initiative: el('initiative-panel'), turnNotice: el('turn-notice'),
        handout: { panel: el('handout'), title: el('handout-title'), canvas: el('handout-canvas') as HTMLCanvasElement, status: el('handout-status'), closeButton: el('handout-close') as HTMLButtonElement, openButton: el('handout-button') as HTMLButtonElement },
        note: { panel: el('note-panel'), title: el('note-title'), body: el('note-body'), closeButton: el('note-close') as HTMLButtonElement },
        doc: document,
      });
      return board;
    },
    loadBoard: () => import('../../online-client/tabletopBoard.mts').then((chunk) => chunk.webPlayerBoard()),
    canvas: el('map'), boardEl: el('board-3d'),
    dimensionButton: el('dimension-button') as HTMLButtonElement, eyeButton: el('eye-button') as HTMLButtonElement, eyeMenu: el('eye-menu'), viewButtons: el('view-buttons'),
    requestBoard: (on) => { record.requests.push(on); return true; },
    onViewChange: () => undefined,
    tokenName: (id) => (scene.tokens as Record<string, { name?: string }>)[id]?.name ?? 'Token',
    onError: (message, error) => { (window as unknown as { boardError: string }).boardError = `${message} ${String(error)}`; },
  });
  view.setPlayers(['me'], 'me');
  view.setConnected(true);
  view.setScene(scene);
  view.setControlled(['mine']);
  // The internals the test reads: the board's camera.
  const inner = (): { view: THREE.PerspectiveCamera; camera: { pose: { distance: number } }; canvas: HTMLCanvasElement } | null => {
    const handle = (board as unknown as { board?: { board?: unknown } } | null)?.board?.board as { view: THREE.PerspectiveCamera; camera: { pose: { distance: number } }; canvas: HTMLCanvasElement } | undefined;
    return handle ?? null;
  };
  Object.assign(window, { pageTest: { view, record, inner, extras, scene, ready: true, offer: () => { view.boardOffer(true); }, extrasNow: () => view.boardExtras(extras) } });
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error); console.error(error); });
