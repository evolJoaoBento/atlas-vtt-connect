/**
 * What the join page shows for the session: the name form, a full-screen message
 * (connecting, waiting to be let in or for a scene, refused, ended), or the table with
 * the map. A player who was in keeps the map while reconnecting. Pure; the page shows
 * the texts through `textContent`. Shared with the web page.
 */
import type { PlayerSessionState } from '../PlayerSession';

export type PageScreen =
  | { kind: 'form' }
  /** `loading`: the page is waiting on something (the GM, the connection) and shows a loader beside the text. */
  | { kind: 'message'; text: string; loading?: true }
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
  'local-relay-unavailable': 'O servidor local do mestre está inacessível. Ele precisa manter o computador, o servidor e o túnel abertos e reenviar o link atual.',
  'local-relay-auth': 'A configuração privada do servidor local está incompleta. O mestre deve executar o iniciador novamente.',
  unreachable: UNREACHABLE_TEXT,
  'host-offline': 'Mestre não encontrado. Confira se o Obsidian e a sessão Online continuam abertos e peça um link novo.',
  'invalid-link': 'O identificador da sessão é inválido. Peça ao mestre o link completo da sessão atual.',
  offline: 'Este dispositivo está sem conexão de rede. Reconecte a internet e tente novamente.',
  'browser-incompatible': 'Este navegador não oferece o WebRTC necessário. Abra o link no Chrome, Edge ou Firefox atualizado.',
  'signaling-unavailable': 'Não foi possível alcançar o serviço que localiza a mesa. Confira a internet, bloqueios do navegador e a configuração do servidor de sinalização.',
  'relay-needed': 'O serviço de conexão respondeu, mas a ligação com o mestre não abriu e o link não contém TURN. Entre redes de casas diferentes, configure um servidor TURN no Connect e gere um novo link.',
  'relay-failed': 'A ligação com o mestre não abriu, mesmo com TURN configurado. O mestre deve testar os servidores no Connect, conferir as credenciais e reenviar o link atualizado.',
  'webrtc-failed': 'A conexão WebRTC falhou. Confira as restrições de rede e teste um servidor TURN/TCP ou TURNS na porta 443.',

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
      return { kind: 'message', text: 'Waiting for the GM to let you in…', loading: true };
    case 'connecting':
      return hasScene ? { kind: 'table', title, connection: 'Reconnecting…' } : { kind: 'message', text: 'Connecting…', loading: true };
    case 'admitted':
      return hasScene
        ? { kind: 'table', title, connection: 'Connected' }
        : { kind: 'message', text: `Connected to ${title}. Waiting for the GM to show a scene.` };
  }
}
