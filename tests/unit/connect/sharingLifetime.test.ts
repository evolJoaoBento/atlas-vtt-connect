import { describe, expect, it } from 'vitest';
import type { Plugin } from 'obsidian';
import AtlasVttConnectPlugin from '../../../main';
import { sharingLifetime } from '../../../src/app/online/sharing/sharingLifetime';
import { fakeEvents, fakeWorkspaceApp } from '../../fake/fakeWorkspace';

/** An app whose vault and metadata cache events are counted, with no Atlas installed. */
function appWithEvents(): { app: Plugin['app']; vault: ReturnType<typeof fakeEvents>; cache: ReturnType<typeof fakeEvents> } {
  const { app } = fakeWorkspaceApp();
  const vault = fakeEvents();
  const cache = fakeEvents();
  Object.assign(app, { vault: { on: vault.on, offref: vault.offref }, metadataCache: { on: cache.on, offref: cache.offref } });
  return { app, vault, cache };
}

describe('what sharing hears for the plugin\'s lifetime', () => {
  it('starts in onload, before Atlas is there: edits, parses, renames and deletions are heard from the start', async () => {
    const { app, vault, cache } = appWithEvents();
    const plugin = new AtlasVttConnectPlugin(app as never, { id: 'atlas-vtt-connect', version: '0.1.0' } as never);
    Object.assign(plugin, {
      loadData: async () => null, saveData: async () => undefined, registerView: () => undefined,
      registerEvent: () => undefined, register: () => undefined,
    });
    await plugin.onload();
    expect([vault.count('modify'), vault.count('rename'), vault.count('delete'), cache.count('changed')].every((count) => count > 0)).toBe(true);
  });

  it('keeps a note edited before Atlas is bound untrusted until Obsidian parses it again', () => {
    const { app, vault, cache } = appWithEvents();
    const { sections } = sharingLifetime({ app, registerEvent: () => undefined });
    const parsed = [{ type: 'paragraph', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 4, offset: 4 } } }];
    vault.fire('modify', { path: 'N.md' });
    expect(sections.trusted('N.md', 'Text', parsed)).toBeNull();
    cache.fire('changed', { path: 'N.md' }, 'Text', {});
    expect(sections.trusted('N.md', 'Text', parsed)).toBe(parsed);
  });

  it('keeps the renames and deletions made while sharing is not bound, in order, for the next binding', () => {
    const { app, vault } = appWithEvents();
    const { vaultChanges } = sharingLifetime({ app, registerEvent: () => undefined });
    vault.fire('rename', { path: 'B.md' }, 'A.md');
    vault.fire('delete', { path: 'C.md' });
    const heard: unknown[] = [];
    const stop = vaultChanges.attach((change) => heard.push(change));
    vault.fire('delete', { path: 'D.md' });
    expect(heard).toEqual([{ rename: ['A.md', 'B.md'] }, { removed: 'C.md' }, { removed: 'D.md' }]);
    stop();
    vault.fire('delete', { path: 'E.md' });
    expect(heard).toHaveLength(3);
    vaultChanges.attach((change) => heard.push(change));
    expect(heard.at(-1)).toEqual({ removed: 'E.md' });
  });
});
