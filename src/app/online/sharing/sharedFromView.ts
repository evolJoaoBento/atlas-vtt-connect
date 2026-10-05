/**
 * The online panel and the Online scene bar open Shared with me without knowing how: the
 * plugin fills this slot while it is loaded (`registerReceiving`), so no view imports the
 * registration code.
 */
import type { App } from 'obsidian';

type SharedOpener = (app: App) => void;

let opener: SharedOpener | null = null;

/** Sets (or, with null, clears) what the views' Shared with me buttons open. */
export function setSharedOpener(next: SharedOpener | null): void {
  opener = next;
}

/** Opens Shared with me from a view's button; does nothing while the plugin is not loaded. */
export function openSharedFromView(app: App): void {
  opener?.(app);
}
