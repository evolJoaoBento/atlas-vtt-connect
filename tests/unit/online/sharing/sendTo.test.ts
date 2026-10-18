import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SEND_GRANT_MS, SendGrants } from '../../../../src/app/online/sharing/model/sendGrants';
import { pushPromptText } from '../../../../src/app/online/sharing/receive/ui/pushPrompt';
import { NOBODY_TO_SEND_TO_TEXT, registerSendTo, SEND_TO_LABEL } from '../../../../src/app/online/sharing/registerSendTo';
import { shareSessionStore } from '../../../../src/app/online/sharing/shareSessionStore';

const choose = vi.hoisted(() => ({ next: null as string | null }));
vi.mock('../../../../src/app/ui/confirmDialog', () => ({ chooseAction: vi.fn(async () => choose.next) }));
const notices = vi.hoisted(() => [] as string[]);
vi.mock('obsidian', async (original) => ({
  ...(await original<typeof import('obsidian')>()),
  Notice: class { constructor(text: string) { notices.push(text); } },
}));

const T = 'T'.repeat(43);
const ana = { tableId: T, personId: 'ana' };

describe('notes sent with Send to…', () => {
  it('may be pulled by the one they were sent to, for a while, and follow the note when it moves', () => {
    let now = 0;
    const grants = new SendGrants(() => now);
    grants.grant(ana, 'Cave.md');
    expect(grants.paths(ana)).toEqual(['Cave.md']);
    expect(grants.paths({ tableId: T, personId: 'ben' })).toEqual([]);
    grants.moved('Cave.md', 'Places/Cave.md');
    expect(grants.paths(ana)).toEqual(['Places/Cave.md']);
    grants.moved('Places/Cave.md', null);
    expect(grants.paths(ana)).toEqual([]);
    grants.grant(ana, 'Inn.md');
    now = SEND_GRANT_MS;
    expect(grants.paths(ana)).toEqual([]);
  });

  it('are asked about as "Ana is sending you a note: Cave"', () => {
    expect(pushPromptText({ kind: 'note', title: 'Cave' }, 'Ana')).toBe('Ana is sending you a note: Cave');
    expect(pushPromptText({ kind: 'map', title: 'Inn' }, 'Ana')).toBe('Ana is sending you a map: Inn');
  });
});

function note(path: string): TFile {
  const file = new TFile();
  Object.assign(file, { path, basename: path.replace(/\.md$/, ''), extension: path.split('.').pop() });
  return file;
}

function setup() {
  const commands = new Map<string, { checkCallback(checking: boolean): boolean }>();
  let fileMenu: ((menu: unknown, file: unknown) => void) | null = null;
  const active: { file: TFile | null } = { file: note('Cave.md') };
  const plugin = {
    app: {
      vault: { cachedRead: vi.fn(async () => 'The cave.') },
      metadataCache: { getFileCache: () => null },
      workspace: {
        getActiveFile: () => active.file,
        on: (_name: string, callback: (menu: unknown, file: unknown) => void) => { fileMenu = callback; return {}; },
      },
    },
    addCommand: (command: { id: string; checkCallback(checking: boolean): boolean }) => { commands.set(command.id, command); },
    registerEvent: () => undefined,
  };
  const grant = vi.fn();
  registerSendTo(plugin as never, {
    items: { idFor: (path) => `id:${path}` },
    sections: { trusted: () => false } as never,
    catalogue: { sent: { grant } } as never,
  });
  const push = vi.fn();
  const menuItems = (file: TFile): string[] => {
    const titles: string[] = [];
    const item = { setTitle: (title: string) => { titles.push(title); return item; }, setIcon: () => item, onClick: () => item };
    fileMenu?.({ addItem: (build: (entry: typeof item) => void) => build(item) }, file);
    return titles;
  };
  const inSession = (people: Array<{ personId: string; name: string }>): void => {
    shareSessionStore.setState({ session: { tableId: T, self: 'me', node: { push } } as never, people });
  };
  return { commands, active, grant, push, menuItems, inSession, run: () => commands.get('send-to')!.checkCallback(false) };
}

describe('Send to…', () => {
  afterEach(() => {
    shareSessionStore.setState({ session: null, people: [], pushes: [] });
    notices.splice(0);
    choose.next = null;
  });

  it('is offered for a note while in a session, not for a map or outside one', () => {
    const t = setup();
    expect(t.menuItems(note('Cave.md'))).toEqual([]);
    t.inSession([{ personId: 'ana', name: 'Ana' }]);
    expect(t.menuItems(note('Cave.md'))).toEqual([SEND_TO_LABEL]);
    expect(t.menuItems(note('Inn.atlasmap'))).toEqual([]);
    expect(t.commands.get('send-to')!.checkCallback(true)).toBe(true);
  });

  it('lets the one chosen pull it, whoever they are, and asks them at once', async () => {
    const t = setup();
    t.inSession([{ personId: 'ana', name: 'Ana' }, { personId: 'ben', name: 'Ben' }]);
    choose.next = 'ben';
    t.run();
    await vi.waitFor(() => expect(t.push).toHaveBeenCalled());
    expect(t.grant).toHaveBeenCalledWith({ tableId: T, personId: 'ben' }, 'Cave.md');
    expect(t.push).toHaveBeenCalledWith('ben', 'id:Cave.md', 'note', 'Cave');
    expect(notices).toEqual(['Sent Cave to Ben.']);
  });

  it('sends nothing when nobody else is there, the choice is cancelled, or they left meanwhile', async () => {
    const t = setup();
    t.inSession([]);
    t.run();
    await vi.waitFor(() => expect(notices).toEqual([NOBODY_TO_SEND_TO_TEXT]));
    t.inSession([{ personId: 'ana', name: 'Ana' }]);
    choose.next = null;
    t.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    choose.next = 'gone';
    t.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.grant).not.toHaveBeenCalled();
    expect(t.push).not.toHaveBeenCalled();
  });
});
