/**
 * "Online session…" and the status bar item: the online panel in an Atlas view when Atlas has UI slots and a GM
 * view shows them, else the Obsidian modal.
 */
import type { App } from 'obsidian';
import { openOnlineSessionModal } from './OnlineSessionModal';

/** The panel of Atlas's UI slots (`registerGmUi`); absent when this Atlas has no `ui`. */
export interface PanelOpener {
  /** True when the panel opened in a GM map view. */
  openPanel(app: App): boolean;
}

export function openOnlineSession(app: App, panel?: PanelOpener): void {
  if (!panel?.openPanel(app)) openOnlineSessionModal(app);
}
