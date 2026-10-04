/**
 * "Online session…" and the status bar item. The fork opened the online panel in an Atlas view;
 * that panel comes with Atlas's UI slots (plan B11), so until then this is the Obsidian modal.
 */
import type { App } from 'obsidian';
import { openOnlineSessionModal } from './OnlineSessionModal';

export function openOnlineSession(app: App): void {
  openOnlineSessionModal(app);
}
