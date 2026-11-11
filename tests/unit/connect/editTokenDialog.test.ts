import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTokenSectionSpec } from '../../../src/app/online/gm-ui/editTokenSection';
import { awaitEditTokenDialog } from '../../../src/connect/stockUi/editTokenDialog';
import { pickOption } from '../pickOption';

/** Atlas's Edit Token dialog as `EditTokenModal` draws it: a left column, and Cancel then Save in the footer. */
function atlasDialog(): { container: HTMLElement; modal: HTMLElement; cancel: HTMLButtonElement; save: HTMLButtonElement } {
  const container = document.createElement('div');
  container.innerHTML = `<div class="atlas-modal-overlay"><div class="atlas-modal atlas-edit-token-modal">
    <div class="atlas-modal-body atlas-edit-token__body"><div class="atlas-edit-token__column"><section class="atlas-edit-token__section">Name</section></div></div>
    <div class="atlas-modal-footer"><button>Cancel</button><button>Save</button></div></div></div>`;
  document.body.appendChild(container);
  const [cancel, save] = [...container.querySelectorAll('button')];
  return { container, modal: container.querySelector<HTMLElement>('.atlas-edit-token-modal')!, cancel: cancel!, save: save! };
}

function spec(saved: Array<ReadonlyMap<string, string>>): EditTokenSectionSpec {
  const options = [{ value: '', label: 'Map default' }, { value: 'bar', label: 'Bar only' }];
  return {
    title: 'Players see', columns: ['This token'],
    rows: [{ label: 'HP', choices: [{ id: 'token:hp', label: 'HP, this token', options, value: '' }] }],
    save: (values) => saved.push(values),
  };
}

const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

describe("Connect's section in Atlas's Edit Token dialog", () => {
  beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('goes into the left column of the dialog that opens next, in Atlas\'s markup', async () => {
    awaitEditTokenDialog(document, () => [spec([])]);
    const { modal } = atlasDialog();
    await flush();
    const section = modal.querySelector('.atlas-edit-token__column > .atlas-connect-edit-section')!;
    expect(section.querySelector('.atlas-edit-token__section-label')?.textContent).toBe('Players see');
    // An in-page dropdown, not a native select: its list shows in screen recordings.
    expect(section.querySelector('select')).toBeNull();
    expect(section.querySelector('button.dropdown')?.getAttribute('aria-label')).toBe('HP, this token');
  });

  it('applies the choices when the dialog closes by Save, and not by Cancel', async () => {
    const saved: Array<ReadonlyMap<string, string>> = [];
    awaitEditTokenDialog(document, () => [spec(saved)]);
    let dialog = atlasDialog();
    await flush();
    pickOption(dialog.modal.querySelector<HTMLElement>('button.dropdown')!, 'Bar only');
    dialog.cancel.click();
    dialog.container.remove();
    await flush();
    expect(saved).toEqual([]);

    awaitEditTokenDialog(document, () => [spec(saved)]);
    dialog = atlasDialog();
    await flush();
    const again = dialog.modal.querySelector<HTMLElement>('button.dropdown')!;
    pickOption(again, 'Bar only');
    // Its list is inside the dialog, so choosing in it is no click beside the dialog.
    expect(again.textContent).toBe('Bar only');
    dialog.save.click();
    dialog.container.remove();
    await flush();
    expect(saved.map((values) => values.get('token:hp'))).toEqual(['bar']);
  });

  it('applies them on Enter, as Atlas saves on it, but not on Escape, nor on Enter in its dropdown', async () => {
    const saved: Array<ReadonlyMap<string, string>> = [];
    awaitEditTokenDialog(document, () => [spec(saved)]);
    let dialog = atlasDialog();
    await flush();
    dialog.modal.querySelector('button.dropdown')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    dialog.modal.querySelector('button.dropdown')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    dialog.modal.querySelector('.atlas-edit-token__section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    dialog.container.remove();
    await flush();
    expect(saved).toEqual([]);
    awaitEditTokenDialog(document, () => [spec(saved)]);
    dialog = atlasDialog();
    await flush();
    dialog.modal.querySelector('.atlas-edit-token__section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    dialog.container.remove();
    await flush();
    expect(saved).toHaveLength(1);
  });

  it('stops waiting after a while, and when told to', async () => {
    const stop = awaitEditTokenDialog(document, () => [spec([])]);
    stop();
    expect(atlasDialog().modal.querySelector('.atlas-connect-edit-section')).toBeNull();
    document.body.replaceChildren();
    awaitEditTokenDialog(document, () => [spec([])]);
    await vi.advanceTimersByTimeAsync(31_000);
    const { modal } = atlasDialog();
    await flush();
    expect(modal.querySelector('.atlas-connect-edit-section')).toBeNull();
  });
});
