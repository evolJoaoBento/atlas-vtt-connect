import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTokenEditor } from '../../../online-client/tokenEditor.mts';
import type { PlayerToken } from '../../../src/app/online/scene/sceneTypes';
import { ViewInput } from '../../../src/app/online/view/ViewInput';

beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });
afterEach(() => document.body.replaceChildren());
const token = { x: 0, y: 0, size: 1, name: 'Hero', statusText: '', showHpBar: false, hp: null, conditions: [] } as unknown as PlayerToken;
const field = (label: string): HTMLInputElement => document.querySelector(`input[aria-label="${label}"]`)!;
const click = (label: string): void => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
const save = (): void => { document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); };

describe('token editor', () => {
  it('reads private owner HP, changes HP, size and status, and sends only edited attributes', () => {
    const send = vi.fn(() => true);
    openTokenEditor(document, token, { tokenId: 'hero', name: 'Hero', resources: [], sheet: null, health: { current: 5, max: 10 } }, send);
    expect(field('HP atual').value).toBe('5');
    click('Diminuir HP'); click('Aumentar token'); field('Status').value = 'Ferido'; field('Mostrar barrinha de HP').checked = true;
    save();
    expect(send).toHaveBeenCalledWith({ hp: { current: 4, max: 10 }, size: 1.25, statusText: 'Ferido', showHpBar: true });
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('cancel discards edits; a refused send keeps the form and an invalid HP never goes out', () => {
    const send = vi.fn(() => false);
    const close = openTokenEditor(document, token, undefined, send);
    field('HP atual').value = '12'; save(); expect(send).not.toHaveBeenCalled();
    field('HP atual').value = '0'; save(); expect(send).toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Não foi possível');
    expect(document.querySelector('dialog')).not.toBeNull(); close();
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('uses double click and double tap for editing before map zoom, while empty map still zooms', () => {
    const camera = { pan: vi.fn(), zoomAt: vi.fn() }; const edit = vi.fn(() => true);
    const input = new ViewInput(camera, null, edit);
    input.doubleClick({ x: 10, y: 10 }); expect(edit).toHaveBeenCalled(); expect(camera.zoomAt).not.toHaveBeenCalled();
    for (const time of [100, 200]) {
      input.down({ id: 1, x: 10, y: 10, kind: 'touch', button: 0, time });
      input.up({ id: 1, x: 10, y: 10, kind: 'touch', button: 0, time: time + 10 });
    }
    expect(edit).toHaveBeenCalledTimes(2); expect(camera.zoomAt).not.toHaveBeenCalled();
    edit.mockReturnValue(false); const mouse = new ViewInput(camera, null, edit); mouse.doubleClick({ x: 50, y: 50 });
    expect(camera.zoomAt).toHaveBeenCalledWith({ x: 50, y: 50 }, 2);
  });
});


it('accepts an existing size adjusted by dragging, between the button increments', () => {
  const close = openTokenEditor(document, { ...token, size: 1.2 }, undefined, () => true);
  expect(field('Tamanho do token').validity.stepMismatch).toBe(false);
  close();
});

it('keeps sidebar open and sends HP, size and condition changes including undoing a toggle', () => {
  const send = vi.fn(() => true);
  const panel = document.createElement('section'); document.body.append(panel);
  openTokenEditor(document, { ...token, conditionChoices: [{ id: 'prone', name: 'Caído', value: null }] }, undefined, send, panel, true);
  expect(document.querySelector('dialog')).toBeNull();
  click('Aumentar token');
  expect(send).toHaveBeenLastCalledWith({ size: 1.25 });
  const condition = panel.querySelector<HTMLInputElement>('fieldset input')!;
  condition.checked = true; condition.dispatchEvent(new Event('change', { bubbles: true }));
  expect(send).toHaveBeenLastCalledWith({ conditions: ['prone'] });
  condition.checked = false; condition.dispatchEvent(new Event('change', { bubbles: true }));
  expect(send).toHaveBeenLastCalledWith({ conditions: [] });
  expect(panel.querySelector('form')).not.toBeNull();
});
