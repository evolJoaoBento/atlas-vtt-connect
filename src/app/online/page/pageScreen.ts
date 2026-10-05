/**
 * What the join page shows for the session: the name form, a full-screen message
 * (connecting, waiting to be let in or for a scene, refused, ended), or the table with
 * the map. A player who was in keeps the map while reconnecting. Pure; the page shows
 * the texts through `textContent`. Shared with the web page.
 */
import type { PlayerSessionState } from '../PlayerSession';

export type PageScreen =
  | { kind: 'form' }
  | { kind: 'message'; text: string }
  | { kind: 'table'; title: string; connection: string };

export const INCOMPLETE_LINK_TEXT = 'This link is incomplete. Ask your GM for the join link again.';
export const NAME_PROBLEM_TEXT = 'Enter a name of up to 40 characters.';
export const NO_CANVAS_TEXT = "This browser can't draw the map. Try another browser.";

const DENIED_TEXT = 'The GM did not let you in.';
const UNREACHABLE_TEXT = "Couldn't connect. Check the link, or your GM may need to add a relay server in Atlas settings.";
const REASONS: Record<string, string> = {
  denied: DENIED_TEXT,
  kicked: 'The GM removed you from the session.',
  full: 'The session is full.',
  version: 'This page is out of date for your GM\'s Atlas. Ask them for a new link.',
  ended: 'The session ended.',
  replaced: 'You joined from another tab.',
  unreachable: UNREACHABLE_TEXT,
  'connection-lost': 'Lost the connection to your GM. Reload the page to try again.',
};
/** Why a session ended, as the join page says it. Own keys only: a reason from the network such as `constructor` must not reach the prototype. */
export function sessionReasonText(reason: string | null | undefined, fallback: 'denied' | 'unreachable'): string {
  const key = reason ?? fallback;
  return Object.hasOwn(REASONS, key) ? REASONS[key]! : REASONS[fallback]!;
}
const DEFAULT_TITLE = 'the table';

export function pageScreen(state: PlayerSessionState | null, hasScene: boolean): PageScreen {
  if (!state) return { kind: 'form' };
  const title = state.title ?? DEFAULT_TITLE;
  switch (state.status) {
    case 'denied':
      return { kind: 'message', text: sessionReasonText(state.reason, 'denied') };
    case 'lost':
      return { kind: 'message', text: sessionReasonText(state.reason, 'unreachable') };
    case 'waiting':
      return { kind: 'message', text: 'Waiting for the GM to let you in…' };
    case 'connecting':
      return hasScene ? { kind: 'table', title, connection: 'Reconnecting…' } : { kind: 'message', text: 'Connecting…' };
    case 'admitted':
      return hasScene
        ? { kind: 'table', title, connection: 'Connected' }
        : { kind: 'message', text: `Connected to ${title}. Waiting for the GM to show a scene.` };
  }
}
