import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueItem, SharePayload } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { forTable } from '../../../../src/app/online/sharing/transport/forTable';
import { ShareError, ShareNode, type ShareNodeOptions } from '../../../../src/app/online/sharing/transport/ShareNode';
import { decodeShare } from '../../../../src/app/online/sharing/transport/shareProtocol';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID, testPerson } from './sharingFixtures';

type Catalogue = ShareNodeOptions['catalogue'];

/** Nodes wired by person id; every frame is recorded as text, so a test can see what crossed. */
function network() {
  const nodes = new Map<string, ShareNode>();
  const frames: string[] = [];
  const add = (self: string, catalogue: Catalogue, onPush: ShareNodeOptions['onPush'] = () => {}): ShareNode => {
    const node = new ShareNode({
      self, catalogue, hash: nodeHash, onPush,
      send: (to, data) => {
        frames.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
        queueMicrotask(() => {
          const target = nodes.get(to);
          const decoded = decodeShare(data);
          if (!target) return;
          if (decoded.kind === 'chunk') target.chunk(`from-${self}`, decoded.chunk);
          else if (decoded.kind === 'message' && decoded.message.from) target.receive(`from-${self}`, { ...decoded.message, from: decoded.message.from });
        });
      },
    });
    nodes.set(self, node);
    return node;
  };
  return { add, frames };
}

const ana = testPerson('ana', 'Ana');
const none: Catalogue = { list: async () => [], open: async () => null };
afterEach(() => { vi.useRealTimers(); });

describe('ShareNode', () => {
  it('lists and pulls a note, and sends only the filtered text', async () => {
    const { add, frames } = network();
    const notes = noteCatalogue({ 'Notes/Cave.md': { text: 'A cave.\n> [!private]\n> Dragon gold.\n\nEnd.', share: ['Ana'] } }, [ana]);
    add('gm', forTable(notes, TABLE_ID, 'gm'));
    const player = add('ana', none);
    const items = await player.requestList('gm');
    expect(items.map((item: CatalogueItem) => item.title)).toEqual(['Cave']);
    const pulled = await player.pull('gm', items[0]!.item, 'note');
    // The old callout hides the rest of the note.
    expect(new TextDecoder().decode(pulled.bytes)).toBe('A cave.');
    expect(pulled.version).toBe(items[0]!.version);
    expect(frames.join('\n')).not.toContain('Dragon');
  });

  it('denies what is not shared and refuses an item whose bytes do not match its version', async () => {
    const { add } = network();
    const liar: Catalogue = {
      list: async () => [],
      open: async (): Promise<SharePayload> => ({ kind: 'note', bytes: new TextEncoder().encode('x').buffer as ArrayBuffer, version: 'X'.repeat(43) }),
    };
    add('gm', none);
    add('liar', liar);
    const player = add('ana', none);
    await expect(player.pull('gm', 'i'.repeat(22), 'note')).rejects.toMatchObject({ reason: 'not-shared' });
    await expect(player.pull('liar', 'i'.repeat(22), 'note')).rejects.toMatchObject({ reason: 'failed' });
  });

  it('passes a push request up and does nothing else', async () => {
    const { add } = network();
    const pushes: unknown[] = [];
    const gm = add('gm', none);
    add('ana', none, (from, push) => pushes.push({ from, ...push }));
    gm.push('ana', 'i'.repeat(22), 'note', 'Cave');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pushes).toEqual([{ from: 'gm', item: 'i'.repeat(22), kind: 'note', title: 'Cave' }]);
  });

  it('pulls a map’s many images one after another without being told busy', async () => {
    const { add } = network();
    const image = new TextEncoder().encode('png').buffer as ArrayBuffer;
    const version = await nodeHash(image);
    const images: Catalogue = {
      list: async () => [],
      open: async (_person, ref): Promise<SharePayload | null> => (ref.includes('/') ? { kind: 'image', bytes: image, version, mime: 'image/png' } : null),
    };
    add('gm', images);
    const player = add('ana', none);
    for (let index = 0; index < 12; index++) {
      await expect(player.pull('gm', `${'m'.repeat(22)}/${version}`, 'image')).resolves.toMatchObject({ kind: 'image', version });
    }
  });

  it('answers busy past the rate limit', async () => {
    const { add } = network();
    add('gm', none);
    const player = add('ana', none);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => player.requestList('gm')));
    expect(results.some((result) => result.status === 'rejected' && (result.reason as ShareError).reason === 'busy')).toBe(true);
  });

  it('times out a request nobody answers, and fails pending pulls when the peer goes', async () => {
    vi.useFakeTimers();
    const { add } = network();
    const player = add('ana', none);
    const listed = player.requestList('nobody');
    const pulled = player.pull('gm', 'i'.repeat(22), 'note');
    player.peerGone('gm');
    await expect(pulled).rejects.toMatchObject({ reason: 'gone' });
    vi.advanceTimersByTime(15_000);
    await expect(listed).rejects.toMatchObject({ reason: 'timeout' });
  });
});
