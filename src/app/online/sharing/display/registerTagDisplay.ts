/**
 * Shows share tags as labels and highlights wherever Obsidian shows a note: the editor (Live Preview and
 * Source mode) and everything rendered with section info (reading view, Atlas's note previews, which open
 * real leaves). The block context is the note's sections when they fit the text, else inline only.
 */
import { editorInfoField, MarkdownView, TFile, type App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { BlockContext } from '../model/codeContext';
import { textBlocksOf } from '../model/noteSections';
import type { SharingScope } from '../sharingScope';
import { decorateSection } from './readingView';
import { refreshShareTags, shareTagEditorExtension } from './tagDecorations';

function blocksOf(app: App, file: TFile | null, text: string): BlockContext {
  if (!file) return 'inline-only';
  return textBlocksOf(text, app.metadataCache.getFileCache(file)?.sections) ?? 'inline-only';
}

/** The CodeMirror view of a Markdown view's editor (not in Obsidian's typings; see "Communicating with editor extensions"). */
const editorViewOf = (view: MarkdownView): EditorView | undefined => (view.editor as unknown as { cm?: EditorView }).cm;

export function registerTagDisplay(plugin: SharingScope): void {
  const { app } = plugin;
  plugin.registerEditorExtension(shareTagEditorExtension((state) => blocksOf(app, state.field(editorInfoField, false)?.file ?? null, state.doc.toString())));
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
    const note = file instanceof TFile ? file : null;
    // Keyed by the cache's sections array: a new parse gives a new array, so the model is read again.
    decorateSection(el, info, { key: note ? app.metadataCache.getFileCache(note)?.sections ?? 'no-sections' : 'inline-only', read: () => blocksOf(app, note, info.text) });
  });
  // Sections arrive after an edit: let open editors of the note read them again.
  plugin.registerEvent(app.metadataCache.on('changed', (file) => {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file) editorViewOf(leaf.view)?.dispatch({ effects: refreshShareTags.of(null) });
    }
  }));
}
