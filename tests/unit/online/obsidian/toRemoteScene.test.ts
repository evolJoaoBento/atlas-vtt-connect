import { describe, expect, it } from 'vitest';
import type { RemoteImages } from '../../../../src/app/online/obsidian/onlineJoinTypes';
import { RemoteSceneMemo, remotePlayerState } from '../../../../src/app/online/obsidian/remote/toRemoteScene';
import type { PlayerScene } from '../../../../src/app/online/scene/sceneTypes';
import { NEUTRAL_BADGE_COLOR } from '../../../../src/app/online/view/layers/tokenUiDrawing';
import { fogRect, playerScene, playerToken } from '../sceneFixtures';

const images: RemoteImages = {
  background: (id) => (id ? `blob:map/${id}` : null),
  token: (id) => (id ? `blob:token/${id}` : null),
};
const noImages: RemoteImages = { background: () => null, token: () => null };
const input = (scene: PlayerScene, given: RemoteImages = images) => new RemoteSceneMemo().input(scene, given);

describe('toRemoteScene', () => {
  it('shows the map and token art by object URL, one URL per use', () => {
    const scene = input(playerScene());
    expect(scene.background).toEqual({ url: 'blob:map/map-asset', width: 1000, height: 800 });
    expect(scene.tokenImages).toEqual({ t1: 'blob:token/asset-1' });
    expect(scene.objects.tokens.t1).toEqual({
      id: 't1', kind: 'token', x: 100, y: 100, size: 1, rotation: 0, layer: 0,
      imagePath: 'blob:token/asset-1', showRing: true, ringColor: '#ffffff',
    });
  });

  it("shows a token whose art has not arrived as Atlas's default token, and no map image yet", () => {
    const scene = input(playerScene(), noImages);
    expect(scene.background.url).toBeNull();
    expect(scene.tokenImages).toEqual({ t1: null });
    expect(scene.objects.tokens.t1?.imagePath).toBe('');
  });

  it('makes a token with a name, a bar or a downed mark a character, with a plate only for a sent name', () => {
    const bar = { color: '#22c55e', share: 0.7, spent: false };
    const scene = playerScene({
      tokens: {
        named: playerToken({ name: 'Anna', resources: [bar], ring: null }),
        unnamed: playerToken({ resources: [{ color: '#a855f7', share: 0.25, spent: false }] }),
        downed: playerToken({ downed: true }),
        plain: playerToken(),
      },
    });
    const { tokens } = input(scene).objects;
    const player = remotePlayerState(scene, []);
    expect(tokens.named).toMatchObject({ kind: 'character', name: 'Anna', showNameplate: true, resources: { bar0: { current: 70, max: 100 } }, showRing: false });
    expect(tokens.named).not.toHaveProperty('ringColor');
    expect(tokens.unnamed).toMatchObject({ kind: 'character', name: '', resources: { bar0: { current: 25, max: 100 } } });
    expect(tokens.unnamed).not.toHaveProperty('showNameplate');
    expect(tokens.downed).toMatchObject({ kind: 'character', resources: { downed: { current: 0, max: 1 } } });
    expect(tokens.plain).toMatchObject({ kind: 'token' });
    // Atlas draws each bar from a stand-in definition of the colour sent; nothing of the GM's definitions
    expect(player.tokenUi.resources.named).toEqual([
      expect.objectContaining({ key: 'bar0', color: '#22c55e', slot: 0, visibleToPlayers: true }),
      expect.objectContaining({ key: 'downed', visibleToPlayers: false, defeatedWhenSpent: true }),
    ]);
    expect(tokens.named).toMatchObject({ resources: { downed: { current: 1, max: 1 } } });
    expect(player.tokenUi.resources.downed).toEqual([expect.objectContaining({ key: 'downed', visibleToPlayers: false, defeatedWhenSpent: true })]);
    expect(player.tokenUi.resources).not.toHaveProperty('plain');
  });

  it('leaves hp and stress alone: a GM of an older version sent them, and nothing draws them any more', () => {
    const old = input(playerScene({ tokens: { old: playerToken({ name: 'Old', hp: { current: 3, max: 8 }, stress: { current: 1, max: 4 } }) } })).objects.tokens.old;
    expect(old).toMatchObject({ kind: 'character', name: 'Old' });
    expect(old).not.toHaveProperty('resources');
    expect(old).not.toHaveProperty('hp');
    expect(old).not.toHaveProperty('stress');
  });

  it('gives conditions neutral definitions, valued where a value was sent', () => {
    const scene = playerScene({ tokens: { a: playerToken({ name: 'A', conditions: [{ id: 'prone', value: null }, { id: 'frightened', value: 2 }] }) } });
    expect(input(scene).objects.tokens.a).toMatchObject({ conditions: ['prone', 'frightened'], conditionValues: { frightened: 2 } });
    expect(remotePlayerState(scene, []).tokenUi.conditions).toEqual([
      { id: 'prone', name: 'Condition', color: NEUTRAL_BADGE_COLOR },
      { id: 'frightened', name: 'Condition', color: NEUTRAL_BADGE_COLOR, valued: true },
    ]);
  });

  it('rebuilds fog, texts and drawings in their orders', () => {
    const scene = playerScene({
      fog: {
        f1: fogRect(4, { erase: true, x: 10, y: 20, width: 30, height: 40 }),
        f2: { type: 'brush', erase: false, order: 5, radius: 12, points: [{ x: 1, y: 2 }] },
        f3: { type: 'lasso', erase: true, order: 6, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 4, y: 7 }] },
      },
    });
    const { objects } = input(scene);
    expect(objects.fog).toEqual({
      f1: { id: 'f1', kind: 'fog', timestamp: 4, isErasing: true, type: 'rectangle', x: 10, y: 20, width: 30, height: 40 },
      f2: { id: 'f2', kind: 'fog', timestamp: 5, isErasing: false, type: 'brush', brushRadius: 12, points: [{ x: 1, y: 2 }] },
      f3: { id: 'f3', kind: 'fog', timestamp: 6, isErasing: true, type: 'lasso', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 4, y: 7 }] },
    });
    expect(objects.texts.x1).toEqual({
      id: 'x1', kind: 'text', x: 50, y: 50, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#000000',
      padding: 4, borderRadius: 0, opacity: 1, align: 'center', bold: false, italic: false, rotation: 0, scale: 1,
    });
    expect(objects.drawings.d1).toEqual({
      id: 'd1', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0000', width: 4, opacity: 1,
    });
  });

  it('shows the grid as the GM sends it, and a hidden grid with the map cell size so tokens keep their size', () => {
    expect(input(playerScene()).grid).toEqual({
      enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1,
      snapToGrid: true, measurementType: 'units', unitType: 'feet', unitDistance: 5,
    });
    expect(input(playerScene({ grid: null, map: { asset: null, width: 0, height: 0, cellSize: 50 } })).grid).toMatchObject({ enabled: true, visible: false, size: 50 });
  });

  it('numbers the cells as the GM sends them, on any grid, and reads the hex numbers of a GM before Atlas 0.5.1', () => {
    const gridOf = (patch: Partial<NonNullable<PlayerScene['grid']>>) => input(playerScene({ grid: { ...playerScene().grid!, ...patch } })).grid;
    expect(gridOf({ cellNumbers: 'letter-number', cellNumberOpacity: 0.3 })).toMatchObject({ type: 'square', cellNumbers: 'letter-number', cellNumberOpacity: 0.3 });
    expect(gridOf({ type: 'hex-vertical', hexNumbers: 'sequential', hexNumberOpacity: 0.6 })).toMatchObject({ cellNumbers: 'sequential', cellNumberOpacity: 0.6 });
    // An older GM's hex numbers on a square grid: its Atlas drew none there.
    expect(gridOf({ hexNumbers: 'column-row' })).not.toHaveProperty('cellNumbers');
    expect(gridOf({ type: 'hex-vertical', hexNumbers: 'sequential', cellNumbers: null })).not.toHaveProperty('cellNumbers');
  });

  it("takes the GM's measurement for the ruler, snapping included", () => {
    const scene: PlayerScene = playerScene({
      measurement: {
        mode: 'abstract', unitType: 'custom', unitDistance: 1, ruleDistance: 1, diagonalRule: 'alternating',
        rangeBands: [{ name: 'Close', maxSquares: 2 }], snapToGrid: false, coneAngle: 53.13,
      },
    });
    expect(remotePlayerState(scene, []).measurement).toEqual({
      mode: 'abstract', unitType: 'custom', unitDistance: 1, ruleDistance: 1, diagonalRule: 'alternating', rangeBands: [{ name: 'Close', maxSquares: 2 }], coneAngle: 53.13,
    });
    expect(input(scene).grid).toMatchObject({ snapToGrid: false, measurementType: 'abstract' });
    expect(input(scene).grid).not.toHaveProperty('unitType');
  });

  it("gives the remote view a scene's own distance per cell and the collection's rules square", () => {
    const scene = playerScene({ measurement: { ...playerScene().measurement, unitDistance: 10, ruleDistance: 5 } });
    expect(remotePlayerState(scene, []).measurement).toMatchObject({ unitDistance: 10, ruleDistance: 5 });
    expect(input(scene).grid).toMatchObject({ unitDistance: 10 });
    // A rules square Atlas would refuse is left out; Atlas then takes the distance per cell.
    const zero = playerScene({ measurement: { ...playerScene().measurement, ruleDistance: 0 } });
    expect(remotePlayerState(zero, []).measurement).not.toHaveProperty('ruleDistance');
  });

  it('shows counters and clocks by their value and timers by their remaining time, all to players', () => {
    const scene = playerScene({
      widgets: [
        { id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', value: 3 },
        { id: 'doom', type: 'clock', label: 'Doom', icon: 'no-such-icon', value: 2 },
        { id: 'fuse', type: 'timer', label: 'Fuse', icon: 'hourglass', value: 90 },
      ],
    });
    const { settings, values } = input(scene).widgets;
    expect(settings).toMatchObject({ globalVisible: true, position: 'top', scale: 1 });
    expect(settings.widgets.torches).toEqual({
      id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 3, order: 0, scope: 'scene',
    });
    // Atlas resolves an icon name it does not know as it draws (`resolveWidgetIcon`); the name is passed through.
    expect(settings.widgets.doom).toMatchObject({ type: 'counter', order: 1 });
    expect(settings.widgets.fuse).toMatchObject({ type: 'timer', value: 90, duration: 90, direction: 'down', order: 2 });
    expect(values).toEqual({ torches: 3, doom: 2 });
  });

  it("lists the initiative order players may see, each entry with its token's art", () => {
    const scene = playerScene({
      initiative: { round: 3, active: true, entries: [{ id: 'e1', tokenId: 't1', initiative: 15, name: 'Anna', hp: null, hpShare: 0.4, isActive: true }] },
    });
    const { initiative } = input(scene);
    expect(initiative).toMatchObject({ round: 3, isActive: true, currentIndex: 0 });
    expect(initiative.entries).toEqual([{
      id: 'e1', tokenId: 't1', name: 'Anna', initiative: 15, initiativeModifier: 0,
      imagePath: 'blob:token/asset-1', isActive: true, isNPC: true, order: 0,
    }]);
    // The bar after the name comes with the player's part, by token, for the initiative list to draw
    expect(remotePlayerState(scene, []).initiative.health).toEqual({ t1: { value: 40, max: 100 } });
    expect(input(playerScene({ initiative: null })).initiative.entries).toEqual([]);
  });

  it('places a token where this view holds it instead of where the GM has it', () => {
    const scene = new RemoteSceneMemo().input(playerScene(), images, (id) => (id === 't1' ? { x: 500, y: 600 } : null));
    expect(scene.objects.tokens.t1).toMatchObject({ x: 500, y: 600 });
  });

  it('takes named fields only: keys the network adds never reach the view', () => {
    const base = playerScene();
    const extra = { notePath: 'GM/secret.md', tags: ['boss'], isHidden: true, statblockPath: 'Bestiary/x.md', secret: 1 };
    const scene = playerScene({
      tokens: { t1: { ...playerToken(), ...extra } as never },
      texts: { x1: { ...base.texts.x1!, secret: 1 } as never },
      drawings: { d1: { ...base.drawings.d1!, secret: 1 } as never },
      fog: { f1: { ...base.fog.f1!, secret: 1 } as never },
      widgets: [{ ...base.widgets[0]!, secret: 1 } as never],
      initiative: { ...base.initiative!, entries: [{ ...base.initiative!.entries[0]!, secret: 1 } as never] },
    });
    const text = JSON.stringify([input(scene), remotePlayerState(scene, ['t1'])]);
    for (const key of ['notePath', 'tags', 'isHidden', 'statblockPath', 'secret']) expect(text).not.toContain(`"${key}"`);
    expect(Object.keys(input(scene).objects).sort()).toEqual(['drawings', 'fog', 'texts', 'tokens']);
  });

  it("gives no scene the player's part: nothing to move and Atlas's default measurement", () => {
    const player = remotePlayerState(null, ['t1']);
    expect(player.tokenUi).toEqual({ conditions: [], resources: {} });
    expect(player.initiative).toEqual({ rules: null, health: {} });
    expect(player.measurement).toMatchObject({ mode: 'metric', unitType: 'feet' });
  });

  it('hands the same records, grid, widgets and initiative back while they did not change, and new ones where they did', () => {
    const memo = new RemoteSceneMemo();
    const scene = playerScene();
    const first = memo.input(scene, images);
    const same = memo.input({ ...scene }, images);
    expect(same.objects.tokens.t1).toBe(first.objects.tokens.t1);
    expect(same.objects.fog.f1).toBe(first.objects.fog.f1);
    expect(same.grid).toBe(first.grid);
    expect(same.widgets).toBe(first.widgets);
    expect(same.initiative).toBe(first.initiative);
    // The token's art arrived: its record (and the list's avatar) change, nothing else.
    const art = memo.input(scene, { ...images, token: (id) => (id ? `blob:new/${id}` : null) });
    expect(art.objects.tokens.t1).not.toBe(first.objects.tokens.t1);
    expect(art.initiative).not.toBe(first.initiative);
    expect(art.objects.texts.x1).toBe(first.objects.texts.x1);
  });
});
