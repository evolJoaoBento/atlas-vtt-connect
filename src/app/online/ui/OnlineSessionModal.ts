import { App, Modal, Notice, setIcon } from 'obsidian';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../ui/nativeModal';
import { OnlineSessionService } from '../OnlineSessionService';
import { onlineSessionStore, type OnlineSessionState } from '../onlineSessionStore';

const STATUS_TEXT: Record<OnlineSessionState['status'], string> = {
  idle: 'Not hosting. Start a session to get a link your players can open in a browser.',
  starting: 'Starting…',
  hosting: 'Hosting. Share the link; you approve each player who joins.',
  error: 'Could not start the session.',
};

/** Start or stop the online session, share its link, and manage players. */
export class OnlineSessionModal extends Modal {
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, private readonly service: OnlineSessionService) {
    super(app);
    this.modalEl.addClasses([...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-connect-session-modal']);
  }

  onOpen(): void {
    this.titleEl.setText('Online session');
    this.render(onlineSessionStore.getState());
    this.unsubscribe = onlineSessionStore.subscribe((state) => this.render(state));
  }

  onClose(): void {
    this.unsubscribe?.();
    this.contentEl.empty();
  }

  private render(state: OnlineSessionState): void {
    const el = this.contentEl;
    el.empty();
    el.createEl('p', { cls: 'atlas-connect-session-modal__status', text: STATUS_TEXT[state.status] });
    if (state.error) el.createEl('p', { cls: 'atlas-connect-session-modal__error', text: state.error });

    if (state.status === 'hosting' && state.joinUrl) {
      const row = el.createDiv({ cls: 'atlas-connect-session-modal__link' });
      row.createEl('input', { type: 'text', attr: { readonly: 'true', value: state.joinUrl, 'aria-label': 'Join link' } });
      const copy = row.createEl('button', { text: 'Copy link' });
      const url = state.joinUrl;
      copy.addEventListener('click', () => { void navigator.clipboard.writeText(url).then(() => new Notice('Join link copied')); });
    }

    const players = state.players;
    if (players.length) {
      const list = el.createEl('ul', { cls: 'atlas-connect-session-modal__players' });
      for (const player of players) {
        const item = list.createEl('li', { cls: `atlas-connect-session-modal__player atlas-connect-session-modal__player--${player.status}` });
        const dot = item.createSpan({ cls: 'atlas-connect-session-modal__dot' });
        setIcon(dot, player.status === 'pending' ? 'hourglass' : 'circle');
        item.createSpan({ cls: 'atlas-connect-session-modal__name' }).setText(player.name);
        item.createSpan({ cls: 'atlas-connect-session-modal__state', text: player.status === 'pending' ? 'wants to join' : player.status === 'gone' ? 'disconnected' : 'connected' });
        if (player.status === 'pending') {
          item.createEl('button', { cls: 'mod-cta', text: 'Allow' }).addEventListener('click', () => this.service.allow(player.playerId));
          item.createEl('button', { text: 'Deny' }).addEventListener('click', () => this.service.deny(player.playerId));
        } else {
          item.createEl('button', { text: 'Remove' }).addEventListener('click', () => this.service.kick(player.playerId));
        }
      }
    }

    const footer = el.createDiv({ cls: 'atlas-connect-session-modal__footer' });
    if (state.status === 'hosting') {
      footer.createEl('button', { cls: 'mod-warning', text: 'Stop session' }).addEventListener('click', () => this.service.stop());
    } else {
      const start = footer.createEl('button', { cls: 'mod-cta', text: state.status === 'error' ? 'Try again' : 'Start session' });
      start.disabled = state.status === 'starting';
      start.addEventListener('click', () => void this.service.start());
    }
  }
}

export function openOnlineSessionModal(app: App): void {
  const service = OnlineSessionService.forApp(app);
  if (service) new OnlineSessionModal(app, service).open();
}
