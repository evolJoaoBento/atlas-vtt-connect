/**
 * Atlas's remote views (API 1.12) as Connect sees them: `remoteViews.open` gives a handle that records every call
 * (`calls`) and keeps what was fed, refusing what Atlas's view refuses (`fakeRemoteInput.ts`). The test drives the
 * player's side: a drop (snapped over the fed grid as Atlas's `remoteDrag` does, heard only for movable tokens),
 * a camera move, the dice tray, closing the tab. A view is listed in `views` as kind `remote`; `setScene` loads it.
 */
import type {
  Disposer, Point, RemotePlayerState, RemoteSceneInput, RemoteStatus, RemoteView, RemoteViewsApi, TokenEntity, TokenMove, ViewCamera,
} from '@atlas-vtt/api-types';
import { checkedCamera, checkedOptions, checkedPlayer, checkedScene, checkedStatus, isRoll } from './fakeRemoteInput';
import { snapDropped } from './fakeTokens';
import type { FakeViews, Own } from './fakeViews';

/** Shown when a tray roll finds nothing to take it (Atlas's `ROLL_NOT_SENT`). */
export const FAKE_ROLL_NOT_SENT = 'The roll could not be sent.';

type RollListener = (dice: Readonly<Record<string, number>>, modifier: number) => string | null;

function guarded<A extends unknown[], R>(listener: (...args: A) => R, ...args: A): R | undefined {
  try {
    return listener(...args);
  } catch (error) {
    console.error('[Atlas API] A remote view listener failed:', error);
    return undefined;
  }
}

/** One remote view and the handle its owner holds. */
export class FakeRemoteHandle {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  scene: RemoteSceneInput | null = null;
  player: RemotePlayerState | null = null;
  status: RemoteStatus | null = null;
  diceLog: readonly unknown[] = [];
  readonly thrown: string[] = [];
  readonly cameras: Array<{ camera: ViewCamera; animate: boolean; padded: boolean }> = [];
  closed = false;
  private readonly drops = new Set<(move: TokenMove) => void>();
  private readonly cameraMoves = new Set<(byUser: boolean) => void>();
  private readonly rolls: RollListener[] = [];
  private readonly closers = new Set<() => void>();
  private readonly statusChoices = new Set<(id: string) => void>();
  readonly api: RemoteView;

  constructor(readonly viewId: string, readonly owner: string, readonly options: ReturnType<typeof checkedOptions>, private readonly views: FakeViews, private readonly onClosed: () => void, readonly before115 = false) {
    views.openRemote(viewId);
    const live = <A extends unknown[]>(method: string, run: (...args: A) => void) => (...args: A): void => {
      this.calls.push({ method, args });
      if (!this.closed) run(...args);
    };
    const listen = <L>(set: Set<L>) => (listener: L): Disposer => {
      if (this.closed) return () => undefined;
      set.add(listener);
      return () => { set.delete(listener); };
    };
    this.api = Object.freeze({
      viewId,
      setScene: live('setScene', (scene: RemoteSceneInput | null) => this.applyScene(checkedScene(scene))),
      setPlayer: live('setPlayer', (state: RemotePlayerState) => { this.player = checkedPlayer(state); }),
      setStatus: live('setStatus', (status: RemoteStatus) => { this.status = checkedStatus(status); }),
      setDiceLog: live('setDiceLog', (entries: readonly unknown[]) => {
        if (!Array.isArray(entries) || !entries.every(isRoll)) throw new Error('RemoteView.setDiceLog: the entries must be dice roll results.');
        this.diceLog = structuredClone(entries.slice(0, 100));
      }),
      throwRoll: live('throwRoll', (result: unknown) => {
        if (!isRoll(result)) throw new Error('RemoteView.throwRoll: the result must be a dice roll result.');
        if (!this.thrown.includes(result.id)) this.thrown.push(result.id);
      }),
      setCamera: live('setCamera', (camera: ViewCamera, options?: { animate?: boolean; padded?: boolean }) => {
        // `padded` is API 1.15: an older Atlas ignores it.
        this.cameras.push({ camera: checkedCamera(camera), animate: options?.animate === true, padded: !before115 && options?.padded === true });
      }),
      cancelDrag: live('cancelDrag', () => undefined),
      // API 1.15; an older Atlas has no `onStatusAction`.
      ...(before115 ? {} : { onStatusAction: listen(this.statusChoices) }),
      onTokenDrop: listen(this.drops),
      onCameraMoved: listen(this.cameraMoves),
      onRoll: (listener: RollListener): Disposer => {
        if (this.closed) return () => undefined;
        this.rolls.push(listener);
        return () => { const at = this.rolls.indexOf(listener); if (at >= 0) this.rolls.splice(at, 1); };
      },
      onClose: listen(this.closers),
      close: (): void => this.close(),
    });
  }

  /** How many times `method` was called. */
  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  /** The player lets go of `tokenId` at `point`: snapped over the fed grid; heard only for a token they may move. */
  drop(tokenId: string, point: Point): void {
    const tokens = this.scene?.objects.tokens ?? {};
    const token: TokenEntity | undefined = Object.hasOwn(tokens, tokenId) ? tokens[tokenId] : undefined;
    if (!token || !this.player?.movableTokenIds.includes(tokenId)) return;
    const size = typeof token.size === 'number' && token.size > 0 ? token.size : 1;
    const landed = snapDropped(this.scene?.grid ?? null, point, size);
    const move: TokenMove = Object.freeze({ tokenId, x: landed.x, y: landed.y });
    for (const listener of [...this.drops]) guarded(listener, move);
  }

  /** The player pans (`byUser`), or Atlas's Fit map ran (`false`). */
  moveCamera(byUser: boolean): void {
    for (const listener of [...this.cameraMoves]) guarded(listener, byUser);
  }

  /** The player chooses one of the status's `actions`; heard by `onStatusAction` listeners, and only for an id the status shows. */
  chooseStatusAction(id: string): void {
    if (!this.status?.actions?.some((action) => action.id === id)) return;
    for (const listener of [...this.statusChoices]) guarded(listener, id);
  }

  /** The dice tray (or Roll again): asks each listener until one sends it; null once sent, else the first reason. */
  rollFromTray(dice: Readonly<Record<string, number>>, modifier = 0): string | null {
    const total = Object.values(dice).reduce((sum, count) => sum + count, 0);
    if (total < 1 || total > this.options.maxDice) return `Roll 1 to ${this.options.maxDice} dice.`;
    let reason: string | null = null;
    for (const listener of [...this.rolls]) {
      const answer = guarded(listener, Object.freeze({ ...dice }), modifier);
      if (answer === null) return null;
      reason ??= typeof answer === 'string' && answer !== '' ? answer : FAKE_ROLL_NOT_SENT;
    }
    return reason ?? FAKE_ROLL_NOT_SENT;
  }

  /** Closes the view (the tab, the extension or Atlas unloading); `onClose` listeners run once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.drops.clear();
    this.cameraMoves.clear();
    this.statusChoices.clear();
    this.rolls.length = 0;
    const closers = [...this.closers];
    this.closers.clear();
    this.views.close(this.viewId);
    this.onClosed();
    for (const listener of closers) guarded(listener);
  }

  /** The view's store holds the scene (`remote:<viewId>`), its tokens without links into another vault; null unloads it. */
  private applyScene(scene: RemoteSceneInput | null): void {
    this.scene = scene ? structuredClone(scene) : null;
    if (!scene) {
      this.views.update(this.viewId, { mapPath: null, loaded: false });
      return;
    }
    const tokens: Record<string, TokenEntity> = {};
    for (const [id, token] of Object.entries(scene.objects.tokens)) {
      const { notePath: _note, statblockPath: _statblock, ...rest } = token as TokenEntity & { notePath?: string; statblockPath?: string };
      tokens[id] = { ...rest, imagePath: scene.tokenImages[id] ?? '' } as TokenEntity;
    }
    this.views.update(this.viewId, {
      mapPath: `remote:${this.viewId}`, loaded: true, mapSize: { width: scene.background.width, height: scene.background.height },
      background: scene.background.url, grid: scene.grid, objects: { ...scene.objects, tokens },
      widgets: scene.widgets, initiative: scene.initiative, initiativeTrackerOpen: scene.initiative.entries.length > 0,
    });
  }
}

/** The remote views of every extension; each closes when its extension or Atlas unloads. */
export class FakeRemoteViews {
  private readonly handles: FakeRemoteHandle[] = [];
  private next = 0;
  /** `open` fails (the workspace refused the view), as `open` rejects in Atlas. */
  failOpen = false;

  constructor(private readonly views: FakeViews, private readonly before115 = false) {}

  /** The extension that opened the remote view, while it is open (Atlas's `RemoteControls` owner); undefined for any other view. */
  ownerOf(viewId: string): string | undefined {
    return this.handles.find((handle) => handle.viewId === viewId && !handle.closed)?.owner;
  }

  /** Every handle opened, closed ones included, oldest first. */
  all(): readonly FakeRemoteHandle[] {
    return this.handles;
  }

  /** The newest handle still open; throws when there is none. */
  latest(): FakeRemoteHandle {
    const open = this.handles.filter((handle) => !handle.closed);
    const handle = open[open.length - 1];
    if (!handle) throw new Error('No remote view is open.');
    return handle;
  }

  api(owner: string, own: Own): RemoteViewsApi {
    return Object.freeze({
      open: (options: { title: string; icon?: string; reuse?: boolean; maxDice?: number }): Promise<RemoteView> => {
        let checked: ReturnType<typeof checkedOptions>;
        try {
          checked = checkedOptions(options);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        if (this.failOpen) return Promise.reject(new Error('remoteViews.open: the remote view could not open.'));
        const shown = checked.reuse ? this.handles.find((handle) => handle.owner === owner && !handle.closed) : undefined;
        if (shown) return Promise.resolve(shown.api);
        let release: Disposer = () => undefined;
        const handle = new FakeRemoteHandle(`remote-${++this.next}`, owner, checked, this.views, () => release(), this.before115);
        release = own(() => handle.close());
        this.handles.push(handle);
        return Promise.resolve(handle.api);
      },
    });
  }
}
