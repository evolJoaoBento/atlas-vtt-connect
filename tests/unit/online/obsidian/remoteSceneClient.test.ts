import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_LABEL, ROLL_DICE_COUNT_TEXT, ROLL_MODIFIER_TEXT } from '../../../../src/app/online/obsidian/remote/RemoteSceneClient';
import { FIT_MAP_ITEM, FOLLOW_GM_ITEM } from '../../../../src/app/online/obsidian/remote/remoteToolbar';
import {
  ROLL_CONNECTION_LOST_TEXT, ROLL_NOT_SENT_TEXT, ROLL_RECONNECTING_TEXT, ROLL_SESSION_ENDED_TEXT,
} from '../../../../src/app/online/obsidian/onlineRollRefusal';
import { shownUrls } from '../../../../src/app/online/obsidian/objectUrlImages';
import { PAUSED_BANNER } from '../../../../src/app/online/split/splitCopy';
import { laserColor } from '../../../../src/app/online/tools/laserColors';
import { playerScene } from '../sceneFixtures';
import { admitted, REMOTE_CAPABILITIES, remoteSceneSetup } from './remoteSceneFixtures';

const setup = remoteSceneSetup;

afterEach(() => { vi.restoreAllMocks(); });

describe('RemoteSceneClient', () => {
  it('shows the scene in the remote view and the session in its status bar', async () => {
    const t = await setup({ images: { background: (id) => (id ? `blob:map/${id}` : null), token: (id) => (id ? `blob:token/${id}` : null) } });
    expect(t.attached).toBe(true);
    t.sink().session(admitted());
    expect(t.handle.status).toMatchObject({ title: 'Table', connection: 'Connected', tone: 'connected', message: 'Waiting for the GM to show a scene.' });
    expect(t.handle.status).not.toHaveProperty('action');
    t.sink().scene(playerScene());
    expect(Object.keys(t.handle.scene?.objects.tokens ?? {})).toEqual(['t1']);
    expect(t.handle.scene?.background).toEqual({ url: 'blob:map/map-asset', width: 1000, height: 800 });
    expect(t.handle.scene?.tokenImages).toEqual({ t1: 'blob:token/asset-1' });
    expect(t.handle.status?.message).toBeNull();
    // The view's store holds it as a remote map, listed as such.
    expect(t.extension.views.list().find((info) => info.viewId === t.view.viewId)).toMatchObject({ kind: 'remote', mapPath: `remote:${t.view.viewId}`, loaded: true });
  });

  it('shows no scene as an empty, unloaded view', async () => {
    const t = await setup();
    t.sink().scene(playerScene());
    t.sink().scene(null);
    expect(t.handle.scene).toBeNull();
    expect(t.extension.views.list().find((info) => info.viewId === t.view.viewId)?.loaded).toBe(false);
  });

  it('lets the player move only the tokens the GM gives them, and only while they are in', async () => {
    const t = await setup();
    t.sink().control(['t1']);
    expect(t.handle.player?.movableTokenIds).toEqual([]);
    t.sink().session(admitted());
    expect(t.handle.player?.movableTokenIds).toEqual(['t1']);
    t.sink().session({ ...admitted(), status: 'connecting' });
    expect(t.handle.player?.movableTokenIds).toEqual([]);
  });

  it('follows the GM, stops when the player moves the camera or fits the map, and Follow GM goes back', async () => {
    const t = await setup();
    t.sink().scene(playerScene());
    // No GM camera yet: the whole map, at once.
    expect(t.handle.cameras.at(-1)).toEqual({ camera: { centerX: 500, centerY: 400, width: 1000, height: 800 }, animate: false, padded: false });
    t.sink().camera({ sceneId: 'scene-1', centerX: 200, centerY: 100, width: 400, height: 300 });
    expect(t.handle.cameras.at(-1)).toEqual({ camera: { centerX: 200, centerY: 100, width: 400, height: 300 }, animate: true, padded: false });
    const isActive = (): boolean | undefined => t.atlas.ui!.drawToolbar(t.view.viewId).find((item) => item.id === FOLLOW_GM_ITEM)?.active;
    expect(isActive()).toBe(true);
    t.handle.moveCamera(true);
    expect(isActive()).toBe(false);
    const asked = t.handle.count('setCamera');
    t.sink().camera({ sceneId: 'scene-1', centerX: 250, centerY: 100, width: 400, height: 300 });
    expect(t.handle.count('setCamera')).toBe(asked);
    t.atlas.ui!.clickToolbar(FOLLOW_GM_ITEM, t.view.viewId);
    expect(isActive()).toBe(true);
    expect(t.handle.cameras.at(-1)).toEqual({ camera: { centerX: 250, centerY: 100, width: 400, height: 300 }, animate: true, padded: false });
    t.atlas.ui!.clickToolbar(FIT_MAP_ITEM, t.view.viewId);
    expect(isActive()).toBe(false);
    expect(t.handle.cameras.at(-1)).toEqual({ camera: { centerX: 500, centerY: 400, width: 1000, height: 800 }, animate: true, padded: true });
    // Atlas's own Fit map (the hotkey) breaks away too, as the fork's did.
    t.atlas.ui!.clickToolbar(FOLLOW_GM_ITEM, t.view.viewId);
    t.handle.moveCamera(false);
    expect(isActive()).toBe(false);
  });

  it('asks nothing of the camera for a GM camera Atlas would refuse', async () => {
    const t = await setup();
    t.sink().scene(playerScene());
    const asked = t.handle.count('setCamera');
    expect(() => t.sink().camera({ sceneId: 'scene-1', centerX: 200, centerY: 100, width: 0, height: Number.NaN })).not.toThrow();
    expect(t.handle.count('setCamera')).toBe(asked);
  });

  it('feeds arriving images at most once a frame', async () => {
    const t = await setup();
    t.sink().scene(playerScene());
    const fed = t.handle.count('setScene');
    t.sink().images();
    t.sink().images();
    t.sink().images();
    expect(t.pendingFrames()).toBe(1);
    t.runFrames();
    expect(t.handle.count('setScene')).toBe(fed + 1);
  });

  it("throws the player's own roll in the view, never through Atlas's dice event", async () => {
    const t = await setup();
    const heard = vi.fn();
    document.addEventListener('atlas-dice-rolled', heard);
    t.sink().ownRoll({ id: 'r9', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 20 }], modifier: 0, total: 20, crit: 'high', mine: true, at: 5 });
    document.removeEventListener('atlas-dice-rolled', heard);
    expect(t.handle.thrown).toEqual(['r9']);
    expect(t.handle.calls.find((call) => call.method === 'throwRoll')?.args[0]).toMatchObject({ id: 'r9', total: 20, crit: 'high', rolls: [{ die: 'd20', value: 20, max: 20 }] });
    expect(heard).not.toHaveBeenCalled();
  });

  it("shows the shared dice log in Atlas's dice log, newest first, under each roller's name", async () => {
    const t = await setup();
    t.sink().diceLog([
      { id: 'r2', name: 'Anna', formula: '2d6+1', dice: [{ die: 'd6', value: 4 }, { die: 'd6', value: 2 }], modifier: 1, total: 7, at: 2000 },
      { id: 'r1', name: 'GM', formula: 'd20', dice: [{ die: 'd20', value: 11 }], modifier: 0, total: 11, at: 1000 },
    ]);
    expect(t.handle.diceLog).toEqual([
      { id: 'r2', timestamp: 2000, formula: '2d6+1', rolls: [{ die: 'd6', value: 4, max: 6 }, { die: 'd6', value: 2, max: 6 }], modifiers: 1, total: 7, crit: null, rolledBy: 'Anna' },
      { id: 'r1', timestamp: 1000, formula: 'd20', rolls: [{ die: 'd20', value: 11, max: 20 }], modifiers: 0, total: 11, crit: null, rolledBy: 'GM' },
    ]);
  });

  it("gives Atlas's dice log the tags of each die", async () => {
    const t = await setup();
    t.sink().diceLog([
      { id: 'r1', name: 'GM', formula: '2d6', dice: [{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 2 }], modifier: 0, total: 6, at: 1000 },
    ]);
    expect((t.handle.diceLog[0] as { rolls: unknown[] }).rolls).toEqual([{ die: 'd6', value: 4, max: 6, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 2, max: 6 }]);
  });

  it("draws other people's lasers on this scene in their colours, and nobody's for another scene", async () => {
    const t = await setup();
    t.sink().session(admitted(['p1', 'p2']));
    t.sink().scene(playerScene());
    t.sink().laser({ from: 'p2', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: false, dt: [0] });
    t.sink().laser({ from: 'gm', sceneId: 'scene-1', points: [], lifted: true, color: '#ffffff' });
    t.sink().laser({ from: 'p1', sceneId: 'other', points: [{ x: 1, y: 2 }], lifted: false });
    // A colour Atlas would refuse is replaced by the sender's place colour, never thrown into the session.
    t.sink().laser({ from: 'p1', sceneId: 'scene-1', points: [], lifted: true, color: 'red' });
    expect(t.atlas.lasers.shown(t.view.viewId)).toEqual([
      { from: 'p2', color: laserColor('p2', ['p1', 'p2']), points: [{ x: 1, y: 2 }], lifted: false, dt: [0] },
      { from: 'gm', color: '#ffffff', points: [], lifted: true },
      { from: 'p1', color: laserColor('p1', ['p1', 'p2']), points: [], lifted: true },
    ]);
  });

  it('shows the end of the session, keeps the scene, and offers Reconnect after a lost connection', async () => {
    const t = await setup();
    t.sink().session(admitted());
    t.sink().scene(playerScene());
    t.sink().session({ ...admitted(), status: 'lost', reason: 'connection-lost' });
    expect(t.handle.status).toMatchObject({ tone: 'ended', connection: 'Disconnected', message: 'Lost the connection to your GM.', action: { label: RECONNECT_LABEL } });
    expect(Object.keys(t.handle.scene?.objects.tokens ?? {})).toEqual(['t1']);
    t.handle.status?.action?.run();
    expect(t.fake.reconnect).toHaveBeenCalledOnce();
    t.sink().session({ ...admitted(), status: 'lost', reason: 'ended' });
    expect(t.handle.status).not.toHaveProperty('action');
  });

  it('offers Shared with me beside Reconnect, within 3 buttons, and opens the dialog when it is chosen', async () => {
    const t = await setup();
    t.sink().session(admitted());
    expect(t.handle.status?.actions).toEqual([{ id: 'shared-with-me', label: 'Shared with me…', icon: 'inbox' }]);
    expect(t.handle.status).not.toHaveProperty('action');
    t.sink().session({ ...admitted(), status: 'lost', reason: 'connection-lost' });
    expect(t.handle.status?.action?.label).toBe(RECONNECT_LABEL);
    expect(t.handle.status?.actions).toHaveLength(1);
    t.handle.chooseStatusAction('shared-with-me');
    expect(t.openShared).toHaveBeenCalledOnce();
    t.client.dispose();
    t.handle.chooseStatusAction('shared-with-me');
    expect(t.openShared).toHaveBeenCalledOnce();
  });

  it('leaves the button out without an opener, and on an Atlas before 1.15 sends no actions and does not crash', async () => {
    const none = await setup({ openShared: null });
    none.sink().session(admitted());
    expect(none.handle.status).not.toHaveProperty('actions');
    const old = await setup({ before115: true });
    old.sink().session({ ...admitted(), status: 'lost', reason: 'connection-lost' });
    expect(old.handle.status).not.toHaveProperty('actions');
    expect(old.handle.status?.action?.label).toBe(RECONNECT_LABEL);
    old.sink().scene(playerScene());
    old.atlas.ui!.clickToolbar(FIT_MAP_ITEM, old.view.viewId);
    expect(old.handle.cameras.at(-1)?.padded).toBe(false);
  });

  it("rolls the tray's dice through the session", async () => {
    const t = await setup();
    t.sink().session(admitted());
    expect(t.handle.rollFromTray({ d20: 1 }, 2)).toBeNull();
    expect(t.fake.sendDiceRoll).toHaveBeenCalledWith({ d20: 1 }, 2);
    expect(t.handle.options.maxDice).toBe(20);
    expect(t.handle.rollFromTray({ d6: 21 })).toBe('Roll 1 to 20 dice.');
    expect(t.handle.rollFromTray({ nope: 2 })).toBe(ROLL_DICE_COUNT_TEXT);
  });

  it('says so, and sends nothing, for a modifier the GM Atlas would not roll (a whole number within 1000)', async () => {
    const t = await setup();
    t.sink().session(admitted());
    expect(t.handle.rollFromTray({ d20: 1 }, 1000)).toBeNull();
    expect(t.handle.rollFromTray({ d20: 1 }, -1000)).toBeNull();
    t.fake.sendDiceRoll.mockClear();
    for (const modifier of [1001, -1001, 0.5, Number.NaN, 10_000]) expect(t.handle.rollFromTray({ d20: 1 }, modifier)).toBe(ROLL_MODIFIER_TEXT);
    expect(t.fake.sendDiceRoll).not.toHaveBeenCalled();
  });

  it("says why a roll did not go, from the session's state", async () => {
    const t = await setup();
    t.fake.sendDiceRoll.mockReturnValue(false);
    t.sink().session(admitted());
    expect(t.handle.rollFromTray({ d20: 1 })).toBe(ROLL_NOT_SENT_TEXT);
    t.sink().session({ ...admitted(), status: 'connecting' });
    expect(t.handle.rollFromTray({ d20: 1 })).toBe(ROLL_RECONNECTING_TEXT);
    t.sink().session({ ...admitted(), status: 'lost', reason: 'connection-lost' });
    expect(t.handle.rollFromTray({ d20: 1 })).toBe(ROLL_CONNECTION_LOST_TEXT);
    t.sink().session({ ...admitted(), status: 'lost', reason: 'ended' });
    expect(t.handle.rollFromTray({ d20: 1 })).toBe(ROLL_SESSION_ENDED_TEXT);
  });

  it('closes its view when the session is left from elsewhere', async () => {
    const t = await setup();
    t.sink().close();
    expect(t.handle.closed).toBe(true);
    expect(t.detach).toHaveBeenCalledOnce();
  });

  it('leaves the session when the player closes the view', async () => {
    const t = await setup();
    t.handle.close();
    expect(t.fake.leave).toHaveBeenCalledOnce();
    expect(t.detach).toHaveBeenCalledOnce();
    expect(t.atlas.ui!.counts().toolbar).toBe(0);
  });

  it('says it could not attach without a joined session', async () => {
    expect((await setup({ noSession: true })).attached).toBe(false);
  });

  it('dispose lets go of the session, the toolbar, the frames and the laser', async () => {
    const t = await setup();
    t.sink().scene(playerScene());
    t.sink().images();
    t.client.dispose();
    expect(t.detach).toHaveBeenCalledOnce();
    expect(t.pendingFrames()).toBe(0);
    expect(t.atlas.lasers.listening(t.view.viewId)).toBe(0);
    expect(t.atlas.ui!.counts().toolbar).toBe(0);
    const calls = t.handle.calls.length;
    t.sink().scene(playerScene({ sceneId: 'scene-2' }));
    t.sink().session(admitted());
    expect(t.handle.calls.length).toBe(calls);
  });
  it('keeps showing the images of the last scene Atlas took when it refuses the next one', async () => {
    const revoked: string[] = [];
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: (url: string) => { revoked.push(url); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const t = await setup({ images: { background: (id) => (id ? `blob:map/${id}` : null), token: () => null } });
      t.sink().scene(playerScene({ map: { asset: 'refused-test', width: 1000, height: 800, cellSize: 70 } }));
      // The loader lets the map image go as the next scene arrives.
      shownUrls.revoke('blob:map/refused-test');
      expect(revoked).toEqual([]);
      // Atlas refuses a map wider than it shows: the scene it has still shows the old image.
      t.sink().scene(playerScene({ sceneId: 'scene-2', map: { asset: 'other', width: 200_000, height: 800, cellSize: 70 } }));
      expect(t.handle.scene?.background.url).toBe('blob:map/refused-test');
      expect(revoked).toEqual([]);
      t.sink().scene(playerScene({ sceneId: 'scene-3', map: { asset: 'other', width: 1000, height: 800, cellSize: 70 } }));
      expect(revoked).toEqual(['blob:map/refused-test']);
      t.client.dispose();
    } finally {
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });

  it('keeps following when Fit map has nothing to fit', async () => {
    const t = await setup();
    t.sink().scene(playerScene({ map: { asset: null, width: 0, height: 0, cellSize: 70 }, grid: null, tokens: {} }));
    const asked = t.handle.count('setCamera');
    t.atlas.ui!.clickToolbar(FIT_MAP_ITEM, t.view.viewId);
    expect(t.handle.count('setCamera')).toBe(asked);
    expect(t.atlas.ui!.drawToolbar(t.view.viewId).find((item) => item.id === FOLLOW_GM_ITEM)?.active).toBe(true);
  });

  it('the remote view status says the scene is paused', async () => {
    const t = await setup();
    t.sink().session(admitted());
    t.sink().scene(playerScene());
    t.sink().paused?.(true);
    expect(t.handle.status?.message).toBe(PAUSED_BANNER);
    t.sink().paused?.(false);
    expect(t.handle.status?.message).toBeNull();
  });

  it('labels a roll with its scene in Atlas\'s dice log', async () => {
    const t = await setup();
    t.sink().diceLog([{ id: 'r1', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 11 }], modifier: 0, total: 11, at: 1000, scene: 'Cave' }]);
    expect((t.handle.diceLog[0] as { rolledBy: string }).rolledBy).toBe('Anna · Cave');
  });

  describe("the GM's dice look", () => {
    const WITH_LOOKS = [...REMOTE_CAPABILITIES, 'dice-look-choice' as const];

    it('sets it on the remote view once, and null again when the GM has none', async () => {
      const t = await setup({ capabilities: WITH_LOOKS });
      t.sink().diceLook?.(null);
      expect(t.handle.count('setDiceLook')).toBe(0);
      t.sink().diceLook?.('bones-ext:bones');
      t.sink().diceLook?.('bones-ext:bones');
      expect(t.handle.diceLook).toBe('bones-ext:bones');
      expect(t.handle.count('setDiceLook')).toBe(1);
      t.sink().diceLook?.(null);
      expect(t.handle.diceLook).toBeNull();
      expect(t.handle.count('setDiceLook')).toBe(2);
    });

    it("leaves the player's own look on an Atlas without setDiceLook", async () => {
      const t = await setup();
      expect(t.view.setDiceLook).toBeUndefined();
      expect(() => t.sink().diceLook?.('bones-ext:bones')).not.toThrow();
      expect(t.handle.diceLook).toBeNull();
    });

    it('logs a look Atlas refuses and goes on', async () => {
      const t = await setup({ capabilities: WITH_LOOKS });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      t.sink().diceLook?.('x'.repeat(301));
      expect(logged).toHaveBeenCalled();
      t.sink().diceLook?.('bones-ext:bones');
      expect(t.handle.diceLook).toBe('bones-ext:bones');
    });
  });
});
