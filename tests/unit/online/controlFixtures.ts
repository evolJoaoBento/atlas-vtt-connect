/**
 * A GM with the real session and `ControlLists` over an in-memory network, and a small stand-in for the
 * move handler (which needs `tokens.move`, plan B10): it accepts a move of a token the player controls and
 * refuses every other. Players are real `PlayerSession`s. With a presented scene the world also runs the
 * scene broadcaster, registered before the lists as the session service does, and drops the assignments of
 * tokens deleted from the presented scene (`watchDeletedTokens`), as the token control host will.
 */
import { vi } from 'vitest';
import type { TokenEntity } from '@atlas-vtt/api-types';
import { ControlLists } from '../../../src/app/online/control/ControlLists';
import { watchDeletedTokens } from '../../../src/app/online/control/deletedTokens';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, type PlayerSessionOptions } from '../../../src/app/online/PlayerSession';
import { decodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, presenter, sceneView, type ViewState } from './presentedFixtures';
import { playerScene, sceneBody } from './sceneFixtures';

/** hero and ally in the open, orc hidden. */
export function partyTokens(): Record<string, TokenEntity> {
  return {
    hero: { id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: 'Hero' },
    ally: { id: 'ally', kind: 'character', x: 280, y: 140, imagePath: 'art/ally.png', name: 'Ally' },
    orc: { id: 'orc', kind: 'character', x: 420, y: 140, imagePath: 'art/orc.png', name: 'Orc', isHidden: true },
  };
}

/** The party on the Tavern map, loaded. */
export function partyState(tokens: Record<string, TokenEntity> = partyTokens()): ViewState {
  const state = emptySceneState();
  return { ...state, objects: { ...state.objects, tokens } };
}

/** What a control world's presented scene can be given: its scene, and the rules of the players' view. */
export interface ControlScene {
  state?: ViewState;
  rules?: Partial<PlayerViewRules>;
}

/** The presented scene of a control world: the broadcaster, the presenter and the view. */
function presentedScene(gm: GmSession, options: ControlScene) {
  const presented = presenter();
  const rules: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true, ...options.rules };
  const settings = { getLocalPlayerViewSettings: () => rules, onChange: () => () => {} };
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: () => {} });
  broadcaster.start();
  return { presented, broadcaster, ...sceneView(presented, options.state ?? partyState(), { mapSize: { width: 2000, height: 1500 } }) };
}

export interface ControlPlayer {
  key: string;
  playerId: string;
  session: PlayerSession;
  /** Every control message the GM sent this player, on every link, decoded. */
  received: ControlMessage[];
  sendRaw(text: string): void;
  controlLists(): string[][];
}

export function controlWorld(options: { scene?: boolean | ControlScene } = {}) {
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
  const scene = options.scene ? presentedScene(gm, options.scene === true ? {} : options.scene) : null;
  const lists = new ControlLists({ session: gm, control });
  lists.start();
  const stopDeleted = scene ? watchDeletedTokens(scene.presented, control) : () => undefined;
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
    /** The presented scene; only with `scene: true`. */
    scene,
    /** Presents the Tavern tab; only with `scene: true`. */
    present(): void {
      scene?.presented.present(scene.view, scene.tavern);
    },
    /** Gives the player the standard test scene (scene id `scene-1`). */
    showScene(player: ControlPlayer): void {
      const scene = playerScene();
      gm.send(player.playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    },
    finish(): void {
      players.forEach((player) => player.session.stop());
      stopDeleted();
      lists.stop();
      scene?.broadcaster.stop();
      gm.stop();
    },
  };
}
