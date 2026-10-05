/**
 * The GM and two Obsidian players over `MemoryTransport`, each with its own vault: notes go
 * both ways, a player-to-player note passes through the GM, edits on both sides meet the
 * receiver's choice, and nothing lands anywhere without a pull.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { PlayerSession } from '../../../../src/app/online/PlayerSession';
import type { TableProof } from '../../../../src/app/online/protocol';
import { createUpdatePolicy } from '../../../../src/app/online/sharing/merge/noteUpdate';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { SharedWithMe } from '../../../../src/app/online/sharing/receive/SharedWithMe';
import { GmShareHost } from '../../../../src/app/online/sharing/transport/GmShareHost';
import { PlayerShareLink } from '../../../../src/app/online/sharing/transport/PlayerShareLink';
import type { ShareNode } from '../../../../src/app/online/sharing/transport/ShareNode';
import { MemoryNetwork } from '../../../../src/app/online/transport/MemoryTransport';
import { createInMemoryApp, type InMemoryApp } from '../../../mocks/inMemoryVault';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID, testPerson } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

const proof = (personId: string): TableProof => ({ id: TABLE_ID, key: 'K'.repeat(120), personId, gmName: 'Morgan', sig: 'S'.repeat(86) });
const people = [testPerson('gm', 'Morgan'), testPerson('ana', 'Ana'), testPerson('ben', 'Ben')];
const flush = async (): Promise<void> => { for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(0); };
type Notes = Record<string, { text: string; share: unknown }>;

/** How many calls that could change a vault its adapter, vault and file manager have seen. */
function writes(vault: InMemoryApp): number {
  const rest = vault.app.vault;
  const { adapter } = rest;
  const mutators = [
    adapter.write, adapter.writeBinary, adapter.mkdir, adapter.remove, adapter.rename, adapter.copy, adapter.rmdir, adapter.trashSystem, adapter.trashLocal,
    rest.create, rest.createBinary, rest.createFolder, rest.modifyBinary, rest.process, rest.rename,
    vault.app.fileManager.renameFile, vault.app.fileManager.trashFile, vault.app.fileManager.processFrontMatter,
  ];
  return mutators.reduce((sum, fn) => sum + (fn as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 0);
}

async function table() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  // The GM's notes are read from its vault, so the spies on that vault see anything the GM's side would write.
  const realm = 'The realm.\n%%[!only|Ben]%%\nBen is the heir.\n%%[!end]%%';
  const gmVault = createInMemoryApp({ files: { 'Lore/Realm.md': realm } });
  const gmNotes: Notes = {
    'Lore/Realm.md': { get text(): string { return gmVault.files.get('Lore/Realm.md') ?? ''; }, share: 'public' },
    // Shared with Ana once a test writes it.
    'Lore/Secret.md': { get text(): string { return gmVault.files.get('Lore/Secret.md') ?? ''; }, get share(): unknown { return gmVault.files.has('Lore/Secret.md') ? ['Ana'] : undefined; } },
  };
  const host = new GmShareHost({ session: gm, tableId: TABLE_ID, catalogue: noteCatalogue(gmNotes, people), hash: nodeHash });
  host.start();
  const anaNotes: Notes = {
    'Notes/Clue.md': { text: 'a\nb\nc\nd\ne', share: ['Ben'] },
    'Notes/ForMorgan.md': { text: 'For the GM.', share: ['Morgan'] },
  };
  const benNotes: Notes = { 'Notes/Reply.md': { text: 'Ben replies.', share: ['Ana'] } };
  const join = async (personId: string, name: string, notes: Notes) => {
    const vault = createInMemoryApp();
    const pulled = PulledItems.create(vault.app.vault.adapter, PATHS);
    // The catalogue reads `notes` on every call, so a test can edit the sender's note; one instance keeps its item ids.
    const link = new PlayerShareLink({ catalogue: noteCatalogue(notes, people), hash: nodeHash });
    const session = new PlayerSession({ hostId: 'gm', name, playerKey: `key-${personId}`, clientVersion: '1', clientKind: 'obsidian', transport: network.client(), onChange: () => {}, share: link });
    session.start();
    await flush();
    gm.allow(requests.at(-1)!.playerId, { personId, table: proof(personId) });
    await flush();
    const node: ShareNode = link.activate({ tableId: TABLE_ID, personId });
    return { vault, service: receiver(vault, pulled, node), notes };
  };
  const ana = await join('ana', 'Ana', anaNotes);
  const ben = await join('ben', 'Ben', benNotes);
  return { gm, host, gmVault, ana, ben };
}

function receiver(vault: InMemoryApp, pulled: PulledItems, node: Pick<ShareNode, 'requestList' | 'pull'>): SharedWithMe {
  return new SharedWithMe({
    app: vault.app, pulled, node, tableId: TABLE_ID, nameOf: (id) => people.find((person) => person.personId === id)?.name ?? 'Someone',
    nameAt: (id) => people.find((person) => person.personId === id)?.name ?? null,
    policy: createUpdatePolicy({ pulled, ask: async () => ({ choice: 'auto', remember: true, silent: true }), merge: async () => null }),
    scenes: {} as never, confirmMapUpdate: async () => 'theirs', confirmCode: async () => 'without',
  });
}

/** Pulls `title` from `person`, settling the transport while it runs. */
async function pull(service: SharedWithMe, person: string, title: string) {
  const listed = service.refresh(person);
  await flush();
  const item = (await listed).items.find((candidate) => candidate.title === title)!;
  const pulling = service.pull(person, item);
  await flush();
  return { item, outcome: await pulling };
}

describe('sharing between three Atlases', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('each gets what is theirs from the GM, filtered on the GM’s machine', async () => {
    const { gm, host, ana, ben } = await table();
    await pull(ana.service, 'gm', 'Realm');
    await pull(ben.service, 'gm', 'Realm');
    expect(ana.vault.files.get('Shared/Morgan/Realm.md')).toBe('The realm.');
    // Ben's part arrives still marked: shared on, it reaches only the GM (and Ben, who has it).
    expect(ben.vault.files.get('Shared/Morgan/Realm.md')).toBe('The realm.\n%%[!only|Morgan]%%\nBen is the heir.\n%%[!end]%%');
    host.stop();
    gm.stop();
  });

  it('a part meant only for Ana stays with Ana and the GM when Ana shares the note on', async () => {
    const { gm, host, gmVault, ana, ben } = await table();
    gmVault.files.set('Lore/Secret.md', 'Open.\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%');
    await pull(ana.service, 'gm', 'Secret');
    const copy = 'Shared/Morgan/Secret.md';
    expect(ana.vault.files.get(copy)).toBe('Open.\n%%[!only|Morgan]%%\nFor Ana.\n%%[!end]%%');
    // Ana shares her copy on, with Ben and back to the GM.
    ana.notes[copy] = { get text(): string { return ana.vault.files.get(copy) ?? ''; }, share: ['Ben', 'Morgan'] };
    await pull(ben.service, 'ana', 'Secret');
    expect(ben.vault.files.get('Shared/Ana/Secret.md')).toBe('Open.');
    const gmService = receiver(gmVault, PulledItems.create(gmVault.app.vault.adapter, PATHS), host.node);
    await pull(gmService, 'ana', 'Secret');
    expect(gmVault.files.get('Shared/Ana/Secret.md')).toBe('Open.\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%');
    host.stop();
    gm.stop();
  });

  it('players share with each other through the GM, which writes nothing and keeps nothing', async () => {
    const { gm, host, gmVault, ana, ben } = await table();
    const before = new Map(gmVault.files);
    const writesBefore = writes(gmVault);
    const listed = ana.service.refresh('ben');
    await flush();
    // Ben's note is for Ana, Ana's for Ben: each sees only the other's.
    expect((await listed).items.map((item) => item.title)).toEqual(['Reply']);
    await pull(ben.service, 'ana', 'Clue');
    await pull(ana.service, 'ben', 'Reply');
    expect(ben.vault.files.get('Shared/Ana/Clue.md')).toBe('a\nb\nc\nd\ne');
    expect(ana.vault.files.get('Shared/Ben/Reply.md')).toBe('Ben replies.');
    expect(gmVault.files).toEqual(before);
    expect(writes(gmVault)).toBe(writesBefore);
    expect(host.relayMappings()).toBe(0);
    host.stop();
    gm.stop();
  });

  it('the spy on the GM’s vault does see a write', async () => {
    const { gm, host, gmVault } = await table();
    const before = writes(gmVault);
    await gmVault.app.vault.create('Lore/New.md', 'x');
    expect(writes(gmVault)).toBe(before + 1);
    host.stop();
    gm.stop();
  });

  it('a player shares with the GM, who pulls it into its own vault', async () => {
    const { gm, host, gmVault } = await table();
    const gmPulled = PulledItems.create(gmVault.app.vault.adapter, PATHS);
    const service = receiver(gmVault, gmPulled, host.node);
    const before = writes(gmVault);
    const listed = service.refresh('ana');
    await flush();
    const items = (await listed).items;
    expect(items.map((item) => item.title)).toEqual(['ForMorgan']);
    // Listing writes nothing into the GM's vault.
    expect(gmVault.files.has('Shared/Ana/ForMorgan.md')).toBe(false);
    expect(writes(gmVault)).toBe(before);
    const pulling = service.pull('ana', items[0]!);
    await flush();
    await pulling;
    expect(gmVault.files.get('Shared/Ana/ForMorgan.md')).toBe('For the GM.');
    host.stop();
    gm.stop();
  });

  it('the GM edits a shared note: the player sees Updated, and gets it only on pulling', async () => {
    const { gm, host, gmVault, ana } = await table();
    await pull(ana.service, 'gm', 'Realm');
    gmVault.files.set('Lore/Realm.md', 'The realm, changed.\n%% private %%');
    const { item, outcome } = await pull(ana.service, 'gm', 'Realm');
    expect(item.state).toBe('updated');
    expect(outcome).toMatchObject({ kind: 'updated' });
    expect(ana.vault.files.get('Shared/Morgan/Realm.md')).toBe('The realm, changed.');
    host.stop();
    gm.stop();
  });

  it('edits on both sides meet the receiver’s choice on the next pull, and only then', async () => {
    const { gm, host, ana, ben } = await table();
    await pull(ben.service, 'ana', 'Clue');
    ben.vault.files.set('Shared/Ana/Clue.md', 'a\nBEN\nc\nd\ne');
    ana.notes['Notes/Clue.md'] = { text: 'a\nb\nc\nANA\ne', share: ['Ben'] };
    await flush();
    expect(ben.vault.files.get('Shared/Ana/Clue.md')).toBe('a\nBEN\nc\nd\ne');
    const { item, outcome } = await pull(ben.service, 'ana', 'Clue');
    expect(item.state).toBe('updated');
    expect(outcome).toMatchObject({ kind: 'updated' });
    expect(ben.vault.files.get('Shared/Ana/Clue.md')).toBe('a\nBEN\nc\nANA\ne');
    host.stop();
    gm.stop();
  });

  it('an auto merge keeps the marks of a part meant for the receiver', async () => {
    const { gm, host, gmVault, ana } = await table();
    gmVault.files.set('Lore/Secret.md', 'Top\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%\nmiddle\nbottom');
    await pull(ana.service, 'gm', 'Secret');
    const copy = 'Shared/Morgan/Secret.md';
    ana.vault.files.set(copy, 'Top, by Ana\n%%[!only|Morgan]%%\nFor Ana.\n%%[!end]%%\nmiddle\nbottom');
    gmVault.files.set('Lore/Secret.md', 'Top\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%\nmiddle\nbottom, by the GM');
    const { outcome } = await pull(ana.service, 'gm', 'Secret');
    expect(outcome).toMatchObject({ kind: 'updated' });
    expect(ana.vault.files.get(copy)).toBe('Top, by Ana\n%%[!only|Morgan]%%\nFor Ana.\n%%[!end]%%\nmiddle\nbottom, by the GM');
    host.stop();
    gm.stop();
  });
});
