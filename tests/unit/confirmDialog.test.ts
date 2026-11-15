import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseAction } from '../../src/app/ui/confirmDialog';
import { dismissOpenDialog } from '../../src/app/ui/dialogShell';

const ask = (title = 'Send to…'): Promise<string | null> => chooseAction({ title, message: ['Pick someone.'], choices: [{ label: 'Ana', value: 'ana' }, { label: 'Ben', value: 'ben', style: 'cta' }] });
const backdrops = (): number => document.querySelectorAll('.atlas-text-dialog-backdrop').length;
const backdrop = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-text-dialog-backdrop')!;

describe("Connect's dialog (Send to…, Ask to pull…)", () => {
  afterEach(() => { dismissOpenDialog(); document.body.replaceChildren(); vi.useRealTimers(); });

  it('resolves the choice clicked and goes', async () => {
    const answer = ask();
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'Ana')!.click();
    await expect(answer).resolves.toBe('ana');
    expect(backdrops()).toBe(0);
  });

  it('closes on Escape wherever focus is, without passing it on', async () => {
    const answer = ask();
    const outside = document.body.createEl('input');
    outside.focus();
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    outside.dispatchEvent(event);
    await expect(answer).resolves.toBeNull();
    expect(backdrops()).toBe(0);
    expect(heard).not.toHaveBeenCalled();
    // Gone, Escape is no longer taken.
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', heard);
  });

  it('closes on a click or a right-click beside it, never on one inside it', async () => {
    const first = ask();
    document.querySelector<HTMLElement>('.atlas-text-dialog')!.click();
    expect(backdrops()).toBe(1);
    backdrop().click();
    await expect(first).resolves.toBeNull();
    const second = ask();
    const right = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    backdrop().dispatchEvent(right);
    await expect(second).resolves.toBeNull();
    expect(right.defaultPrevented).toBe(true);
    expect(backdrops()).toBe(0);
  });

  it('is never left behind: Escape closes the newest of two, the other stays, and unloading closes them all', async () => {
    const first = ask('First');
    const second = ask('Second');
    let firstDone = false;
    void first.then(() => { firstDone = true; });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(second).resolves.toBeNull();
    await Promise.resolve();
    expect(firstDone).toBe(false);
    expect(backdrops()).toBe(1);
    ask('Third');
    dismissOpenDialog();
    await expect(first).resolves.toBeNull();
    expect(backdrops()).toBe(0);
  });

  it('takes focus back after a menu that opened it hands focus elsewhere', async () => {
    vi.useFakeTimers();
    const answer = ask();
    const note = document.body.createEl('textarea');
    note.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement?.textContent).toBe('Ben');
    dismissOpenDialog();
    await expect(answer).resolves.toBeNull();
  });
});
