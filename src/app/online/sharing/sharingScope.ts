/**
 * What sharing registers lives as long as Connect is bound to Atlas, not as long as the plugin: an Atlas reload
 * starts sharing again, so everything it added must come off first (no second menu item, no rename handled twice).
 * A scope registers like a plugin does (`addCommand`, `registerEvent`, `register`) and `dispose` takes it all off.
 * Editor extensions and Markdown post-processors cannot be taken off one by one in Obsidian: the plugin registers one
 * of each, once, and a scope adds its own to them and takes them out again.
 */
import { Component, type App, type Command, type EventRef, type MarkdownPostProcessor, type Plugin } from 'obsidian';
import type { Extension } from '@codemirror/state';

export interface SharingScope {
  readonly app: App;
  addCommand(command: Command): void;
  registerEvent(ref: EventRef): void;
  register(cleanup: () => void): void;
  registerEditorExtension(extension: Extension): void;
  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): void;
}

export type ScopePlugin = Pick<Plugin, 'app' | 'addCommand' | 'removeCommand' | 'registerEvent' | 'registerEditorExtension' | 'registerMarkdownPostProcessor'>;

/** The plugin's one editor extension list and post-processor, which scopes add to. */
interface DisplayHost {
  extensions: Extension[];
  processors: Set<MarkdownPostProcessor>;
}

const hosts = new WeakMap<ScopePlugin, DisplayHost>();

function displayHost(plugin: ScopePlugin): DisplayHost {
  let host = hosts.get(plugin);
  if (!host) {
    const made: DisplayHost = { extensions: [], processors: new Set() };
    // Obsidian reads the list again on `updateOptions`, so it can change while the plugin stays loaded.
    plugin.registerEditorExtension(made.extensions);
    plugin.registerMarkdownPostProcessor(async (el, ctx) => {
      for (const processor of [...made.processors]) await processor(el, ctx);
    });
    hosts.set(plugin, made);
    host = made;
  }
  return host;
}

export function sharingScope(plugin: ScopePlugin): SharingScope & { dispose(): void } {
  const component = new Component();
  component.load();
  const commands: string[] = [];
  const refresh = (): void => plugin.app.workspace.updateOptions();
  return {
    app: plugin.app,
    addCommand: (command) => {
      plugin.addCommand(command);
      commands.push(command.id);
    },
    registerEvent: (ref) => component.registerEvent(ref),
    register: (cleanup) => component.register(cleanup),
    registerEditorExtension: (extension) => {
      const { extensions } = displayHost(plugin);
      extensions.push(extension);
      refresh();
      component.register(() => {
        const at = extensions.indexOf(extension);
        if (at >= 0) extensions.splice(at, 1);
        refresh();
      });
    },
    registerMarkdownPostProcessor: (processor) => {
      const { processors } = displayHost(plugin);
      processors.add(processor);
      component.register(() => processors.delete(processor));
    },
    dispose: () => {
      for (const id of commands.splice(0)) plugin.removeCommand(id);
      component.unload();
    },
  };
}
