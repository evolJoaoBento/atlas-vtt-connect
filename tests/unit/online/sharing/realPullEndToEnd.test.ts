/**
 * Pulls as the plugin wires them: two Atlases, each with its own copy of every module (its own
 * stores, as two Obsidian apps on two machines have), registered through `registerSharing`
 * exactly as Connect's binding does (`connectSharing.ts`), over FakeAtlas. The GM hosts with
 * `OnlineSessionService` and a real `SenderCatalogue` over its vault; the player joins with
 * `OnlineJoinService` from an empty vault with no Atlas data at all. Web Crypto signs and hashes,
 * real timers run, and `MemoryTransport` carries everything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { MemoryNetwork } from '../../../fake/MemoryTransport';
import type { SharedWithMe } from '../../../../src/app/online/sharing/receive/SharedWithMe';

const seen = vi.hoisted(() => ({
  /** What opening the Shared with me dialog would show: it is not drawn here. */
  opened: [] as unknown[],
  notices: [] as unknown[],
  /** The person Ask to pull's chooser picks. */
  choice: null as string | null,
}));
vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  Notice: class { constructor(message: unknown) { seen.notices.push(message); } hide(): void {} },
}));
vi.mock('../../../../src/app/online/sharing/receive/ui/SharedWithMeModal', () => ({
  SHARED_WITH_ME_LABEL: 'Shared with me',
  NO_SHARE_SESSION_TEXT: 'Join or host an online session to see what people share with you.',
  openSharedWithMeModal: (_app: unknown, service: unknown): void => { seen.opened.push(service); },
}));
vi.mock('../../../../src/app/ui/confirmDialog', () => ({
  chooseAction: async (): Promise<string | null> => seen.choice,
  confirmAction: async (): Promise<boolean> => true,
}));

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface Command { id: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean }

/** One Atlas: a fresh copy of every module, a vault, settings, and the plugin's registration. */
async function atlas(name: string, seed: Record<string, string>, bare = false) {
  vi.resetModules();
  const [{ createInMemoryApp, parseFrontmatter }, { TFile }, { registerSharing }, { OnlineJoinService }, { OnlineSessionService }, { PeopleBook }, { ShareItems }, { PulledItems }, { MergeHistory }, { onlineSessionStore }, { shareSessionStore }, { ShareError }, { sharingLifetime }, { sessionDeps }, { FakeAtlas, connectingPlugin }, { memorySettings }, { PATHS }] = await Promise.all([
    import('../../../mocks/inMemoryVault'),
    import('obsidian'),
    import('../../../../src/app/online/sharing/registerSharing'),
    import('../../../../src/app/online/obsidian/OnlineJoinService'),
    import('../../../../src/app/online/OnlineSessionService'),
    import('../../../../src/app/online/sharing/people/PeopleBook'),
    import('../../../../src/app/online/sharing/model/ShareItems'),
    import('../../../../src/app/online/sharing/receive/PulledItems'),
    import('../../../../src/app/online/sharing/merge/MergeHistory'),
    import('../../../../src/app/online/onlineSessionStore'),
    import('../../../../src/app/online/sharing/shareSessionStore'),
    import('../../../../src/app/online/sharing/transport/ShareNode'),
    import('../../../../src/app/online/sharing/sharingLifetime'),
    import('../../../../src/app/online/atlas/sessionDeps'),
    import('../../../fake/FakeAtlas'),
    import('../../connect/memorySettings'),
    import('./sharingPathsFixture'),
  ]);
  const vault = createInMemoryApp({ files: seed });
  // A vault Atlas never ran in: not even the `atlas-vtt` folder.
  if (bare) vault.folders.clear();
  const app = vault.app as App & Record<string, unknown>;
  const local = new Map<string, unknown>();
  Object.assign(app, { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => local.set(key, value) });
  Object.assign(app.vault, {
    getName: () => name,
    getMarkdownFiles: () => app.vault.getFiles().filter((file: { extension: string }) => file.extension === 'md'),
  });
  Object.assign(app.workspace, { updateOptions: () => {} });
  // Obsidian's metadata cache: the note's frontmatter as it is now.
  app.metadataCache.getFileCache = ((file: { path: string }) => {
    const text = vault.files.get(file.path);
    return text === undefined ? null : { frontmatter: parseFrontmatter(text) };
  }) as never;
  let active: string | null = null;
  // The mock's TFile takes its path.
  const fileAt = TFile as unknown as new (path: string) => InstanceType<typeof TFile>;
  app.workspace.getActiveFile = () => (active ? new fileAt(active) : null);
  const settings = memorySettings({ playerName: name });
  // Atlas with sharing and hosting, over this vault; Connect's binding as `atlas.connect` gives it.
  const fake = new FakeAtlas({ version: '1.11.0', capabilities: ['views', 'presentation', 'rules', 'settings', 'storage', 'scenes', 'bundles'], vault });
  const extension = fake.connect(connectingPlugin('atlas-vtt-connect'));
  const commands: Command[] = [];
  const disposers: Array<() => void> = [];
  const plugin = {
    app, addCommand: (command: Command) => { commands.push(command); return command; },
    removeCommand: (id: string) => { const at = commands.findIndex((command) => command.id === id); if (at >= 0) commands.splice(at, 1); },
    registerEvent: () => {}, register: (dispose: () => void) => { disposers.push(dispose); },
    registerEditorExtension: () => {}, registerMarkdownPostProcessor: () => {},
  } as never;
  const lifetime = sharingLifetime(plugin);
  const people = PeopleBook.forApp(app, PATHS);
  const register = (joins: InstanceType<typeof OnlineJoinService>, sessions: InstanceType<typeof OnlineSessionService> | null): void => {
    disposers.push(registerSharing(plugin, {
      atlas: { scenes: extension.scenes, rules: extension.rules, playerView: () => extension.settings.get('playerView') },
      lifetime, joins, people, items: ShareItems.forApp(app, PATHS), pulled: PulledItems.forApp(app, PATHS),
      history: new MergeHistory(app.vault.adapter, PATHS.history), sessions,
      settings: { ownTableId: () => settings.get().table?.id ?? null, shareableProperties: () => settings.get().shareableProperties },
    }));
  };
  /** Runs a command as Obsidian would, with `path` the active file. */
  const run = (id: string, path: string | null = null): void => {
    active = path;
    const command = commands.find((candidate) => candidate.id === id)!;
    if (command.callback) command.callback();
    else expect(command.checkCallback!(false)).toBe(true);
  };
  const hostDeps = { ...sessionDeps(extension, { dice: null, lasers: null, lighting: null, tokens: null }), people };
  return { vault, app, settings, register, run, disposers, hostDeps, PATHS, OnlineJoinService, OnlineSessionService, onlineSessionStore, shareSessionStore, ShareError };
}

/** The GM hosting with a vault of `notes`, and Ana, admitted from a fresh vault. */
async function table(notes: Record<string, string>) {
  const network = new MemoryNetwork();
  const gm = await atlas('Morgan', notes);
  const answers: Array<(allow: boolean) => void> = [];
  const sessions = new gm.OnlineSessionService(gm.app, gm.settings, {
    ...gm.hostDeps, createHost: async () => network.host('gm-host'), isJoined: () => false,
    showRequest: (_player, answer) => { answers.push(answer); return { hide: () => {} }; },
  });
  gm.register(new gm.OnlineJoinService(gm.app, gm.settings, '0.5.1', { openStore: async () => null, isHosting: () => true }), sessions);
  await sessions.start();
  expect(gm.onlineSessionStore.getState().status).toBe('hosting');

  const player = await atlas('Ana', {}, true);
  const joins = new player.OnlineJoinService(player.app, player.settings, '0.5.1', {
    createClient: () => network.client(), openStore: async () => null, decode: async () => null, openSceneTab: async () => {}, isHosting: () => false,
  });
  // This Atlas only joins: sharing starts without hosting (`SharingServices.sessions`).
  player.register(joins, null);
  expect(joins.join(gm.onlineSessionStore.getState().joinUrl!, 'Ana')).toBeNull();
  await waitFor(() => answers.length === 1, 'the join request');
  answers[0]!(true);
  await waitFor(() => joins.identity !== null && gm.shareSessionStore.getState().people.length === 1, 'the checked table');

  /** Ana's Shared with me, as its command opens it. */
  const sharedWithMe = (): SharedWithMe => {
    player.run('shared-with-me');
    return seen.opened.at(-1) as SharedWithMe;
  };
  const leave = (): void => {
    joins.leave();
    sessions.stop();
    [...player.disposers, ...gm.disposers].forEach((dispose) => dispose());
  };
  return { gm, player, anaId: joins.identity!.personId, sharedWithMe, leave };
}

/** A note of the shape notes in a real vault have: a tag line, an inline field, links, an embed and emoji. */
const BODY = '#lore\nsummary:: **Coin** of the realm\n## 💱 _Coin_: money\n\n- Minted in [[Capital]], [[Old Port|the port]].\n\n### 🌐 Symbols\n\nShown with [[Queen Ada]].\n\n![[coin 20250708.png]]\n';

describe('pulling as the plugin wires it', () => {
  afterEach(() => {
    seen.opened.length = 0;
    seen.notices.length = 0;
    seen.choice = null;
  });

  it('a player with a fresh vault pulls a note the GM shared with everyone', async () => {
    const { player, sharedWithMe, leave } = await table({ 'Lore/Coin.md': `---\natlas-share: public\ntags: lore\n---\n${BODY}` });
    const service = sharedWithMe();
    const catalogue = await service.refresh('gm');
    expect(catalogue.items.map((item) => [item.title, item.state])).toEqual([['Coin', 'new']]);
    expect(await service.pull('gm', catalogue.items[0]!)).toEqual({ kind: 'created', path: 'Shared/Morgan/Coin.md' });
    expect(player.vault.files.get('Shared/Morgan/Coin.md')).toBe(
      '---\ntags: lore\n---\n#lore\nsummary:: **Coin** of the realm\n## 💱 _Coin_: money\n\n- Minted in Capital, the port.\n\n### 🌐 Symbols\n\nShown with Queen Ada.\n\ncoin 20250708.png\n',
    );
    expect((await service.refresh('gm')).items[0]?.state).toBe('current');
    leave();
  }, 60_000);

  it('Ask to pull refuses a note shared with nobody, so no push can name it', async () => {
    const { gm, player, anaId, leave } = await table({ 'Coin.md': BODY });
    seen.choice = anaId;
    gm.run('ask-to-pull', 'Coin.md');
    await waitFor(() => seen.notices.some((notice) => typeof notice === 'string'), 'the notice');
    expect(seen.notices.filter((notice) => typeof notice === 'string')).toEqual(['Share this note with them first, then ask them to pull it.']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(player.shareSessionStore.getState().pushes).toEqual([]);
    // No item id is handed out for a note nobody may have.
    expect(gm.vault.files.get(gm.PATHS.items) ?? '').not.toContain('Coin.md');
    leave();
  }, 60_000);

  it('a push for a note the GM stopped sharing fails as not shared, and says why', async () => {
    const { gm, player, anaId, sharedWithMe, leave } = await table({ 'Coin.md': `---\natlas-share: public\n---\n${BODY}` });
    seen.choice = anaId;
    gm.run('ask-to-pull', 'Coin.md');
    await waitFor(() => player.shareSessionStore.getState().pushes.length === 1, 'the push');
    gm.vault.files.set('Coin.md', BODY);
    const failed = await sharedWithMe().pullPushed(player.shareSessionStore.getState().pushes[0]!).then(() => null, (error: unknown) => error);
    expect(failed).toBeInstanceOf(player.ShareError);
    expect((failed as InstanceType<typeof player.ShareError>).reason).toBe('not-shared');
    expect([...player.vault.files.keys()].filter((path) => !path.startsWith('atlas-vtt/.atlas-data/'))).toEqual([]);
    leave();
  }, 60_000);
});
