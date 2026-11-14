import { controlWorld } from './controlFixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTokenEdit, lightEmission, type TokenEdit } from '../../../src/app/online/control/tokenEdits';
import { TokenEditHandler } from '../../../src/app/online/control/TokenEditHandler';
import type { TokenCopyHandlerOptions } from '../../../src/app/online/control/TokenCopyHandler';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { stockTokensApi, type TokenView } from '../../../src/connect/stockTokens/stockTokens';

describe('owned token editing', () => {
  it('validates HP, visibility, status and size without allowing arbitrary token attributes', () => {
    expect(isTokenEdit({ hp: { current: 0, max: 12 }, showHpBar: true, statusText: 'Ferido', size: 1.5 })).toBe(true);
    for (const edit of [{}, { hp: { current: -1, max: 12 } }, { hp: { current: 13, max: 12 } }, { hp: { current: 0, max: 0 } }, { hp: { current: 1.5, max: 12 } }, { size: Infinity }, { size: 0.5 }, { size: 6 }, { statusText: 'x'.repeat(121) }, { statusText: '\n' }, { isHidden: false }, { hp: { current: 1, max: 2, secret: 3 } }]) expect(isTokenEdit(edit)).toBe(false);
  });
  it('round-trips an edit through protocol validation and rejects overflows', () => {
    const base = { v: 1, type: 'token-edit', sceneId: 'scene', tokenId: 'hero', edit: { hp: { current: 5, max: 10 } } } as const;
    expect(decodeControl(encodeControl(base))).toMatchObject({ kind: 'message', message: base });
    expect(decodeControl(JSON.stringify({ ...base, edit: { hp: { current: 999999999, max: 10 } } }))).not.toMatchObject({ kind: 'message' });
  });
  const setup = () => {
    const control = new TokenControl(); control.set('hero', 'a', true);
    const edit = vi.fn(() => true); const send = vi.fn();
    const snapshot = { objects: { tokens: { hero: { kind: 'character', isHidden: false } } } };
    const slot = { sceneId: 'scene', tab: { viewId: 'view' }, lastSent: { sceneId: 'scene', tokens: { hero: {} } } };
    const projection = { slotOf: () => slot, shownSnapshot: vi.fn(() => snapshot), flashAt: vi.fn(() => true) };
    const handler = new TokenEditHandler({ control, projection, session: { send }, tokens: { edit } } as unknown as TokenCopyHandlerOptions);
    const message = { v: 1, type: 'token-edit', sceneId: 'scene', tokenId: 'hero', edit: { size: 1.5 } } as ControlMessage;
    return { control, edit, send, snapshot, projection, handler, message, slot };
  };
  it('edits only a currently visible, owned token on the live scene', () => {
    const t = setup(); t.handler.onMessage({ playerId: 'a' } as SessionPlayer, t.message);
    expect(t.edit).toHaveBeenCalledWith('view', 'hero', { size: 1.5 });
    for (const change of [
      (s: ReturnType<typeof setup>) => s.control.set('hero', 'a', false),
      (s: ReturnType<typeof setup>) => { s.snapshot.objects.tokens.hero.isHidden = true; },
      (s: ReturnType<typeof setup>) => { Object.assign(s.message, { sceneId: 'stale' }); },
      (s: ReturnType<typeof setup>) => s.projection.shownSnapshot.mockReturnValue(null as never),
      (s: ReturnType<typeof setup>) => { delete (s.slot.lastSent.tokens as Record<string, unknown>).hero; },
    ]) {
      const s = setup(); change(s); s.handler.onMessage({ playerId: 'a' } as SessionPlayer, s.message);
      expect(s.edit).not.toHaveBeenCalled(); expect(s.send).toHaveBeenCalled();
    }
  });
  it('accepts a short-lived flash only from the owner of a visible token, using host coordinates', () => {
    const t = setup();
    Object.assign(t.snapshot.objects.tokens.hero, { x: 42, y: 73 });
    const message: ControlMessage = { v: 1, type: 'token-light-flash', sceneId: 'scene', tokenId: 'hero' };
    t.handler.onMessage({ playerId: 'a' } as SessionPlayer, message);
    expect(t.projection.flashAt).toHaveBeenCalledWith('scene', 42, 73);
    t.control.set('hero', 'a', false);
    t.handler.onMessage({ playerId: 'a' } as SessionPlayer, message);
    expect(t.projection.flashAt).toHaveBeenCalledTimes(1);
  });
  it('persists through the native store, retaining other resources and maximum overrides', () => {
    const updateToken = vi.fn();
    const state = { mapLoaded: true, isMapLoading: false, lighting: { enabled: false }, objects: { tokens: { hero: { kind: 'character', x: 1, y: 1, resources: { hp: { current: 5, max: 10 }, mana: { current: 2, max: 3 } }, overriddenMax: ['mana'] } } }, updateToken };
    const api = stockTokensApi({ view: () => ({ viewId: 'view', atlasStore: { getState: () => state } }) as unknown as TokenView, mapSize: () => ({ width: 500, height: 500 }), dynamicLighting: () => false });
    expect(api.edit?.('view', 'hero', { hp: { current: 3, max: 12 }, size: 1.5, showHpBar: true })).toBe(true);
    expect(updateToken).toHaveBeenCalledWith('hero', { size: 1.5, showHpBar: true, resources: { hp: { current: 3, max: 12 }, mana: { current: 2, max: 3 } }, overriddenMax: ['mana', 'hp'] });
    state.isMapLoading = true; updateToken.mockClear();
    expect(api.edit?.('view', 'hero', { size: 2 })).toBe(false); expect(updateToken).not.toHaveBeenCalled();
  });
});


describe('token edit across real session protocol', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('accepts the owner and refuses a forged edit from a second player', async () => {
    const edit = vi.fn((_view: string, id: string, changes: TokenEdit) => {
      const state = w.store.getState(); const token = state.objects.tokens[id];
      if (!token) return false;
      const { hp, ...rest } = changes;
      w.store.setState({ objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...token, ...rest, ...(hp ? { resources: { ...token.resources, hp } } : {}) } } } });
      return true;
    });
    const w: ReturnType<typeof controlWorld> = controlWorld({ edit });
    try {
      w.present(); const a = await w.join('A'); const b = await w.join('B');
      w.control.set('hero', a.playerId, true); await w.tick();
      expect(a.session.sendTokenEdit('hero', { hp: { current: 4, max: 12 }, size: 1.5, showHpBar: true })).toBe(true);
      await w.tick(); expect(edit).toHaveBeenCalledTimes(1);
      expect(w.token('hero')?.resources?.hp).toEqual({ current: 4, max: 12 });
      for (const player of [a, b]) expect(player.session.scene?.tokens.hero).toMatchObject({ size: 1.5, hp: { current: 4, max: 12 }, showHpBar: true });
      expect(b.session.sendTokenEdit('hero', { size: 2 })).toBe(false);
      b.sendRaw(encodeControl({ v: 1, type: 'token-edit', sceneId: b.session.scene!.sceneId, tokenId: 'hero', edit: { size: 2 } }));
      await w.tick(); expect(edit).toHaveBeenCalledTimes(1); expect(b.refusals()).toContain('hero');
      a.session.sendTokenEdit('hero', { showHpBar: false }); await w.tick();
      expect(b.session.scene?.tokens.hero?.hp).toBeNull();
      expect(w.token('hero')?.resources?.hp?.current).toBe(4);
    } finally { w.finish(); }
  });
});

it('validates initiative bounds and writes into the shared native tracker', () => {
  expect(isTokenEdit({initiative: 18})).toBe(true);
  for (const initiative of [NaN, 1.2, 1001, -1001, '20']) expect(isTokenEdit({initiative})).toBe(false);
  const addToInitiative = vi.fn(() => 'entry'); const updateInitiativeEntry = vi.fn(); const updateToken = vi.fn();
  const state = {mapLoaded: true, isMapLoading: false, lighting: {enabled: false}, objects: {tokens: {hero: {x: 1, y: 1, name: 'Hero'}}}, initiative: {entries: [] as {id: string; tokenId: string}[]}, addToInitiative, updateInitiativeEntry, updateToken};
  const api = stockTokensApi({view: () => ({viewId: 'view', atlasStore: {getState: () => state}}) as unknown as TokenView, mapSize: () => ({width: 500, height: 500}), dynamicLighting: () => false});
  expect(api.edit?.('view', 'hero', {initiative: 18})).toBe(true);
  expect(addToInitiative).toHaveBeenCalledWith(expect.objectContaining({tokenId: 'hero', initiative: 0}));
  expect(updateToken).not.toHaveBeenCalled();
  state.initiative.entries.push({id: 'entry', tokenId: 'hero'});
  api.edit?.('view', 'hero', {initiative: 12});
  expect(updateInitiativeEntry).toHaveBeenCalledWith('entry', {initiative: 12});
  expect(addToInitiative).toHaveBeenCalledOnce();
});

it('writes only the selected bounded light preset to the native token', () => {
  expect(lightEmission('torch')).toEqual({bright:20,dim:40,intensity:1,color:'#ffcf81',animation:'torch'});
  expect(lightEmission('none')).toBeUndefined();
  const updateToken=vi.fn();
  const state={mapLoaded:true,isMapLoading:false,lighting:{enabled:false},objects:{tokens:{hero:{x:1,y:1,name:'Hero'}}},updateToken};
  const api=stockTokensApi({view:()=>({viewId:'v',atlasStore:{getState:()=>state}}) as unknown as TokenView,mapSize:()=>({width:100,height:100}),dynamicLighting:()=>false});
  expect(api.edit?.('v','hero',{light:'continual-flame'})).toBe(true);
  expect(updateToken).toHaveBeenCalledWith('hero',{light:{bright:20,dim:40,intensity:1,color:'#ffcf81',animation:'magic'}});
  expect(api.edit?.('v','hero',{light:'none'})).toBe(true);
  expect(updateToken).toHaveBeenLastCalledWith('hero',{light:undefined});
});

it('adds arbitrary named turns without a token, bounds input and opens the shared tracker', () => {
  const addToInitiative=vi.fn(()=>'turn');const updateInitiativeEntry=vi.fn();const setInitiativeTrackerOpen=vi.fn();
  const state={mapLoaded:true,isMapLoading:false,lighting:{enabled:false},objects:{tokens:{}},initiative:{entries:[]},addToInitiative,updateInitiativeEntry,setInitiativeTrackerOpen};
  const api=stockTokensApi({view:()=>({viewId:'view',atlasStore:{getState:()=>state}}) as unknown as TokenView,mapSize:()=>({width:100,height:100}),dynamicLighting:()=>false});
  expect(api.addTurn?.('view','  Goblin livre  ',19)).toBe(true);
  expect(addToInitiative).toHaveBeenCalledWith(expect.objectContaining({name:'Goblin livre',tokenId:expect.stringMatching(/^rpg-turn-/)}));
  expect(updateInitiativeEntry).toHaveBeenCalledWith('turn',{initiative:19});expect(setInitiativeTrackerOpen).toHaveBeenCalledWith(true);
  expect(api.addTurn?.('view','',19)).toBe(false);expect(api.addTurn?.('view','Goblin',NaN)).toBe(false);
});

it('removes only an existing native initiative entry',()=>{
 const removeFromInitiative=vi.fn();const state={mapLoaded:true,isMapLoading:false,lighting:{enabled:false},objects:{tokens:{}},initiative:{entries:[{id:'entry',tokenId:'manual'}]},removeFromInitiative};
 const api=stockTokensApi({view:()=>({viewId:'v',atlasStore:{getState:()=>state}}) as unknown as TokenView,mapSize:()=>({width:1,height:1}),dynamicLighting:()=>false});
 expect(api.removeTurn?.('v','missing')).toBe(false);expect(removeFromInitiative).not.toHaveBeenCalled();
 expect(api.removeTurn?.('v','entry')).toBe(true);expect(removeFromInitiative).toHaveBeenCalledWith('entry');
});
