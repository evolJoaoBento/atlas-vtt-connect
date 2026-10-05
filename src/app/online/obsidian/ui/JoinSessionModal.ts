/**
 * "Join online session…": the GM's join link and the player's name, then the session's progress
 * until the GM lets them in (the Online scene tab opens and this closes) or not (the reason
 * shows and Join is offered again). Closing it before admission cancels the join.
 */
import { Modal, Notice, Setting, type App } from 'obsidian';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../ui/nativeModal';
import { sessionReasonText } from '../../page/pageScreen';
import type { PlayerSessionState } from '../../PlayerSession';
import { joinedSessionStore } from '../joinedSessionStore';
import { JOIN_PROBLEM_TEXT } from '../onlineJoinTypes';
import { OnlineJoinService } from '../OnlineJoinService';

export const JOIN_DIALOG_TITLE = 'Join online session';

type JoinPort = Pick<OnlineJoinService, 'join' | 'leave'>;

export class JoinSessionModal extends Modal {
  private link = '';
  private name: string;
  private joining = false;
  private admitted = false;
  private statusEl: HTMLElement | null = null;
  private joinButton: HTMLButtonElement | null = null;
  private linkInput: HTMLInputElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, private readonly service: JoinPort, name: string) {
    super(app);
    this.name = name;
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-join-modal');
  }

  onOpen(): void {
    this.setTitle(JOIN_DIALOG_TITLE);
    const { contentEl } = this;
    new Setting(contentEl)
      .setName('Join link')
      .setDesc('The join link you were sent. The same link works in a browser.')
      .addText((text) => {
        text.setPlaceholder('Paste the link here').onChange((value) => { this.link = value; });
        text.inputEl.setAttribute('aria-label', 'Join link');
        text.inputEl.addEventListener('keydown', (event) => this.submitOnEnter(event));
        this.linkInput = text.inputEl;
      });
    new Setting(contentEl)
      .setName('Your name')
      .setDesc('How the game master and the other players see you.')
      .addText((text) => {
        text.setValue(this.name).onChange((value) => { this.name = value; });
        text.inputEl.setAttribute('aria-label', 'Your name');
        text.inputEl.addEventListener('keydown', (event) => this.submitOnEnter(event));
      });
    this.statusEl = contentEl.createEl('p', { cls: 'atlas-join-modal__status', attr: { role: 'status', 'aria-live': 'polite' } });
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    this.joinButton = buttons.createEl('button', { cls: 'mod-cta', text: 'Join' });
    this.joinButton.addEventListener('click', () => this.submit());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    this.unsubscribe = joinedSessionStore.subscribe((state) => this.show(state.session));
    this.linkInput?.focus();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Closing before the GM let the player in cancels the join.
    if (this.joining && !this.admitted) this.service.leave();
    this.joining = false;
    this.contentEl.empty();
  }

  private submitOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing || this.joinButton?.disabled) return;
    event.preventDefault();
    this.submit();
  }

  private submit(): void {
    const problem = this.service.join(this.link, this.name);
    if (problem) {
      this.setStatus(JOIN_PROBLEM_TEXT[problem], true);
      return;
    }
    this.joining = true;
    this.show(joinedSessionStore.getState().session);
  }

  private show(session: PlayerSessionState | null): void {
    if (!this.joining || !session) return;
    switch (session.status) {
      case 'connecting':
        this.setStatus('Connecting…', false);
        this.setBusy(true);
        break;
      case 'waiting':
        this.setStatus('Waiting for the GM to let you in…', false);
        this.setBusy(true);
        break;
      case 'admitted':
        this.admitted = true;
        this.close();
        break;
      case 'denied':
        this.end(sessionReasonText(session.reason, 'denied'));
        break;
      case 'lost':
        this.end(sessionReasonText(session.reason, 'unreachable'));
        break;
    }
  }

  /** The join is over without admission: say why and offer Join again. */
  private end(text: string): void {
    this.joining = false;
    this.service.leave();
    this.setStatus(text, true);
    this.setBusy(false);
  }

  private setStatus(text: string, problem: boolean): void {
    this.statusEl?.setText(text);
    this.statusEl?.toggleClass('atlas-join-modal__status--problem', problem);
  }

  private setBusy(busy: boolean): void {
    if (this.joinButton) this.joinButton.disabled = busy;
  }
}

/** Opens the Join dialog with the last name used. */
export function openJoinSessionModal(app: App): void {
  const service = OnlineJoinService.forApp(app);
  if (!service) {
    new Notice('Online play is not ready yet. Try again in a moment.');
    return;
  }
  new JoinSessionModal(app, service, service.rememberedName()).open();
}
