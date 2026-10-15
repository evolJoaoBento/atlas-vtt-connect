import { vi } from 'vitest';
import fixture from './realStockLighting.json';
import { store } from './fakeStockAtlas';
import type { LightingView, StockLightingDeps } from '../../src/connect/stockLighting/stockLighting';

/** What was read from a real Atlas VTT 0.8.0 lit scene: its sight, ambient light, light reaches and token perception. */
export const REAL = fixture;

/** Atlas's lighting controller as it is: the hook is a method of the prototype, and the view's callbacks reach it through `this`. */
export class FakeController {
  sightChanges = 0;
  renderer: Record<string, unknown>;
  constructor(public parts: { enabled: boolean; current: boolean; sight: unknown; ambient: unknown; reaches: unknown }) {
    this.renderer = {
      isEnabled: () => this.parts.enabled,
      sightIsCurrent: () => this.parts.current,
      currentSight: () => this.parts.sight,
      ambientLight: () => this.parts.ambient,
      lightReaches: () => this.parts.reaches,
    };
  }
  playerSight(): unknown {
    return 'sight';
  }
  onSightChange(): void {
    this.sightChanges++;
  }
}

export interface LitOptions {
  /** The scene as saved. */
  savedLit?: boolean;
  controller?: FakeController | null;
  perception?: Record<string, string>;
  map?: { width: number; height: number };
  /** The saved explored mask and the engine's memory (none: the line-of-sight fallback). */
  explored?: { mask: string | null; edits?: number; memory: boolean | { ready?: boolean; contextLost?: boolean }; keeps?: boolean };
  decode?: (dataUrl: string) => Promise<{ width: number; height: number; coverage: Uint8Array }>;
  now?: () => number;
}

/** A map view whose lighting is the real scene's, with the controller, token renderer and store a stock Atlas gives it. */
export function litView(options: LitOptions = {}) {
  const savedLit = options.savedLit ?? true;
  const controller = options.controller === undefined
    ? new FakeController({ enabled: savedLit, current: true, sight: structuredClone(REAL.sight), ambient: structuredClone(REAL.ambient), reaches: structuredClone(REAL.reaches) })
    : options.controller;
  const tokens = Object.fromEntries(Object.keys(REAL.tokens).map((id) => [id, { id }]));
  if (controller && options.explored?.memory) {
    const memory = options.explored.memory === true ? {} : options.explored.memory;
    // The host's inner view: the engine's, with the explored memory; the fallback has none.
    controller.renderer.view = { memory: { ready: memory.ready ?? true, texture: {}, contextLost: memory.contextLost ?? false } };
  }
  const exploredOn = options.explored?.keeps === false ? { exploredMemory: false } : {};
  const scene = store({
    mapLoaded: true, isMapLoading: false, mapPath: 'maps/one.atlasmap', exploredMask: options.explored?.mask ?? null, exploredEdits: options.explored?.edits ?? 0,
    lighting: { enabled: savedLit, ...exploredOn }, objects: { tokens, fog: {}, walls: {}, lights: {} },
  } as never);
  const perception: Record<string, string> = options.perception ?? REAL.perception;
  const view = {
    viewId: 'view-a',
    atlasStore: scene,
    renderer: {
      lightingFeature: { controller: controller ?? undefined },
      getTokenRenderer: () => ({ playerFramePerception: () => (id: string) => perception[id] }),
    },
  };
  const map = options.map ?? { width: REAL.map.width, height: REAL.map.height };
  let flag: boolean | null = true;
  let open = true;
  const added: Array<() => void> = [];
  const deps: StockLightingDeps = {
    view: (viewId) => (open && viewId === 'view-a' ? (view as unknown as LightingView) : null),
    mapSize: () => map,
    dynamicLighting: () => flag,
    add: (dispose) => { added.push(dispose); return () => { const at = added.indexOf(dispose); if (at >= 0) added.splice(at, 1); dispose(); }; },
    ...(options.decode || options.now ? { explored: { ...(options.decode && { decode: options.decode }), ...(options.now && { now: options.now }) } } : {}),
  };
  return {
    view, scene, controller, deps, added,
    setFlag: (value: boolean | null) => { flag = value; },
    close: () => { open = false; },
    unload: () => { for (const dispose of added.splice(0)) dispose(); },
    tick: (ms: number) => vi.advanceTimersByTime(ms),
  };
}
