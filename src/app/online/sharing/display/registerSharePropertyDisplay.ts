/**
 * The `atlas-share` property in the share tags' colours, in every open note view (`sharePropertyDom.ts`) and
 * in Source mode's frontmatter (`shareYaml.ts`).
 * A view gets a decorator while it is open; the note's properties, the people list and layout changes
 * refresh them, and everything is taken off again on unload.
 */
import { MarkdownView, type App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { NameResolver } from '../model/audience';
import { SHARE_PROPERTY } from '../model/shareRule';
import type { SharingScope } from '../sharingScope';
import { sharePropertyView } from './shareProperty';
import { SharePropertyDecorator } from './sharePropertyDom';
import { shareYamlExtension } from './shareYaml';
import { refreshShareTags } from './tagDecorations';

export interface ShareDisplayPeople extends NameResolver {
  subscribe(listener: () => void): () => void;
}

function markdownViews(app: App): MarkdownView[] {
  return app.workspace.getLeavesOfType('markdown').flatMap((leaf) => (leaf.view instanceof MarkdownView ? [leaf.view] : []));
}

export function registerSharePropertyDisplay(plugin: SharingScope, people: ShareDisplayPeople): void {
  const { app } = plugin;
  const decorators = new Map<MarkdownView, SharePropertyDecorator>();
  const decoratorOf = (view: MarkdownView): SharePropertyDecorator => {
    let decorator = decorators.get(view);
    if (!decorator) {
      decorator = new SharePropertyDecorator(view.containerEl, () => {
        const file = view.file;
        const frontmatter = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
        return frontmatter && SHARE_PROPERTY in frontmatter ? sharePropertyView(frontmatter[SHARE_PROPERTY], people) : null;
      });
      decorators.set(view, decorator);
    }
    return decorator;
  };
  const refreshAll = (): void => {
    const open = new Set(markdownViews(app));
    for (const [view, decorator] of decorators) {
      if (!open.has(view)) { decorator.destroy(); decorators.delete(view); }
    }
    open.forEach((view) => decoratorOf(view).refresh());
  };
  plugin.registerEditorExtension(shareYamlExtension(people));
  plugin.registerEvent(app.workspace.on('layout-change', refreshAll));
  plugin.registerEvent(app.workspace.on('file-open', refreshAll));
  plugin.registerEvent(app.metadataCache.on('changed', (file) => {
    markdownViews(app).filter((view) => view.file === file).forEach((view) => decoratorOf(view).refresh());
  }));
  const unsubscribe = people.subscribe(() => {
    refreshAll();
    // Names may have become known (or unknown): recolour the frontmatter too.
    markdownViews(app).forEach((view) => (view.editor as unknown as { cm?: EditorView }).cm?.dispatch({ effects: refreshShareTags.of(null) }));
  });
  app.workspace.onLayoutReady(refreshAll);
  plugin.register(() => {
    unsubscribe();
    decorators.forEach((decorator) => decorator.destroy());
    decorators.clear();
  });
}
