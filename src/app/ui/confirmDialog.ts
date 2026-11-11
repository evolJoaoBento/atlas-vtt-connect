// Copied from Atlas VTT src/app/ui/confirmDialog.ts at c1d4d15 (AGPL-3.0-only); its ways out are the shell's (`dialogShell.ts`).
import { createDialogShell } from './dialogShell';

export interface ConfirmDialogOptions {
  title: string;
  /** One paragraph per entry. */
  message: string[];
  confirmLabel: string;
  /** Styles the confirm button as a warning, for deletions and overwrites. */
  destructive?: boolean;
}

export interface DialogChoice<T> {
  label: string;
  value: T;
  /** `cta` marks the recommended choice, `warning` one that deletes or overwrites. */
  style?: 'cta' | 'warning';
}

export interface ChoiceDialogOptions<T> {
  title: string;
  /** One paragraph per entry. */
  message: string[];
  /** The buttons after Cancel, in order; the last one has focus. */
  choices: DialogChoice<T>[];
}

/**
 * Small centred dialog offering `choices` and Cancel. Resolves the chosen
 * value, or null when cancelled, dismissed via the backdrop or closed with Escape.
 */
export function chooseAction<T>(options: ChoiceDialogOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const shell = createDialogShell(options.title);
    const { dialog } = shell;
    dialog.addClass('atlas-text-dialog--confirm');
    for (const paragraph of options.message) {
      dialog.createEl('p', { cls: 'atlas-text-dialog__message', text: paragraph });
    }

    const close = (value: T | null): void => {
      shell.close();
      resolve(value);
    };
    // Escape, a press beside it, or Connect unloading: cancelled.
    shell.onDismiss = () => resolve(null);

    const actions = dialog.createDiv({ cls: 'atlas-text-dialog__actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => close(null));
    const buttons = options.choices.map((choice) => {
      const button = actions.createEl('button', { text: choice.label });
      if (choice.style) button.addClass(`mod-${choice.style}`);
      button.addEventListener('click', () => close(choice.value));
      return button;
    });

    const last = buttons[buttons.length - 1];
    last?.focus();
    // A menu that opened this hands focus back as it closes, after this: focus the choice again once it has.
    window.setTimeout(() => { if (last?.isConnected && !dialog.contains(document.activeElement)) last.focus(); }, 0);
  });
}

/**
 * Small centred yes/no dialog. Resolves `true` when confirmed and `false` when
 * cancelled, dismissed via the backdrop or closed with Escape.
 */
export async function confirmAction(options: ConfirmDialogOptions): Promise<boolean> {
  const confirmed = await chooseAction({
    title: options.title,
    message: options.message,
    choices: [{ label: options.confirmLabel, value: true, style: options.destructive ? 'warning' : 'cta' }],
  });
  return confirmed === true;
}
