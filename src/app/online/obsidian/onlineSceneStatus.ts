/**
 * The Online scene's status bar from the session state: the GM's session title, the connection,
 * and why the session waits or ended, in the join page's words. Reconnect is offered when the
 * connection was lost or never made.
 */
import { sessionReasonText } from '../page/pageScreen';
import type { PlayerSessionState } from '../PlayerSession';
import { DEFAULT_TABLE_TITLE, type OnlineSceneStatus } from './onlineJoinTypes';

export const LOST_CONNECTION_TEXT = 'Lost the connection to your GM.';
export const NO_SCENE_TEXT = 'Waiting for the GM to show a scene.';
export const WAITING_TEXT = 'Waiting for the GM to let you in…';

export function onlineSceneStatus(state: PlayerSessionState | null, hasScene: boolean): OnlineSceneStatus {
  const title = state?.title ?? DEFAULT_TABLE_TITLE;
  switch (state?.status ?? 'connecting') {
    case 'admitted':
      return { title, connection: 'Connected', tone: 'connected', message: hasScene ? null : NO_SCENE_TEXT, reconnect: false };
    case 'connecting':
      return { title, connection: hasScene ? 'Reconnecting…' : 'Connecting…', tone: 'pending', message: null, reconnect: false };
    case 'waiting':
      return { title, connection: 'Waiting for the GM', tone: 'pending', message: WAITING_TEXT, reconnect: false };
    case 'denied':
      return { title, connection: 'Disconnected', tone: 'ended', message: sessionReasonText(state?.reason, 'denied'), reconnect: false };
    case 'lost': {
      const reason = state?.reason ?? 'unreachable';
      return {
        title,
        connection: 'Disconnected',
        tone: 'ended',
        message: reason === 'connection-lost' ? LOST_CONNECTION_TEXT : sessionReasonText(reason, 'unreachable'),
        reconnect: reason === 'connection-lost' || reason === 'unreachable',
      };
    }
  }
}
