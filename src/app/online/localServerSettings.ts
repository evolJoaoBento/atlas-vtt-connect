import type { App } from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, type OnlineSettings } from './onlineSettings';
import { validRelayTarget } from './transport/relayWire';

export const LOCAL_SERVER_CONFIG = 'RPG/Servidores/atlas-local/.runtime/server-config.json';

/** The installed local server is authoritative; never copy its administrative key into an invite. */
export function parseLocalServerSettings(text: string): Partial<OnlineSettings> {
  const config: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!config || typeof config !== 'object') throw new Error('Configuração do servidor local inválida. Execute INICIAR SERVIDOR.');
  const value = config as Record<string, unknown>;
  if (!validRelayTarget({ url: value.publicUrl, token: value.adminKey })) throw new Error('Servidor local sem endereço válido. Execute INICIAR SERVIDOR.');
  return { playerPageUrl: DEFAULT_ONLINE_SETTINGS.playerPageUrl, localRelay: { url: value.publicUrl as string, adminKey: value.adminKey as string } };
}

export async function applyLocalServerSettings(app: App, settings: { set(value: Partial<OnlineSettings>): void }): Promise<void> {
  const adapter = app.vault?.adapter;
  if (!adapter?.exists || !await adapter.exists(LOCAL_SERVER_CONFIG)) return;
  settings.set(parseLocalServerSettings(await adapter.read(LOCAL_SERVER_CONFIG)));
}
