/**
 * What the join page shows for the session: the name form, a full-screen message
 * (connecting, waiting to be let in or for a scene, refused, ended), or the table with
 * the map. A player who was in keeps the map while reconnecting. Pure; the page shows
 * the texts through `textContent`. Shared with the web page.
 */
import type { PlayerSessionState } from '../PlayerSession';

export type PageScreen =
  | { kind: 'form' }
  /**
   * `loading`: the page is waiting on something (the GM, the connection) and shows a loader beside the text. `rejoin`:
   * the connection was lost, and a Reconnect button joins again.
   */
  | { kind: 'message'; text: string; loading?: true; rejoin?: true }
  /** `reconnect`: the connection dropped and is being tried again; a Reconnect button tries at once. */
  | { kind: 'table'; title: string; connection: string; reconnect?: true };

export const INCOMPLETE_LINK_TEXT = 'This link is incomplete. Ask your GM for the join link again.';
export const NAME_PROBLEM_TEXT = 'Enter a name of up to 40 characters.';
export const NO_CANVAS_TEXT = "This browser can't draw the map. Try another browser.";

/** A page or player that is not a build of the GM's fusion step. */
export const STALE_PAGE_TEXT = 'This table needs the updated player page';
/** A move refused because the GM's Atlas holds another map just now. */
export const NOT_HELD_TEXT = "The GM's Atlas is on another map; try again in a moment.";
/** A spell or a template refused because the player, or the scene, has as many as it may. */
export const LIMIT_TEXT = 'No more spells or templates here: remove one first.';
/** A spell or a template refused because the map's level holds as many areas as Atlas keeps. */
export const FULL_TEXT = 'This map holds no more areas: ask your GM to clear some.';

const DENIED_TEXT = 'The GM did not let you in.';
const UNREACHABLE_TEXT = "Couldn't connect. Check the link, or your GM may need to add a relay server in Atlas settings.";
const REASONS: Record<string, string> = {
  denied: DENIED_TEXT,
  kicked: 'The GM removed you from the session.',
  full: 'The session is full.',
  version: STALE_PAGE_TEXT,
  ended: 'The session ended.',
  replaced: 'You joined from another tab.',
  unreachable: UNREACHABLE_TEXT,
  'connection-lost': 'Lost the connection to your GM.',
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
      // Lost after being let in: joining again is one tap.
      return state.reason === 'connection-lost'
        ? { kind: 'message', text: sessionReasonText(state.reason, 'unreachable'), rejoin: true }
        : { kind: 'message', text: sessionReasonText(state.reason, 'unreachable') };
    case 'waiting':
      return { kind: 'message', text: 'Waiting for the GM to let you in…', loading: true };
    case 'connecting':
      return hasScene ? { kind: 'table', title, connection: 'Reconnecting…', reconnect: true } : { kind: 'message', text: 'Connecting…', loading: true };
    case 'admitted':
      return hasScene
        ? { kind: 'table', title, connection: 'Connected' }
        : { kind: 'message', text: `Connected to ${title}. Waiting for the GM to show a scene.` };
  }
}
