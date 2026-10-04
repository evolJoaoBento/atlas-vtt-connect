import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TokenControl } from './control/TokenControl';
import type { SessionPlayer } from './GmSession';
import type { JoinIdentity } from './sharing/people/IdentityDesk';

export interface OnlineSessionState {
  status: 'idle' | 'starting' | 'hosting' | 'error';
  peerId: string | null;
  joinUrl: string | null;
  players: SessionPlayer[];
  error: string | null;
  /** Who may move which token while hosting; null otherwise. The token menu reads it. */
  tokenControl: TokenControl | null;
  /** Who each waiting Obsidian player is, by player id, once their device proof checked. */
  requests: Record<string, JoinIdentity>;
}

const INITIAL_STATE: OnlineSessionState = { status: 'idle', peerId: null, joinUrl: null, players: [], error: null, tokenControl: null, requests: {} };

/** The online session as the GM's UI sees it, written by `OnlineSessionService`. */
export const onlineSessionStore: StoreApi<OnlineSessionState> = createStore<OnlineSessionState>(() => INITIAL_STATE);

export function resetOnlineSessionStore(): void {
  onlineSessionStore.setState(INITIAL_STATE);
}
