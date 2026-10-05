import { describe, expect, it, vi } from 'vitest';
import type { MapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import type { CatalogueItem } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { keepBothPolicy } from '../../../../src/app/online/sharing/receive/notePull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { SharedWithMe } from '../../../../src/app/online/sharing/receive/SharedWithMe';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { nodeHash } from '../assetFixtures';
import { TABLE_ID } from './sharingFixtures';
import { scenesOver } from './receiveFixtures';
import { PATHS } from './sharingPathsFixture';

const NOTE = 'c'.repeat(22);
const cave = (version: string): CatalogueItem => ({ item: NOTE, kind: 'note', title: 'Cave', version, size: 4 });
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

async function setup() {
  const { app, files } = createInMemoryApp();
  const pulled = PulledItems.create(app.vault.adapter, PATHS);
  await pulled.ready();
  let version = await nodeHash(bytes('cave'));
  const node = {
    requestList: vi.fn(async () => [cave(version)]),
    pull: vi.fn(async (_to: string, _item: string, _kind: string, _version?: string) => ({ kind: 'note' as const, version, bytes: bytes('cave') })),
  };
  const service = new SharedWithMe({
    app, pulled, node: node as never, tableId: TABLE_ID, policy: keepBothPolicy, nameOf: () => 'Ana', nameAt: () => 'Ana',
    scenes: {} as never, confirmMapUpdate: async () => 'theirs',
  });
  return { files, service, node, bump: (next: string) => { version = next; } };
}

describe('Shared with me', () => {
  it('lists per person as new, then up to date after a pull, then updated', async () => {
    const { service, bump } = await setup();
    expect((await service.refresh('ana')).items.map((item) => item.state)).toEqual(['new']);
    await service.pull('ana', (await service.refresh('ana')).items[0]!);
    expect((await service.refresh('ana')).items.map((item) => item.state)).toEqual(['current']);
    bump('X'.repeat(43));
    expect((await service.refresh('ana')).items.map((item) => item.state)).toEqual(['updated']);
  });

  it('listing writes nothing', async () => {
    const { files, service } = await setup();
    const before = [...files.keys()];
    await service.refresh('ana');
    expect([...files.keys()]).toEqual(before);
  });

  it('asks for the version it listed, so the receiver checks the bytes against what it was shown', async () => {
    const { service, node } = await setup();
    const [listed] = (await service.refresh('ana')).items;
    await service.pull('ana', listed!);
    expect(node.pull).toHaveBeenCalledWith('ana', NOTE, 'note', listed!.version);
  });

  it('pulls a pushed item when asked to, from the list of whoever pushed it', async () => {
    const { files, service, node } = await setup();
    await service.pullPushed({ from: 'ana', item: NOTE, kind: 'note', title: 'Cave', at: 1 });
    expect(node.requestList).toHaveBeenCalledWith('ana');
    expect(files.get('Shared/Ana/Cave.md')).toBe('cave');
  });

  it('refuses a pushed item that is not in the sender’s list, and writes nothing', async () => {
    const { files, service } = await setup();
    const before = [...files.keys()];
    await expect(service.pullPushed({ from: 'ana', item: 'z'.repeat(22), kind: 'note', title: 'Cave', at: 1 })).rejects.toThrow();
    expect([...files.keys()]).toEqual(before);
  });

  it('a map pull brings only the linked notes the receiver ticked', async () => {
    const OTHER = 'd'.repeat(22);
    const vault = createInMemoryApp();
    const { app, files } = vault;
    const pulled = PulledItems.create(app.vault.adapter, PATHS);
    await pulled.ready();
    const payload: MapPayload = {
      format: 'atlas-share-map-v1', mode: 'full', name: 'Inn', map: { objects: { tokens: {}, pins: {} } }, notes: [NOTE, OTHER], images: [],
    };
    const items: CatalogueItem[] = [
      { item: 'm'.repeat(22), kind: 'map', title: 'Inn', version: 'M'.repeat(43), size: 1, mode: 'full', linked: [NOTE, OTHER] },
      cave('N'.repeat(43)),
      { item: OTHER, kind: 'note', title: 'Secret room', version: 'O'.repeat(43), size: 1 },
    ];
    const node = {
      requestList: vi.fn(async () => items),
      pull: vi.fn(async (_to: string, item: string) => ({
        kind: item.length === 22 && item === items[0]!.item ? 'map' as const : 'note' as const, version: 'v', bytes: bytes(item === items[0]!.item ? JSON.stringify(payload) : `text of ${item}`),
      })),
    };
    const { atlas, scenes } = scenesOver(vault);
    atlas.scenes.collections.set('Shared with me', 'Shared with me');
    const service = new SharedWithMe({ app, pulled, node: node as never, tableId: TABLE_ID, policy: keepBothPolicy, nameOf: () => 'Ana', nameAt: () => 'Ana', scenes, confirmMapUpdate: async () => 'theirs' });
    const [map] = (await service.refresh('ana')).items;
    await service.pull('ana', map!, [NOTE]);
    expect(files.get('Shared/Ana/Cave.md')).toBe(`text of ${NOTE}`);
    expect([...files.keys()].some((path) => path.includes('Secret room'))).toBe(false);
    expect(pulled.get(TABLE_ID, 'ana', OTHER)).toBeNull();
  });
});
