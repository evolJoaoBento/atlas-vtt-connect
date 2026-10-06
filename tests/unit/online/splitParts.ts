/**
 * The session's other parts over a split world (`splitFixtures`), built as `hostedSession` builds them and started in
 * its order, after the scene hub: the camera sender, then the token control host, the dice host and the laser relay.
 * Each helper starts its part and gives it back.
 */
import type { DiceRollRequest } from '@atlas-vtt/api-types';
import { diceHostPart, laserRelayPart } from '../../../src/app/online/atlas/toolParts';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import { decodeAsset, encodeAsset, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { TokenControlHost } from '../../../src/app/online/control/TokenControlHost';
import type { HostedContext, HostedPart } from '../../../src/app/online/hostedSession';
import { encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { CameraSender } from '../../../src/app/online/scene/CameraSender';
import { fingerprintOf } from './assetFixtures';
import type { RawPlayer, SplitWorld } from './splitFixtures';
import { IMAGES, VIEW } from './splitFixtures';

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

export function assetPart(w: SplitWorld): AssetServer {
  const server = new AssetServer({ session: w.gm, projection: w.hub, files: w.registry });
  server.start();
  return server;
}

/** The fingerprint players are sent for an image of `IMAGES`. */
export const idOf = (path: string): string => fingerprintOf(IMAGES[path]!);

export interface AssetClient {
  request(paths: string[]): void;
  /** Each asset message the player got: its type and the image's path, by fingerprint (`asset-end` has none). */
  log(): string[];
}

/** A player's assets channel, from now on: what they ask for and what the GM answers. */
export function assetClient(player: RawPlayer): AssetClient {
  const messages: AssetMessage[] = [];
  const handles = new Map<number, string>();
  const pathOf = (id: string): string => Object.keys(IMAGES).find((path) => idOf(path) === id) ?? id;
  player.link.onMessage((channel, data) => {
    if (channel !== 'assets') return;
    const decoded = decodeAsset(data);
    if (decoded.kind === 'message') messages.push(decoded.message);
  });
  return {
    request: (paths) => player.link.send('assets', encodeAsset({ v: 1, type: 'asset-request', ids: paths.map(idOf) })),
    log: () => messages.map((message) => {
      if (message.type === 'asset-start') handles.set(message.handle, pathOf(message.id));
      if (message.type === 'asset-end') return `end:${handles.get(message.handle) ?? '?'}`;
      return 'id' in message ? `${message.type}:${pathOf(message.id)}` : message.type;
    }),
  };
}

export function tokenPart(w: SplitWorld): TokenControlHost {
  const host = new TokenControlHost({ session: w.gm, projection: w.hub, tokens: w.extension.tokens });
  host.start();
  return host;
}

/** The token lists a player got, from `from` on. */
export function listsOf(player: RawPlayer, from = 0): string[][] {
  return player.received.slice(from).flatMap((message) => (message.type === 'token-control' ? [message.tokenIds] : []));
}

/** The player drops `tokenId` at `x`, stamped with `sceneId`. */
export function dropToken(player: RawPlayer, sceneId: string, tokenId: string, x: number): void {
  player.link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId, tokenId, x, y: 140 }));
}

type Laser = Extract<ControlMessage, { type: 'laser' }>;
type DiceLog = Extract<ControlMessage, { type: 'dice-log' }>;

/** The player tools as the hosted session builds them: the dice host, then the laser relay. `rolls` records every request. */
export function toolParts(w: SplitWorld, rolls: DiceRollRequest[] = []): { dice: HostedPart; lasers: HostedPart } {
  const context: HostedContext = { session: w.gm, presented: w.presented, projection: w.hub };
  const atlasDice = w.extension.dice;
  const dice = diceHostPart({ ...atlasDice, roll: (request) => { rolls.push(request); return atlasDice.roll(request); } })(context);
  const lasers = laserRelayPart(w.extension.lasers, w.extension.settings)(context);
  dice.start();
  lasers.start();
  return { dice, lasers };
}

export const lasersOf = (player: RawPlayer, from = 0): Laser[] => player.received.slice(from).filter((message): message is Laser => message.type === 'laser');
export const logsOf = (player: RawPlayer, from = 0): DiceLog[] => player.received.slice(from).filter((message): message is DiceLog => message.type === 'dice-log');

/** The player's laser at `x`, stamped with `sceneId`. */
export function sendLaser(player: RawPlayer, sceneId: string, x: number, lifted = false): void {
  player.link.send('control', encodeControl({ v: 1, type: 'laser', sceneId, points: [{ x, y: 10 }], lifted }));
}

/** The player rolls one d6 from the tray. */
export function rollD6(player: RawPlayer): void {
  player.link.send('control', encodeControl({ v: 1, type: 'dice-roll', dice: { d6: 1 }, modifier: 0 }));
}
