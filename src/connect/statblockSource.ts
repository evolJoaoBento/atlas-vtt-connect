/**
 * The stat block a token links, read as Atlas reads it (`linkedCreatures` in `packages/atlas-host/src/sheets`, shared
 * with Tabletop), and each note's card as Atlas draws it (`statblockCards.ts`): what players see where their page can
 * show it, unless its template hides fields from players.
 */
import type { App, EventRef } from 'obsidian';
import type { Character } from '@atlas-vtt/api-types';
import type { StatblockSource } from '../app/online/atlas/toolParts';
import { linkedCreatures, notePath } from '../../packages/atlas-host/src/sheets/linkedCreature';
import { templateHidesFields } from '../../packages/atlas-host/src/sheets/templateSheets';
import { captureCard, cardKey, cardKeyParts, StatblockCards } from './statblockCards';

export function obsidianStatblocks(app: App): StatblockSource {
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  const cards = new StatblockCards((key) => {
    const { notePath: path, art } = cardKeyParts(key);
    return captureCard(app, path, art);
  }, notify);
  const linked = linkedCreatures(app, {
    label: 'Atlas VTT Connect',
    onTemplatesRead: () => {
      cards.forget();
      notify();
    },
  });
  return {
    read(token: Character): unknown {
      return linked.read(token);
    },
    card(token: Character) {
      const path = typeof token.statblockPath === 'string' ? notePath(token.statblockPath) : '';
      const imagePath = typeof token.imagePath === 'string' ? token.imagePath : '';
      const art = imagePath ? { imagePath, ringColor: typeof token.ringColor === 'string' ? token.ringColor : undefined, showRing: token.showRing } : null;
      if (!path) return null;
      // Atlas's card shows every field: none where the template hides some from players (Atlas 0.9's `players`), nor
      // while its template is not read; the player gets the text sheet, which leaves them out.
      const templated = linked.templated(path);
      if (templated && (templated.template === undefined || templateHidesFields(templated.template))) return null;
      return cards.get(cardKey(path, art));
    },
    onChange(listener: () => void): () => void {
      // Once a second at most: a note being typed in changes the cache on every keystroke.
      let timer: number | null = null;
      const changed = (): void => {
        if (timer !== null) return;
        timer = window.setTimeout(() => {
          timer = null;
          listener();
        }, 1000);
      };
      listeners.add(changed);
      const stopTemplates = linked.watchTemplates();
      const refs: EventRef[] = [
        app.metadataCache.on('changed', (file) => {
          cards.forget(file.path);
          changed();
        }),
        ...['fantasy-statblocks:bestiary:resolved', 'fantasy-statblocks:bestiary:updated'].map((name) => app.workspace.on(name as never, (() => {
          cards.forget();
          changed();
        }) as never)),
      ];
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        listeners.delete(changed);
        stopTemplates();
        app.metadataCache.offref(refs[0]!);
        for (const ref of refs.slice(1)) app.workspace.offref(ref);
      };
    },
  };
}
