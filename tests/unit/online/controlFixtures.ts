/**
 * A GM with the real session and `ControlLists` over an in-memory network, and a small stand-in for the
 * move handler (which needs the scene store): it accepts a move of a token the player controls and refuses
 * every other. Players are real `PlayerSession`s. The full world (broadcaster, `TokenControlHost`) comes with
 * the session service.
 */
import { vi } from 'vitest';
import { ControlLists } from '../../../src/app/online/control/ControlLists';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, type PlayerSessionOptions } from '../../../src/app/online/PlayerSession';
import { decodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { playerScene, sceneBody } from './sceneFixtures';

export interface ControlPlayer {
  key: string;
  playerId: string;
  session: PlayerSession;
  /** Every control message the GM sent this player, on every link, decoded. */
  received: ControlMessage[];
  sendRaw(text: string): void;
  controlLists(): string[][];
}

export function controlWorld() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const control = new TokenControl();
  const moves: Array<{ playerId: string; tokenId: string; x: number; y: number }> = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {},
    // As the token control host does: a removed player loses their tokens.
    onPlayersChanged: (players) => control.retainPlayers(new Set(players.map((player) => player.playerId))),
  });
  gm.start();
  const lists = new ControlLists({ session: gm, control });
  lists.start();
  gm.use({
    onMessage: (player, message) => {
      if (message.type !== 'token-move') return;
      if (control.tokensOf(player.playerId).includes(message.tokenId)) moves.push({ playerId: player.playerId, tokenId: message.tokenId, x: message.x, y: message.y });
      else gm.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId });
    },
  });
  const players: ControlPlayer[] = [];

  const join = async (key: string, extra: Partial<PlayerSessionOptions> = {}): Promise<ControlPlayer> => {
    const before = requests.length;
    const inner = network.client();
    const received: ControlMessage[] = [];
    let link: PeerLink | null = null;
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const next = await inner.connect(hostId);
        link = next;
        next.onMessage((channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') received.push(decoded.message);
        });
        return next;
      },
    };
    const session = new PlayerSession({ hostId: 'gm', name: key, playerKey: key, clientVersion: '1', transport, onChange: () => {}, ...extra });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
    const player: ControlPlayer = {
      key, playerId: session.state.playerId!, session, received,
      sendRaw: (text) => { link?.send('control', text); },
      controlLists: () => received.flatMap((message) => (message.type === 'token-control' ? [message.tokenIds] : [])),
    };
    players.push(player);
    return player;
  };

  return {
    network, gm, control, moves, join,
    /** Gives the player the standard test scene (scene id `scene-1`). */
    showScene(player: ControlPlayer): void {
      const scene = playerScene();
      gm.send(player.playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    },
    finish(): void {
      players.forEach((player) => player.session.stop());
      lists.stop();
      gm.stop();
    },
  };
}
