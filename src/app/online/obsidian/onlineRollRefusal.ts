/**
 * Why a roll from the scene tab did not go, in the words the dice tray shows:
 * the session's state says whether the player waits, reconnects or is out, so "check your
 * connection" is said only when the player is in and the link still failed.
 */
import type { PlayerSessionState } from '../PlayerSession';

export const ROLL_NOT_SENT_TEXT = "Couldn't send the roll. Check your connection.";
export const ROLL_WAITING_TEXT = "The GM hasn't let you in yet.";
export const ROLL_RECONNECTING_TEXT = 'Reconnecting to your GM. Roll again once you are back in.';
export const ROLL_CONNECTION_LOST_TEXT = 'Lost the connection to your GM. Reconnect, then roll again.';
export const ROLL_SESSION_ENDED_TEXT = 'The session has ended. Join again to roll.';

/** Why the session refused a roll, from its state at that moment. */
export function rollRefusal(state: PlayerSessionState | null): string {
  switch (state?.status) {
    case 'admitted':
      return ROLL_NOT_SENT_TEXT;
    case 'waiting':
      return ROLL_WAITING_TEXT;
    case 'connecting':
      return ROLL_RECONNECTING_TEXT;
    case 'lost':
      return state.reason === 'connection-lost' || state.reason === 'unreachable' ? ROLL_CONNECTION_LOST_TEXT : ROLL_SESSION_ENDED_TEXT;
    default:
      return ROLL_SESSION_ENDED_TEXT;
  }
}
