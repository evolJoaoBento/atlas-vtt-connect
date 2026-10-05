/**
 * Where the remote view's own drag drops a token of a scene players received: the scene fed as Connect feeds it
 * (`toRemoteScene`), and FakeAtlas's remote view snapping the drop over that grid as Atlas's `remoteDrag` does
 * (`snapDroppedToken`, the same snap as `tokens.snapPoint`).
 */
import type { Point } from '@atlas-vtt/api-types';
import { RemoteSceneMemo, remotePlayerState } from '../../../src/app/online/obsidian/remote/toRemoteScene';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';
import { playerToken } from './sceneFixtures';

export async function remoteDropPoint(scene: PlayerScene, point: Point, size: number): Promise<Point | null> {
  const atlas = new FakeAtlas({ capabilities: ['views', 'remote-view'] });
  const view = await atlas.connect(connectingPlugin('atlas-vtt-connect')).remoteViews!.open({ title: 'Online scene' });
  view.setScene(new RemoteSceneMemo().input({ ...scene, tokens: { dragged: playerToken({ size }) } }, { background: () => null, token: () => null }));
  view.setPlayer(remotePlayerState(scene, ['dragged']));
  let landed: Point | null = null;
  view.onTokenDrop((move) => { landed = { x: move.x, y: move.y }; });
  atlas.remoteViews.latest().drop('dragged', point);
  return landed;
}
