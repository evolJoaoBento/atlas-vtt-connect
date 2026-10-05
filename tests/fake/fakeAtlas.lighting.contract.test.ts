import type { PlayerVisibility } from '@atlas-vtt/api-types';
import { describe, expect, it, vi } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const READY: PlayerVisibility = {
  status: 'ready',
  tokens: { hero: 'seen', goblin: 'sensed' },
  darkness: { cellSize: 350, cols: 2, rows: 2, shown: Uint8Array.of(1, 0, 0, 1) },
  showsExplored: false,
};

/** A fake Atlas with the view `v1` open and its map loaded; `lighting` is the extension's namespace. */
function litAtlas() {
  const atlas = new FakeAtlas({ capabilities: ['views', 'lighting'] });
  atlas.views.open('v1');
  atlas.views.update('v1', { mapPath: 'maps/a.atlasmap', loaded: true, mapSize: { width: 700, height: 700 }, lighting: { enabled: true, ambient: 0 } });
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  return { atlas, lighting: extension.lighting };
}

describe('FakeAtlas follows the lighting contract cases', () => {
  it('C-light-1: unlit, pending and ready, as the window shows them; a view not set yet is pending', () => {
    const { atlas, lighting } = litAtlas();
    expect(lighting.playerVisibility('v1').status).toBe('pending');
    atlas.lighting.setVisibility('v1', { status: 'unlit' });
    expect(lighting.playerVisibility('v1')).toEqual({ status: 'unlit' });
    atlas.lighting.setVisibility('v1', READY);
    const ready = lighting.playerVisibility('v1');
    expect(ready).toEqual(READY);
    atlas.lighting.setVisibility('v1', { status: 'pending' });
    expect(lighting.playerVisibility('v1')).toEqual({ status: 'pending' });
  });

  it('C-light-1: a map load or tab switch on a lit scene is pending until the new map is loaded, never unlit', () => {
    const { atlas, lighting } = litAtlas();
    atlas.lighting.setVisibility('v1', { status: 'unlit' });
    atlas.views.update('v1', { loaded: false });
    expect(lighting.playerVisibility('v1').status).toBe('pending');
    atlas.views.update('v1', { loaded: true });
    expect(lighting.playerVisibility('v1').status).toBe('unlit');
  });

  it('C-light-1: hands out frozen answers whose darkness no caller can change for another', () => {
    const { atlas, lighting } = litAtlas();
    atlas.lighting.setVisibility('v1', READY);
    const first = lighting.playerVisibility('v1');
    if (first.status !== 'ready') throw new Error('not ready');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tokens)).toBe(true);
    expect(Object.isFrozen(first.darkness)).toBe(true);
    first.darkness.shown.fill(1);
    const second = lighting.playerVisibility('v1');
    expect(second.status === 'ready' && [...second.darkness.shown]).toEqual([1, 0, 0, 1]);
  });

  it('C-light-2: watch fires when what the window shows changes and when the map is marked loaded; its disposer stops it', () => {
    const { atlas, lighting } = litAtlas();
    const listener = vi.fn();
    const stop = lighting.watch('v1', listener);
    atlas.lighting.setVisibility('v1', READY);
    expect(listener).toHaveBeenCalledTimes(1);
    atlas.views.update('v1', { loaded: false });
    atlas.views.update('v1', { loaded: true });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    atlas.lighting.setVisibility('v1', { status: 'unlit' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(atlas.lighting.watching('v1')).toBe(0);
  });

  it('C-light-2: watch runs guarded and ends with the view', () => {
    const { atlas, lighting } = litAtlas();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    lighting.watch('v1', () => { throw new Error('boom'); });
    lighting.watch('v1', after);
    atlas.lighting.setVisibility('v1', READY);
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    atlas.views.close('v1');
    expect(atlas.lighting.watching('v1')).toBe(0);
    error.mockRestore();
  });

  it('C-light-3: an unknown view is pending, never unlit, and its watch does nothing', () => {
    const { atlas, lighting } = litAtlas();
    expect(lighting.playerVisibility('nope')).toEqual({ status: 'pending' });
    const listener = vi.fn();
    const stop = lighting.watch('nope', listener);
    atlas.lighting.setVisibility('nope', { status: 'unlit' });
    expect(lighting.playerVisibility('nope')).toEqual({ status: 'pending' });
    expect(listener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    atlas.lighting.setVisibility('v1', { status: 'unlit' });
    atlas.views.close('v1');
    expect(lighting.playerVisibility('v1')).toEqual({ status: 'pending' });
  });
});
