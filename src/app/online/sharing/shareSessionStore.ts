/** The share session this Atlas is in (hosting or joined, with a checked table), for the Shared with me dialog. */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ShareNode } from './transport/ShareNode';

/** Shown when sharing needs a session and there is none (Ask to pull, and Shared with me). */
export const NO_SHARE_SESSION_TEXT = 'Join or host an online session to see what people share with you.';

export interface SessionPerson {
  personId: string;
  name: string;
}

export interface ShareSession {
  role: 'gm' | 'player';
  tableId: string;
  self: string;
  node: ShareNode;
}

export interface PushRequest {
  from: string;
  item: string;
  kind: 'note' | 'map';
  title: string;
  at: number;
}

export interface ShareSessionState {
  session: ShareSession | null;
  /** Everyone else in the session who takes part in sharing, by the names in this Atlas's people list. */
  people: SessionPerson[];
  pushes: PushRequest[];
}

export const shareSessionStore: StoreApi<ShareSessionState> = createStore<ShareSessionState>(() => ({ session: null, people: [], pushes: [] }));

/** A push request: one per sender and item; a repeated one only moves to the top. */
export function addPush(push: PushRequest): void {
  const others = shareSessionStore.getState().pushes.filter((known) => known.from !== push.from || known.item !== push.item);
  shareSessionStore.setState({ pushes: [push, ...others].slice(0, 50) });
}

export function dismissPush(from: string, item: string): void {
  shareSessionStore.setState({ pushes: shareSessionStore.getState().pushes.filter((push) => push.from !== from || push.item !== item) });
}
