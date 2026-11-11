// Copied from Atlas VTT src/app/ui/dialogShell.ts at c1d4d15 (AGPL-3.0-only); Connect adds one close path for every way out.
export interface DialogShell {
  /** Backdrop covering the window; removing it closes the dialog. */
  root: HTMLElement;
  dialog: HTMLElement;
  /**
   * Called once when the dialog goes by any way but its own buttons: Escape (wherever focus is), a press on the
   * backdrop (a right-click too), or Connect unloading. Set by the dialog's owner.
   */
  onDismiss: () => void;
  /** Takes the dialog down and its listeners with it; safe to call twice. */
  close(): void;
}

/** The dialogs open now, the newest last: Escape closes only the newest, unloading closes them all. */
const open: DialogShell[] = [];

/**
 * Mounts a centred, titled dialog on `document.body`. It stacks above Atlas
 * overlays such as the asset manager, which Obsidian's own modals do not.
 */
export function createDialogShell(title: string): DialogShell {
  const doc = document;
  const win = doc.defaultView ?? window;
  const root = doc.body.createDiv({ cls: 'atlas-vtt-plugin atlas-text-dialog-backdrop atlas-connect-dialog-backdrop' });
  const dialog = root.createDiv({ cls: 'atlas-text-dialog atlas-connect-dialog', attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } });
  dialog.createEl('h3', { cls: 'atlas-text-dialog__title', text: title });
  let closed = false;
  const dismiss = (): void => {
    if (closed) return;
    shell.onDismiss();
    shell.close();
  };
  // Escape closes it wherever focus went (a context menu closing hands focus back to the note behind).
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || open[open.length - 1] !== shell) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };
  // A click beside the dialog, or a right-click, closes it and is not passed on to what lies under the backdrop.
  const beside = (event: MouseEvent): void => {
    if (event.target !== root) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'mousedown') dismiss();
  };
  win.addEventListener('keydown', key, true);
  root.addEventListener('mousedown', beside);
  root.addEventListener('click', beside);
  root.addEventListener('contextmenu', beside);
  const shell: DialogShell = {
    root, dialog,
    onDismiss: () => undefined,
    close: () => {
      if (closed) return;
      closed = true;
      win.removeEventListener('keydown', key, true);
      root.remove();
      const at = open.indexOf(shell);
      if (at >= 0) open.splice(at, 1);
    },
  };
  open.push(shell);
  return shell;
}

/** Closes every open dialog as dismissed; Connect calls it when it unloads, so no backdrop outlives it. */
export function dismissOpenDialog(): void {
  for (const shell of [...open].reverse()) {
    shell.onDismiss();
    shell.close();
  }
}
