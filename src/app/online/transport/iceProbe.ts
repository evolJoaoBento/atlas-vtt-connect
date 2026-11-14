import { hasTurnServer } from './connectionFailure';

export const ICE_PROBE_TIMEOUT_MS = 10_000;
export interface IceProbeResult {
  supported: boolean;
  relayConfigured: boolean;
  relayReached: boolean;
  directReached: boolean;
  errorCodes: number[];
}

/** Checks the configured servers without contacting a player, reading IPs or logging credentials. */
export function probeIceServers(servers: readonly RTCIceServer[]): Promise<IceProbeResult> {
  const result: IceProbeResult = { supported: typeof RTCPeerConnection !== 'undefined', relayConfigured: hasTurnServer(servers), relayReached: false, directReached: false, errorCodes: [] };
  if (!result.supported) return Promise.resolve(result);
  return new Promise((resolve) => {
    let peer: RTCPeerConnection;
    try { peer = new RTCPeerConnection({ iceServers: [...servers] }); }
    catch { resolve(result); return; }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      peer.close();
      resolve(result);
    };
    const timer = window.setTimeout(finish, ICE_PROBE_TIMEOUT_MS);
    peer.onicecandidate = (event) => {
      if (done) return;
      if (!event.candidate) { finish(); return; }
      result.relayReached ||= event.candidate.type === 'relay';
      result.directReached ||= event.candidate.type === 'srflx';
    };
    peer.onicecandidateerror = (event) => {
      if (!done && Number.isInteger(event.errorCode) && !result.errorCodes.includes(event.errorCode) && result.errorCodes.length < 8) result.errorCodes.push(event.errorCode);
    };
    try {
      peer.createDataChannel('atlas-network-check');
      void peer.createOffer().then((offer) => { if (!done) return peer.setLocalDescription(offer); }).catch(finish);
    } catch { finish(); }
  });
}

export function iceProbeText(result: IceProbeResult): string {
  if (!result.supported) return 'WebRTC indisponível neste aplicativo ou navegador.';
  if (result.relayReached) return 'Servidor TURN acessível. A conexão entre as duas casas ainda precisa ser testada com o jogador.';
  if (!result.relayConfigured) return 'Nenhum servidor TURN configurado. Redes residenciais diferentes podem bloquear a conexão direta. Configure TURN e gere um novo link.';
  return 'Não foi possível obter uma rota TURN. Confira endereço, usuário, senha e disponibilidade do servidor; teste uma opção TURNS/TCP na porta 443.';
}
