import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOVES_PER_SECOND, MoveRateLimit } from '../../../src/app/online/control/TokenMoveHandler';
import { createHexLayout, nearestHexCenter, snapTokenCenter } from '@atlas-vtt/shared/grid';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { controlWorld, partyState, partyTokens, type ControlWorld } from './controlFixtures';

async function withHero(w: ControlWorld) {
  w.present();
  const a = await w.join('A');
  w.control.set('hero', a.playerId, true);
  return a;
}

/** Hides the hero in the GM's store, as the GM's own hide does: a new token record. */
function hide(w: ControlWorld, value: unknown): void {
  w.store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, hero: { ...state.objects.tokens.hero!, isHidden: value as boolean } } } }));
}

describe('token moves on the GM side', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("applies a controller's move snapped to the cell centre as one undo step, and players see it", async () => {
    const w = controlWorld();
    const a = await withHero(w);
    a.move('hero', 300, 150);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    expect(w.undoSteps()).toBe(1);
    expect(a.refusals()).toEqual([]);
    await w.tick();
    expect(a.session.scene?.tokens.hero).toMatchObject({ x: 315, y: 175 });
    w.undo();
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    w.finish();
  });

  it('refuses a move of a token the player does not control', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    a.move('ally', 300, 150);
    expect(a.refusals()).toEqual(['ally']);
    expect(w.token('ally')).toMatchObject({ x: 280, y: 140 });
    expect(w.undoSteps()).toBe(0);
    w.finish();
  });

  it('refuses a move for another scene, of a hidden token, of a fogged token, and of one players never saw', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    for (const id of ['orc', 'goblin', 'unknown']) w.control.set(id, a.playerId, true);
    a.move('hero', 300, 150, 'an-older-scene');
    a.move('orc', 300, 150);
    a.move('goblin', 300, 150);
    a.move('unknown', 300, 150);
    expect(a.refusals()).toEqual(['hero', 'orc', 'goblin', 'unknown']);
    expect(w.undoSteps()).toBe(0);
    w.finish();
  });

  it('refuses a token that left the projection between the drag and the drop', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    hide(w, true);
    await w.tick();
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    w.finish();
  });

  it('refuses a token hidden in the store before the broadcaster has ticked', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    hide(w, true);
    const steps = w.undoSteps();
    // No tick: the projection still shows the token, the live store no longer does.
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(w.undoSteps()).toBe(steps);
    w.finish();
  });

  it('refuses any truthy hidden value, as the projection hides it', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    hide(w, 1);
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    w.finish();
  });

  it('refuses a move while the scene is held, and writes nothing into the map the view shows now', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    w.tabs.getState().setActiveTab(w.dungeon);
    expect(w.presented.isHeld()).toBe(true);
    expect(w.broadcaster.currentProjection()?.sceneId).toBe(sceneId);
    a.move('hero', 300, 150, sceneId);
    expect(a.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(w.undoSteps()).toBe(0);
    w.finish();
  });

  it('refuses a move while the presented map is loading', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    w.store.setState({ isMapLoading: true });
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    w.finish();
  });

  it('refuses a coordinate too large for a number and keeps the connection', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    for (let attempt = 0; attempt < 3; attempt++) {
      a.sendRaw(`{"v":1,"type":"token-move","sceneId":"${sceneId}","tokenId":"hero","x":1e400,"y":0}`);
    }
    expect(a.refusals()).toEqual(['hero', 'hero', 'hero']);
    expect(a.session.state.status).toBe('admitted');
    a.move('hero', 300, 150);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    w.finish();
  });

  it('clamps to the map area before snapping', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    a.move('hero', 5000, -300);
    expect(w.token('hero')).toMatchObject({ x: 1995, y: 35 });
    w.finish();
  });

  it("clamps to the scene's content without a map size", async () => {
    // Without fog, and the goblin it hid left out: on a fogged map of unknown size players are sent nothing (F-POS).
    const { goblin: _goblin, ...party } = partyTokens();
    const state = partyState(party);
    state.objects = { ...state.objects, fog: {} };
    const w = controlWorld({ scene: { state, mapSize: { width: 0, height: 0 } } });
    const a = await withHero(w);
    // hero (140, 140) and ally (280, 140) are what players see: 105..315 × 105..175, one cell around it.
    a.move('hero', 5000, 5000);
    expect(w.token('hero')).toMatchObject({ x: 385, y: 245 });
    w.finish();
  });

  it("snaps as the GM's drag does: hex cells, nothing with snapping off, and a switched-off grid still snaps", async () => {
    const hex = partyState();
    hex.grid = { ...hex.grid!, type: 'hex-vertical' };
    const w1 = controlWorld({ scene: { state: hex } });
    (await withHero(w1)).move('hero', 300, 150);
    expect(w1.token('hero')).toMatchObject(nearestHexCenter(createHexLayout('hex-vertical', 70, 0, 0), { x: 300, y: 150 }));
    w1.finish();

    const free = partyState();
    free.grid = { ...free.grid!, snapToGrid: false };
    const w2 = controlWorld({ scene: { state: free } });
    (await withHero(w2)).move('hero', 300.5, 150.25);
    expect(w2.token('hero')).toMatchObject({ x: 300.5, y: 150.25 });
    w2.finish();

    const off = partyState();
    off.grid = { ...off.grid!, enabled: false };
    const w3 = controlWorld({ scene: { state: off } });
    (await withHero(w3)).move('hero', 300, 150);
    expect(w3.token('hero')).toMatchObject({ x: 315, y: 175 });
    w3.finish();
  });

  it("snaps a Large or Gargantuan token where cells meet, as the GM's drag does, by the live token's size", async () => {
    const tokens = partyTokens();
    tokens.hero = { ...tokens.hero!, size: 1.5 };
    const square = controlWorld({ scene: { state: partyState(tokens) } });
    (await withHero(square)).move('hero', 300, 150);
    // The intersection nearest the drop: a 2×2 footprint covers four whole cells.
    expect(square.token('hero')).toMatchObject({ x: 280, y: 140 });
    square.finish();

    const hex = partyState({ ...partyTokens(), hero: { ...partyTokens().hero!, size: 2.5 } });
    hex.grid = { ...hex.grid!, type: 'hex-vertical' };
    const w = controlWorld({ scene: { state: hex } });
    (await withHero(w)).move('hero', 300, 150);
    const layout = createHexLayout('hex-vertical', 70, 0, 0);
    expect(w.token('hero')).toMatchObject(snapTokenCenter({ x: 300, y: 150 }, 2.5, 'hex-vertical', 70, (point) => nearestHexCenter(layout, point)));
    expect(w.token('hero')).not.toMatchObject(nearestHexCenter(layout, { x: 300, y: 150 }));
    w.finish();
  });

  it(`ignores more than ${MOVES_PER_SECOND} moves a second from one player, without answering them`, async () => {
    const w = controlWorld();
    const a = await withHero(w);
    for (let cell = 1; cell <= 12; cell++) a.move('hero', cell * 70 + 35, 140);
    expect(w.undoSteps()).toBe(MOVES_PER_SECOND);
    expect(w.token('hero')).toMatchObject({ x: 735, y: 175 });
    expect(a.refusals()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    a.move('hero', 105, 140);
    expect(w.token('hero')).toMatchObject({ x: 105, y: 175 });
    expect(w.undoSteps()).toBe(MOVES_PER_SECOND + 1);
    w.finish();
  });

  it('keeps the rate window of a player who reconnects, and forgets one who left the session', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    for (let cell = 1; cell <= MOVES_PER_SECOND; cell++) a.move('hero', cell * 70 + 35, 140);
    expect(w.undoSteps()).toBe(MOVES_PER_SECOND);
    const again = await w.join('A');
    expect(again.playerId).toBe(a.playerId);
    again.move('hero', 105, 140);
    expect(w.undoSteps()).toBe(MOVES_PER_SECOND);
    expect(again.refusals()).toEqual([]);
    w.finish();

    const limit = new MoveRateLimit();
    for (let i = 0; i < MOVES_PER_SECOND; i++) limit.allow('p', 0);
    limit.retain(new Set(['p']));
    expect(limit.allow('p', 1)).toBe(false);
    limit.retain(new Set());
    expect(limit.allow('p', 2)).toBe(true);
  });

  it('applies both drops of a token two players control, in arrival order', async () => {
    const w = controlWorld();
    const a = await withHero(w);
    const b = await w.join('B');
    w.control.set('hero', b.playerId, true);
    a.move('hero', 300, 150);
    b.move('hero', 500, 150);
    expect(w.token('hero')).toMatchObject({ x: 525, y: 175 });
    expect(w.undoSteps()).toBe(2);
    w.finish();
  });

  it('never answers a connection that is not admitted', async () => {
    const w = controlWorld();
    await withHero(w);
    const link = await w.network.client().connect('gm');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Eve', playerKey: 'eve', client: { kind: 'web', version: '1' } }));
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId, tokenId: 'hero', x: 300, y: 150 }));
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(received.filter((message) => message.type === 'token-move-refused')).toEqual([]);
    w.finish();
  });
});
