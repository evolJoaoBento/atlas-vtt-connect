/** The session this Obsidian joined, as the Join dialog follows it; written by `OnlineJoinService`. */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PlayerSessionState } from '../PlayerSession';

export interface JoinedSessionState {
  /** The joined session as the player has it; null while this device joins none. */
  session: PlayerSessionState | null;
}

export const joinedSessionStore: StoreApi<JoinedSessionState> = createStore<JoinedSessionState>(() => ({ session: null }));

/** Whether a joined session is still on: connecting, waiting or admitted (not denied or lost). */
export function isInSession(state: JoinedSessionState): boolean {
  const status = state.session?.status;
  return status === 'connecting' || status === 'waiting' || status === 'admitted';
}
