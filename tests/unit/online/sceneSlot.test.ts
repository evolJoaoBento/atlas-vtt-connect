import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { SceneSlot, type SlotHost } from '../../../src/app/online/scene/SceneSlot';
import type { PresentationLighting } from '../../../src/app/online/scene/sceneLighting';
import { SCENE_TICK_MS } from '../../../src/app/online/scene/SceneHub';
import { character, tabScene } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** One slot over a stub view: `current` is what the source attributes to the slot (null: another tab's, or loading). */
function stubSlot(): { slot: SceneSlot; sent: Array<[string, ControlMessage]>; set(snapshot: SceneSnapshot | null): void; lightings: string[]; audience: string[] } {
  let current: SceneSnapshot | null = { ...tabScene('a'), viewId: 'gm' };
  const listeners = new Set<(snapshot: SceneSnapshot) => void>();
  const sent: Array<[string, ControlMessage]> = [];
  const lightings: string[] = [];
  const audience = ['anna'];
  const lighting: PresentationLighting = { frame: () => null, restart: () => undefined, dispose: () => { lightings.push('disposed'); } };
  const host: SlotHost<SceneSlot> = {
    options: {
      session: { use: () => () => undefined, send: () => undefined, getPlayers: () => [] },
      presented: { current: () => null, isHeld: () => false, subscribe: () => () => undefined },
      settings: { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }), onChange: () => () => undefined },
      assets: { idFor: () => null, onChange: () => () => undefined },
      notify: () => undefined,
    },
    lighting: { open: () => { lightings.push('opened'); return lighting; } },
    rules: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }),
    audience: () => audience,
    sendSequenced: (playerId, message) => { sent.push([playerId, message as ControlMessage]); },
    send: (playerId, message) => { sent.push([playerId, message]); },
    projected: () => undefined,
  };
  const slot = new SceneSlot({ viewId: 'gm', tabId: 'a' }, 'scene-a', {
    snapshot: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  }, host);
  return {
    slot, sent, lightings, audience,
    set: (snapshot) => {
      current = snapshot;
      if (snapshot) for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

describe('SceneSlot', () => {
  it('a waiting slot sends nothing and opens no lighting until it goes live', () => {
    const { slot, sent, lightings } = stubSlot();
    slot.park();
    expect(slot.state).toBe('waiting');
    expect(sent).toEqual([]);
    expect(lightings).toEqual([]);
    slot.goLive();
    expect(slot.state).toBe('live');
    expect(sent.map(([, message]) => message.type)).toEqual(['scene-snapshot']);
    expect(lightings).toEqual(['opened']);
  });

  it('parks keeping what its players have, and drops its lighting and fog coverage', () => {
    const { slot, sent, lightings } = stubSlot();
    slot.goLive();
    const had = slot.lastSent;
    slot.park();
    expect(slot.lastSent).toBe(had);
    expect(slot.hasFogCoverage()).toBe(false);
    expect(lightings).toEqual(['opened', 'disposed']);
    expect(sent.at(-1)).toEqual(['anna', { v: 1, type: 'scene-state', sceneId: 'scene-a', paused: true }]);
  });

  it('reads its source anew at every tick, and projects nothing the source does not attribute to it', async () => {
    const { slot, sent, set } = stubSlot();
    slot.goLive();
    const before = sent.length;
    // The store now holds another tab's scene: the source attributes nothing to this slot.
    set({ ...tabScene('a', { strangerlord: character('strangerlord', 500) }), viewId: 'gm', tabId: null });
    set(null);
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS * 3);
    expect(sent.slice(before)).toEqual([]);
    expect(JSON.stringify(slot.lastSent)).not.toContain('strangerlord');
  });

  it('sends nothing once disposed', async () => {
    const { slot, sent, set } = stubSlot();
    slot.goLive();
    const before = sent.length;
    slot.dispose();
    set({ ...tabScene('a', { latecomer: character('latecomer', 500) }), viewId: 'gm' });
    slot.rulesChanged();
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS * 3);
    expect(slot.disposed).toBe(true);
    expect(sent.slice(before)).toEqual([]);
  });
});
