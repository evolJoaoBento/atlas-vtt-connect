/**
 * The session's other parts over a split world (`splitFixtures`), built as `hostedSession` builds them and started in
 * its order, after the scene hub: the camera sender, then the token control host, the dice host and the laser relay.
 * Each helper starts its part and gives it back.
 */
import type { ControlMessage } from '../../../src/app/online/protocol';
import { CameraSender } from '../../../src/app/online/scene/CameraSender';
import type { RawPlayer, SplitWorld } from './splitFixtures';
import { VIEW } from './splitFixtures';

export function cameraPart(w: SplitWorld): CameraSender {
  const sender = new CameraSender({ session: w.gm, presented: w.presented, projection: w.hub, tabs: w.tabs });
  sender.start();
  return sender;
}

/** The GM's view shows `centerX` and moves: one rendered frame. */
export function moveCamera(w: SplitWorld, centerX: number): void {
  w.atlas.views.setCamera(VIEW, { centerX, centerY: 500, width: 800, height: 600 });
  w.atlas.views.frame(VIEW);
}

type Camera = Extract<ControlMessage, { type: 'scene-camera' }>;

/** The cameras a player got, from `from` on. */
export function camerasOf(player: RawPlayer, from = 0): Camera[] {
  return player.received.slice(from).filter((message): message is Camera => message.type === 'scene-camera');
}
