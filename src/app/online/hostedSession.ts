/**
 * One hosted session, from the host transport to its handlers: the body of `OnlineSessionService.start`.
 * The scene hub, the camera sender and the asset server always run. Token control (needs Atlas's `tokens`),
 * players' dice and lasers (B7) are optional parts: each starts only when its dep is given, and without
 * it the session runs without that feature (no token assignments, no dice, no lasers relayed).
 */
import type { ViewsApi } from '@atlas-vtt/api-types';
import { Notice } from 'obsidian';
import { AssetServer } from './assets/AssetServer';
import type { TokenControl } from './control/TokenControl';
import { GmSession, type SessionPlayer } from './GmSession';
import { buildJoinUrl, parseJoinFragment } from './joinLink';
import { createOnlineLog, loggedSession, logPresentedScene } from './onlineLog';
import { onlineSessionStore } from './onlineSessionStore';
import { peerServerOptions, type OnlineSettings } from './onlineSettings';
import { normalizePlayerName } from './protocol';
import { AssetRegistry } from './scene/AssetRegistry';
import { CameraSender } from './scene/CameraSender';
import { SceneHub, type SceneProjectionOptions } from './scene/SceneHub';
import type { ImageFiles, SceneSession } from './scene/sceneContracts';
import type { TabScenes } from './atlas/tabScenes';
import { SceneAssignments } from './split/SceneAssignments';
import type { IdentityCrypto, TableIdentity } from './sharing/identity/identityCrypto';
import { hostedTable, tableReissuer, type HostedTable } from './sharing/identity/reissue';
import { HostIdentity } from './sharing/people/hostIdentity';
import { IdentityDesk } from './sharing/people/IdentityDesk';
import type { PeopleBook } from './sharing/people/PeopleBook';
import type { PeerServerOptions } from './transport/PeerTransport';
import type { HostTransport } from './transport/types';
import type { JoinRequestInfo } from './ui/joinRequestNotice';

const BAD_PAGE_URL = "The player page address in Atlas VTT Connect's settings isn't a valid web address.";
const RELAY_TOO_LONG = 'Your relay (TURN) settings are too long for a join link — remove some.';

/** Sharing joins a hosted session that has a table; `started` returns what stops it. */
export interface HostedSharingHooks {
  started(context: { session: GmSession; table: HostedTable }): () => void;
}

/** What an optional part of the session gets: the session (through the log), the presented scene, what players have. */
export interface HostedContext {
  session: SceneSession;
  presented: SceneProjectionOptions['presented'];
  projection: SceneHub;
}

export interface HostedPart {
  start(): void;
  stop(): void;
  /** The session's players changed; a kick reaches no handler, so parts that track players learn it here. */
  playersChanged?(players: readonly SessionPlayer[]): void;
}

/** Parts later features bring; each is started only when given. */
export interface OptionalParts {
  /** Players move the tokens the GM assigns them, through Atlas's `tokens.move`. Without it nobody controls a token. */
  tokenControl?: (context: HostedContext) => HostedPart & { readonly control: TokenControl };
  /** Players' dice, rolled and logged through Atlas's dice (B7). Without it players cannot roll. */
  dice?: (context: HostedContext) => HostedPart;
  /** Players' lasers and the GM's (B7). Without it no laser is relayed. */
  laser?: (context: HostedContext) => HostedPart;
}

export interface HostEnvironment extends OptionalParts {
  settings: { get(): OnlineSettings };
  vaultName: string;
  createHost(options: PeerServerOptions): Promise<HostTransport>;
  loadTable(): Promise<TableIdentity | null>;
  identityCrypto: IdentityCrypto;
  /** The people list; without it the session has no identity desk and hosts without sharing. */
  people?: PeopleBook;
  showRequest(player: SessionPlayer, answer: (allow: boolean) => void, info?: JoinRequestInfo): { hide(): void };
  images: ImageFiles;
  views: Pick<ViewsApi, 'list'>;
  scene: Omit<SceneProjectionOptions, 'session' | 'assets' | 'notify'> & {
    /** The GM's scene tabs for this session (Atlas's `scene-tabs`); without it there is no split party. */
    tabScenes?: () => TabScenes;
  };
  /** Whether this start is still the current one; a later stop or start makes it stale. */
  isCurrent(): boolean;
}

/** A running session; `stop` releases everything it holds, the store is left to the caller. */
export interface HostedSession {
  readonly session: GmSession;
  readonly requests: HostIdentity;
  readonly table: HostedTable | null;
  readonly hostId: string;
  readonly joinUrl: string;
  /** The note to show while hosting: the join link is too long to work, or none. */
  readonly linkError: string | null;
  readonly tokenControl: TokenControl | null;
  /** Which scene each player sees, and the split party's assignments. */
  readonly scenes: SceneHub;
  stop(): void;
}

/**
 * Starts hosting; null when a stop or a newer start made this one stale (its host is closed). The caller
 * holds the session before it tells the UI it is hosting, so a stop from a store listener finds it.
 */
export async function hostSession(env: HostEnvironment, sharing: HostedSharingHooks | null): Promise<HostedSession | null> {
  const online = env.settings.get();
  const host = await env.createHost(peerServerOptions(online));
  if (!env.isCurrent()) {
    host.close();
    return null;
  }
  let identity: TableIdentity | null = null;
  try {
    identity = env.people ? await env.loadTable() : null;
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not prepare the table key; hosting without sharing:', error);
  }
  if (!env.isCurrent()) {
    host.close();
    return null;
  }
  const table = identity ? hostedTable(env.identityCrypto, identity, host.id, () => normalizePlayerName(env.settings.get().playerName) ?? 'GM') : null;
  let current: GmSession | null = null;
  const requests = new HostIdentity({
    desk: table && env.people ? new IdentityDesk({ people: env.people, table }) : null,
    session: () => current,
    showRequest: (player, answer, info) => env.showRequest(player, answer, info),
  });
  let joinUrl: string;
  let linkWorks: boolean;
  try {
    joinUrl = buildJoinUrl(online.playerPageUrl, host.id, online, identity?.id ?? null);
    linkWorks = parseJoinFragment(new URL(joinUrl).hash) !== null;
  } catch {
    host.close();
    throw new Error(BAD_PAGE_URL);
  }
  const parts: HostedPart[] = [];
  // Diagnostics (Connect's "Log online play events" setting), read on every event.
  const log = createOnlineLog(() => env.settings.get().logEvents);
  const session = new GmSession(host, {
    title: env.vaultName,
    // A person admitted with an id who joins again on a new join gets a fresh table proof for its nonce.
    ...(table ? { reissue: tableReissuer(table) } : {}),
    onJoinRequest: (player, device) => requests.joinRequest(player, device),
    onRequestClosed: (playerId) => requests.requestClosed(playerId),
    onPlayersChanged: (players) => {
      log.event('players', { players: players.map((player) => `${player.name}: ${player.status}`).join(', ') });
      for (const part of parts) part.playersChanged?.(players);
      onlineSessionStore.setState({ players, error: null });
    },
  });
  current = session;
  // Signaling hiccups while hosting are not fatal: keep hosting, show the note.
  const stopErrors = host.onError((error) => {
    if (env.isCurrent()) onlineSessionStore.setState({ error: error.message });
  });
  session.start();
  const notify = (message: string): void => { new Notice(message); };
  // One registry per session: fingerprints are cached for the session, the size notice shows once.
  const registry = new AssetRegistry({ files: env.images, notify });
  // The scene hub and the camera sender send through the log, so diagnostics see every scene message.
  const scenes = loggedSession(session, log);
  const { tabScenes, ...sceneOptions } = env.scene;
  const tabs = tabScenes?.() ?? null;
  const hub = new SceneHub({ ...sceneOptions, session: scenes, assets: registry, notify, tabs, assignments: new SceneAssignments() });
  const context: HostedContext = { session: scenes, presented: env.scene.presented, projection: hub };
  // The GM's view of the presented scene, which players follow by default; started after the scene hub.
  const cameraSender = new CameraSender({ session: scenes, presented: env.scene.presented, projection: hub });
  // Serves the images of the scene players have, over each player's assets channel.
  const assetServer = new AssetServer({ session, projection: hub, files: registry });
  // Started in this order, after the asset server: control lists follow snapshots and cameras, dice and lasers come last.
  const tokenControl = env.tokenControl?.(context) ?? null;
  const dice = env.dice?.(context) ?? null;
  const laser = env.laser?.(context) ?? null;
  const given = (list: Array<HostedPart | null>): HostedPart[] => list.filter((part): part is HostedPart => part !== null);
  let stopSharing: (() => void) | null = null;
  let stopLog: (() => void) | null = null;
  const stop = (): void => {
    stopSharing?.();
    stopSharing = null;
    stopErrors();
    assetServer.stop();
    for (const part of given([tokenControl, laser, dice])) part.stop();
    cameraSender.stop();
    stopLog?.();
    stopLog = null;
    hub.stop();
    tabs?.dispose();
    registry.dispose();
    session.stop();
    current = null;
    requests.stop();
  };
  try {
    stopLog = logPresentedScene(env.scene.presented, env.views, log);
    hub.start();
    cameraSender.start();
    assetServer.start();
    for (const part of given([tokenControl, dice, laser])) {
      part.start();
      parts.push(part);
    }
    if (table && sharing) stopSharing = sharing.started({ session, table });
  } catch (error) {
    // No session may keep running without its scene hub; `start` reports the error.
    stop();
    throw error;
  }
  return {
    session, requests, table, hostId: host.id, joinUrl, linkError: linkWorks ? null : RELAY_TOO_LONG, tokenControl: tokenControl?.control ?? null,
    scenes: hub, stop,
  };
}
