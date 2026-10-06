import type { App } from 'obsidian';
import type { CollectionGridDefaults, InitiativeRules, ResourceDefinition, ViewsApi } from '@atlas-vtt/api-types';
import { vaultImageFiles } from './assets/vaultImageFiles';
import type { GmSession, SessionPlayer } from './GmSession';
import { hostSession, type HostedSession, type HostedSharingHooks, type OptionalParts } from './hostedSession';
import { onlineSessionStore, resetOnlineSessionStore } from './onlineSessionStore';
import type { OnlineSettings } from './onlineSettings';
import type { PresentedSceneSource } from './atlas/presentedSource';
import type { TabScenes } from './atlas/tabScenes';
import type { ImageFiles } from './scene/sceneContracts';
import type { LightingSource } from './scene/sceneLighting';
import type { PlayerViewSettingsSource } from './scene/sceneSources';
import { webIdentityCrypto, type IdentityCrypto, type TableIdentity } from './sharing/identity/identityCrypto';
import type { HostedTable } from './sharing/identity/reissue';
import { ensureTableIdentity } from './sharing/identity/tableKey';
import type { PeopleBook } from './sharing/people/PeopleBook';
import { createPeerHost, type PeerServerOptions } from './transport/PeerTransport';
import type { HostTransport } from './transport/types';
import { showJoinRequestNotice, type JoinRequestInfo } from './ui/joinRequestNotice';

export type { HostedSharingHooks } from './hostedSession';

const HOSTING_WHILE_JOINED = 'Leave the online session you joined before hosting one.';

/** Connect's own settings, as `ConnectSettingsStore` keeps them. */
export interface SessionSettings {
  get(): OnlineSettings;
  set(partial: Partial<OnlineSettings>): void;
}

export interface Deps extends OptionalParts {
  /** Which scene players see (`presentedSource`). */
  presented: PresentedSceneSource;
  /** Atlas's player view settings, which decide what players see of the scene. */
  playerViewSettings: PlayerViewSettingsSource;
  /** Atlas's map views; the online log reads the active tab. */
  views: Pick<ViewsApi, 'list'>;
  /** Whether this Obsidian is in a session it joined (`joinedSessionStore`); without it, never. */
  isJoined?: () => boolean;
  createHost?: (options: PeerServerOptions) => Promise<HostTransport>;
  showRequest?: (player: SessionPlayer, answer: (allow: boolean) => void, info?: JoinRequestInfo) => { hide(): void };
  /** The people list, in Connect's storage folder; without it the session hosts without sharing. */
  people?: PeopleBook;
  /** The vault's images; tests pass their own. */
  images?: ImageFiles;
  /** What a lit scene hides from players; without it a lit scene shows players only the dark map. */
  lighting?: LightingSource;
  collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null;
  coneAngle?: (mapPath: string | null) => number;
  resources?: (mapPath: string | null) => readonly ResourceDefinition[];
  initiativeRules?: (mapPath: string | null) => InitiativeRules;
  /** Tells when those resources or rules may have changed. */
  watchResources?: (listener: () => void) => () => void;
  /** The GM's scene tabs, one per hosted session (Atlas's `scene-tabs`); without it there is no split party. */
  tabScenes?: () => TabScenes;
  /** The GM's table key; made in the settings on first use unless a test passes its own (or none). */
  table?: () => Promise<TableIdentity | null>;
  identityCrypto?: IdentityCrypto;
}

function errorText(error: unknown): string {
  return error instanceof Object && 'message' in error ? String(error.message) : String(error);
}

/** Hosts one online session for the vault at a time; the UI reads `onlineSessionStore`. */
export class OnlineSessionService {
  private static instances = new WeakMap<App, OnlineSessionService>();
  static forApp(app: App): OnlineSessionService | undefined {
    return this.instances.get(app);
  }

  private hosted: HostedSession | null = null;
  private generation = 0;
  private sharingHooks: HostedSharingHooks | null = null;
  private readonly identityCrypto: IdentityCrypto;
  private readonly images: ImageFiles;

  constructor(private readonly app: App, private readonly settings: SessionSettings, private readonly deps: Deps) {
    this.identityCrypto = deps.identityCrypto ?? webIdentityCrypto;
    this.images = deps.images ?? vaultImageFiles(app);
    OnlineSessionService.instances.set(app, this);
  }

  /** Forgets this service as the app's, when Atlas unloads (a newer one may have taken its place). */
  release(): void {
    if (OnlineSessionService.instances.get(this.app) === this) OnlineSessionService.instances.delete(this.app);
  }

  /** Sharing's hooks for every session hosted from now on (`registerSharing`). */
  useSharingHooks(hooks: HostedSharingHooks | null): void {
    this.sharingHooks = hooks;
  }

  get session(): GmSession | null {
    return this.hosted?.session ?? null;
  }

  /** This Atlas's table while hosting (never its private key); null otherwise or when it has none. */
  get table(): HostedTable | null { return this.hosted?.table ?? null; }

  /** The current host id while hosting. */
  get hostId(): string | null { return this.hosted?.hostId ?? null; }

  async start(): Promise<void> {
    if (this.hosted || onlineSessionStore.getState().status === 'starting') return;
    if (this.deps.isJoined?.() === true) {
      onlineSessionStore.setState({ status: 'error', error: HOSTING_WHILE_JOINED });
      return;
    }
    onlineSessionStore.setState({ status: 'starting', error: null });
    const generation = ++this.generation;
    const { deps } = this;
    try {
      const hosted = await hostSession({
        ...(deps.tokenControl ? { tokenControl: deps.tokenControl } : {}),
        ...(deps.dice ? { dice: deps.dice } : {}),
        ...(deps.laser ? { laser: deps.laser } : {}),
        ...(deps.people ? { people: deps.people } : {}),
        settings: this.settings,
        vaultName: this.app.vault.getName(),
        createHost: deps.createHost ?? createPeerHost,
        loadTable: deps.table ?? ((): Promise<TableIdentity | null> => ensureTableIdentity(this.settings, this.identityCrypto)),
        identityCrypto: this.identityCrypto,
        showRequest: deps.showRequest ?? showJoinRequestNotice,
        images: this.images,
        views: deps.views,
        scene: {
          presented: deps.presented, settings: deps.playerViewSettings,
          ...(deps.lighting ? { lighting: deps.lighting } : {}),
          ...(deps.collectionGrid ? { collectionGrid: deps.collectionGrid } : {}),
          ...(deps.coneAngle ? { coneAngle: deps.coneAngle } : {}),
          ...(deps.resources ? { resources: deps.resources } : {}),
          ...(deps.initiativeRules ? { initiativeRules: deps.initiativeRules } : {}),
          ...(deps.watchResources ? { watchResources: deps.watchResources } : {}),
          ...(deps.tabScenes ? { tabScenes: deps.tabScenes } : {}),
        },
        isCurrent: () => generation === this.generation,
      }, this.sharingHooks);
      if (generation !== this.generation) {
        hosted?.stop();
        return;
      }
      if (!hosted) return;
      // Held before the UI hears of it, as the fork did: a stop from a store listener then stops this session.
      this.hosted = hosted;
      onlineSessionStore.setState({
        status: 'hosting', peerId: hosted.hostId, joinUrl: hosted.joinUrl, error: hosted.linkError, tokenControl: hosted.tokenControl,
      });
    } catch (error) {
      if (generation === this.generation) onlineSessionStore.setState({ status: 'error', error: errorText(error) });
    }
  }

  stop(): void {
    this.generation++;
    // Let go first: a store listener that stops again while this one tears down finds nothing to stop.
    const hosted = this.hosted;
    this.hosted = null;
    hosted?.stop();
    resetOnlineSessionStore();
  }

  /** Admits a waiting player: as who their device is for an Obsidian player, as before for a web player. */
  allow(playerId: string): void { this.hosted?.requests.allow(playerId); }
  /** Admits a new device as a known person: only the GM links. */
  link(playerId: string, personId: string): void { this.hosted?.requests.link(playerId, personId); }
  /** Admits a new device as someone added by name before meeting them: only the GM links. */
  linkPlaceholder(playerId: string, placeholderId: string): void { this.hosted?.requests.linkPlaceholder(playerId, placeholderId); }
  deny(playerId: string): void { this.hosted?.requests.deny(playerId); }
  kick(playerId: string): void { this.hosted?.session.kick(playerId); }
}
