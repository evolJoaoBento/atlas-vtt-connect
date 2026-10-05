/**
 * A GM with the real session, the scene broadcaster and the token control host (the control lists, the
 * moves through `tokens.move` of a fake Atlas, deleted tokens dropped) over an in-memory network, as the
 * session service starts them. A fake view's store holds the scene; Atlas's moves land in it and in the
 * fake's undo steps (`undoSteps`, `undo`). Players are real `PlayerSession`s.
 */
import { vi } from 'vitest';
import type { TokenEntity } from '@atlas-vtt/api-types';
import { TokenControlHost } from '../../../src/app/online/control/TokenControlHost';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, type PlayerSessionOptions } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, presenter, sceneView, type ViewState } from './presentedFixtures';

/** hero and ally in the open, orc hidden, goblin under the fog rectangle from (900, 900) to (1300, 1300). */
export function partyTokens(): Record<string, TokenEntity> {
  return {
    hero: { id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: 'Hero' },
    ally: { id: 'ally', kind: 'character', x: 280, y: 140, imagePath: 'art/ally.png', name: 'Ally' },
    orc: { id: 'orc', kind: 'character', x: 420, y: 140, imagePath: 'art/orc.png', name: 'Orc', isHidden: true },
    goblin: { id: 'goblin', kind: 'character', x: 1050, y: 1050, imagePath: 'art/goblin.png', name: 'Goblin' },
  } as Record<string, TokenEntity>;
}

/** A square 70 px grid with snapping on (the default), the party, and one fog rectangle. */
export function partyState(tokens: Record<string, TokenEntity> = partyTokens()): ViewState {
  const state = emptySceneState();
  return {
    ...state,
    objects: {
      ...state.objects,
      tokens,
      fog: { f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 } } as unknown as ViewState['objects']['fog'],
    },
  };
}

/** What a control world's presented scene can be given: its scene, the map's size and the rules of the players' view. */
export interface ControlScene {
  state?: ViewState;
  mapSize?: { width: number; height: number };
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
  return { presented, broadcaster, ...sceneView(presented, options.state ?? partyState(), { mapSize: options.mapSize ?? { width: 2000, height: 1500 } }) };
}

export interface ControlPlayer {
  key: string;
  playerId: string;
  session: PlayerSession;
  /** Every control message the GM sent this player, on every link, decoded. */
  received: ControlMessage[];
  /** Sends text on the player's current link, as a modified page could. */
  sendRaw(text: string): void;
  /** A `token-move` on the player's current link, for the scene players have unless `sceneId` is given. */
  move(tokenId: string, x: number, y: number, sceneId?: string): void;
  refusals(): string[];
  controlLists(): string[][];
}

export function controlWorld(options: { scene?: ControlScene } = {}) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  let host: TokenControlHost | null = null;
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {},
    // As the hosted session does: a removed player loses their tokens.
    onPlayersChanged: (players) => host?.playersChanged(players),
  });
  gm.start();
  const scene = presentedScene(gm, options.scene ?? {});
  const { tokens } = scene.presented.extension;
  const controlHost = new TokenControlHost({ session: gm, presented: scene.presented, projection: scene.broadcaster, tokens });
  host = controlHost;
  controlHost.start();
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
      move: (tokenId, x, y, sceneId = scene.broadcaster.currentProjection()?.sceneId ?? 'none') => {
        link?.send('control', encodeControl({ v: 1, type: 'token-move', sceneId, tokenId, x, y }));
      },
      refusals: () => received.flatMap((message) => (message.type === 'token-move-refused' ? [message.tokenId] : [])),
      controlLists: () => received.flatMap((message) => (message.type === 'token-control' ? [message.tokenIds] : [])),
    };
    players.push(player);
    return player;
  };

  return {
    network, gm, join, scene, atlas: scene.presented.atlas,
    host: controlHost, control: controlHost.control, broadcaster: scene.broadcaster, presented: scene.presented, store: scene.store,
    tabs: scene.tabs, tavern: scene.tavern, dungeon: scene.dungeon,
    /** Presents the Tavern tab. */
    present(): void {
      scene.presented.present(scene.view, scene.tavern);
    },
    /** The token as the GM's store holds it, Atlas's moves included. */
    token: (id: string) => scene.store.getState().objects.tokens[id],
    /** How many GM undo steps Atlas's moves left, and the GM's undo of the last one. */
    undoSteps: (): number => scene.presented.atlas.tokens.undoSteps(scene.view),
    undo: (): void => scene.presented.atlas.tokens.undo(scene.view),
    /** Lets the broadcaster send what changed. */
    tick: async (): Promise<void> => { await vi.advanceTimersByTimeAsync(SCENE_TICK_MS + 5); },
    finish(): void {
      players.forEach((player) => player.session.stop());
      controlHost.stop();
      scene.broadcaster.stop();
      gm.stop();
    },
  };
}

export type ControlWorld = ReturnType<typeof controlWorld>;
