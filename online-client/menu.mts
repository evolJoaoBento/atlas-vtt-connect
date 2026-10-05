// online-client/menu.mts
/**
 * The menu: a side panel, or a bottom sheet on narrow screens (`style.css`), opened by
 * the menu button and closed by its close button or Escape, from anywhere while it is open.
 * Opening moves focus into the panel; closing returns it to the menu button.
 */
export class Menu {
  constructor(
    private readonly button: HTMLButtonElement,
    private readonly panel: HTMLElement,
    private readonly closeButton: HTMLButtonElement,
  ) {
    button.addEventListener('click', () => this.setOpen(panel.hidden));
    closeButton.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) this.close();
    });
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.closeButton.focus();
  }

  private close(): void {
    this.setOpen(false);
    this.button.focus();
  }
}
