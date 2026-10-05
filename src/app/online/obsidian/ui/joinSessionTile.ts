/**
 * The dashboard's "Join online session" tile (API `ui`): it opens the Join dialog, as the command and the
 * Online panel do. While Obsidian hosts or is already in a session, the dialog's Join refuses with its own
 * reason (`JOIN_PROBLEM_TEXT`).
 */
import type { App } from 'obsidian';
import type { DashboardTile } from '@atlas-vtt/api-types';
import { openJoinSessionModal } from './JoinSessionModal';

export function joinSessionTile(app: App): DashboardTile {
  return {
    id: 'join-online-session',
    icon: 'log-in',
    title: 'Join online session',
    description: "Paste a GM's link to play",
    onClick: () => openJoinSessionModal(app),
  };
}
