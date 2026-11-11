/** Chooses `label` in Connect's in-page dropdown whose button is `button`, as a user does: opens it, clicks the option. */
export function pickOption(button: HTMLElement, label: string): void {
  if (button.getAttribute('aria-expanded') !== 'true') button.click();
  const list = button.closest('.atlas-connect-select')?.querySelector('[role="listbox"]');
  const option = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((item) => item.textContent === label);
  if (!option) throw new Error(`No option "${label}" in the dropdown "${button.getAttribute('aria-label') ?? ''}".`);
  option.click();
}

/** The labels a dropdown offers, opening and closing it. */
export function optionLabels(button: HTMLElement): string[] {
  button.click();
  const list = button.closest('.atlas-connect-select')?.querySelector('[role="listbox"]');
  const labels = [...(list?.querySelectorAll('[role="option"]') ?? [])].map((item) => item.textContent ?? '');
  button.click();
  return labels;
}
