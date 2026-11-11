import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { openPulledNote } from '../../../../src/app/online/sharing/receive/openPulled';

/** The test double of TFile takes its path. */
const fileAt = (path: string): TFile => new (TFile as unknown as new (path: string) => TFile)(path);

function app(files: string[], shown: string[] = []) {
  const openFile = vi.fn(async () => undefined);
  const leaves = shown.map((path) => ({ view: { file: fileAt(path) } }));
  const workspace = {
    iterateAllLeaves: (call: (leaf: unknown) => void) => leaves.forEach(call),
    setActiveLeaf: vi.fn(),
    getLeaf: vi.fn(() => ({ openFile })),
  };
  const byPath = new Map(files.map((path) => [path, fileAt(path)]));
  const made = { vault: { getAbstractFileByPath: (path: string) => byPath.get(path) ?? null }, workspace } as unknown as App;
  return { app: made, workspace, openFile, leaves };
}

describe('a pulled note opens', () => {
  it('in a new tab', async () => {
    const t = app(['Shared/Ana/Cave.md']);
    await openPulledNote(t.app, 'Shared/Ana/Cave.md');
    expect(t.workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(t.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'Shared/Ana/Cave.md' }));
  });

  it('in the tab that already shows it, with no second tab', async () => {
    const t = app(['Shared/Ana/Cave.md'], ['Other.md', 'Shared/Ana/Cave.md']);
    await openPulledNote(t.app, 'Shared/Ana/Cave.md');
    expect(t.workspace.setActiveLeaf).toHaveBeenCalledWith(t.leaves[1], { focus: true });
    expect(t.workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('not for a map, nor a file that is not there', async () => {
    const t = app(['Shared/Ana/Inn.atlasmap']);
    await openPulledNote(t.app, 'Shared/Ana/Inn.atlasmap');
    await openPulledNote(t.app, 'Shared/Ana/Gone.md');
    expect(t.workspace.getLeaf).not.toHaveBeenCalled();
  });
});
