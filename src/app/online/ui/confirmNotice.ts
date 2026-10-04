import { Notice } from 'obsidian';

export interface NoticeAnswer {
  label: string;
  /** The recommended answer (`mod-cta`). */
  cta?: boolean;
  run(): void;
}

export interface ConfirmNoticeOptions {
  /** Writes the question into its line; text only, never HTML. */
  text(line: HTMLElement): void;
  /** A warning line under the question. */
  warning?: string | null;
  answers: readonly NoticeAnswer[];
}

/**
 * A notice that stays until one of its answers is clicked, or it is hidden. Obsidian hides a
 * notice on any click, so only the answers may close this one.
 */
export function showConfirmNotice(options: ConfirmNoticeOptions): { hide(): void } {
  const fragment = createFragment();
  const body = fragment.createDiv({ cls: 'atlas-connect-request' });
  options.text(body.createDiv({ cls: 'atlas-connect-request__text' }));
  if (options.warning) body.createDiv({ cls: 'atlas-connect-request__warning', text: options.warning });
  const actions = body.createDiv({ cls: 'atlas-connect-request__actions' });
  const notice = new Notice(fragment, 0);
  body.addEventListener('click', (event) => event.stopPropagation());
  for (const answer of options.answers) {
    const button = actions.createEl('button', { text: answer.label, ...(answer.cta ? { cls: 'mod-cta' } : {}) });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      answer.run();
      notice.hide();
    });
  }
  return { hide: () => notice.hide() };
}
