import { conditionName } from '../src/app/online/scene/conditionNames';
import { isTokenEdit, type TokenEdit } from '../src/app/online/control/tokenEdits';
import type { PlayerToken } from '../src/app/online/scene/sceneTypes';
import type { TokenSheet } from '../src/app/online/tools/sheets';

/** Native dialog supplies focus trapping, Escape and mobile layout without another UI dependency. */
export function openTokenEditor(doc: Document, token: PlayerToken, sheet: TokenSheet | undefined, send: (edit: TokenEdit) => boolean, parent: HTMLElement = doc.body, embedded = false): () => void {
  token = structuredClone(token);
  if (sheet) sheet = structuredClone(sheet);
  const dialog = doc.createElement(embedded ? 'section' : 'dialog');
  dialog.className = 'token-editor';
  dialog.setAttribute('aria-label', 'Editar personagem');
  const form = doc.createElement('form');
  const title = doc.createElement('h2');
  title.textContent = sheet?.name ?? token.name ?? 'Personagem';
  form.append(title);
  const field = (label: string, type: string, value: string): HTMLInputElement => {
    const row = doc.createElement('label');
    row.textContent = label;
    const input = doc.createElement('input');
    input.type = type;
    input.value = value;
    input.setAttribute('aria-label', label);
    row.append(input);
    form.append(row);
    return input;
  };
  const status = field('Status', 'text', token.statusText ?? '');
  status.maxLength = 120;
  let health = sheet?.health ?? token.hp;
  const current = field('HP atual', 'number', String(health?.current ?? 1));
  const maximum = field('HP máximo', 'number', String(health?.max ?? 1));
  current.min = '0'; maximum.min = '1';
  current.max = maximum.max = '1000000';
  current.step = maximum.step = '1';
  current.required = maximum.required = true;
  const toggle = field('Mostrar barrinha de HP', 'checkbox', '');
  toggle.checked = token.showHpBar === true;
  const size = field('Tamanho do token', 'number', String(token.size));
  size.min = '0.75'; size.max = '5'; size.step = 'any'; size.required = true;
  const steps = (input: HTMLInputElement, name: string, step: number): void => {
    const row = doc.createElement('div');
    row.className = 'token-editor__steps';
    for (const [text, delta] of [['−', -step], ['+', step]] as const) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'secondary'; button.textContent = text;
      button.setAttribute('aria-label', `${delta < 0 ? 'Diminuir' : 'Aumentar'} ${name}`);
      button.addEventListener('click', () => {
        const ceiling = input === current ? Math.max(1, Number(maximum.value)) : Number(input.max);
        input.value = String(Math.min(ceiling, Math.max(Number(input.min), (Number(input.value) || 0) + delta)));
      });
      row.append(button);
    }
    input.parentElement?.append(row);
  };
  steps(current, 'HP', 1);
  steps(size, 'token', 0.25);
  const conditionInputs: [string, HTMLInputElement][] = [];
  const group = doc.createElement('fieldset');
  const legend = doc.createElement('legend'); legend.textContent = 'Condições'; group.append(legend);
  for (const condition of token.conditionChoices ?? token.conditions) {
    const label = doc.createElement('label');
    const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = token.conditions.some((active) => active.id === condition.id);
    label.append(input, conditionName(condition.name ?? condition.id)); group.append(label); conditionInputs.push([condition.id, input]);
  }
  form.append(group);
  const conditions = doc.createElement('p');
  conditions.textContent = token.conditions.length ? token.conditions.map((condition) => conditionName(condition.name ?? condition.id)).join(', ') : 'Sem condições ativas';
  form.append(conditions);
  const note = doc.createElement('p'); note.setAttribute('role', 'status'); form.append(note);
  const actions = doc.createElement('div'); actions.className = 'token-editor__steps';
  const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancelar';
  const save = doc.createElement('button'); save.type = 'submit'; save.textContent = 'Salvar';
  actions.append(cancel, save); form.append(actions); dialog.append(form); parent.append(dialog);
  const previous = doc.activeElement as HTMLElement | null;
  const close = (): void => { dialog.remove(); previous?.focus(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (!embedded && event.target === dialog) close(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const edit: TokenEdit = {};
    if (Number(current.value) !== (health?.current ?? 1) || Number(maximum.value) !== (health?.max ?? 1) || (!health && toggle.checked)) edit.hp = { current: Number(current.value), max: Number(maximum.value) };
    if (toggle.checked !== (token.showHpBar === true)) edit.showHpBar = toggle.checked;
    if (status.value.trim() !== (token.statusText ?? '')) edit.statusText = status.value.trim();
    if (Number(size.value) !== token.size) edit.size = Number(size.value);
    const chosen = conditionInputs.filter(([, input]) => input.checked).map(([id]) => id);
    if (chosen.join('|') !== token.conditions.map((condition) => condition.id).join('|')) edit.conditions = chosen;
    if (!Object.keys(edit).length) { if (!embedded) close(); return; }
    if (!isTokenEdit(edit)) { note.textContent = 'Informe valores válidos de vida e tamanho (0,75 a 5).'; return; }
    if (!send(edit)) { note.textContent = 'Não foi possível enviar. Confira sua conexão e o controle do personagem.'; return; }
    if (embedded) {
      if (edit.hp) { health = { ...edit.hp }; if (sheet?.health) Object.assign(sheet.health, edit.hp); else token.hp = { ...edit.hp }; }
      if (edit.size !== undefined) token.size = edit.size;
      if (edit.showHpBar !== undefined) token.showHpBar = edit.showHpBar;
      if (edit.statusText !== undefined) token.statusText = edit.statusText;
      if (edit.conditions) token.conditions = edit.conditions.map((id) => (token.conditionChoices ?? token.conditions).find((item) => item.id === id) ?? { id, value: null });
      conditions.textContent = token.conditions.length ? token.conditions.map((condition) => conditionName(condition.name ?? condition.id)).join(', ') : 'Sem condições ativas';
    }
    if (embedded) note.textContent = 'Alteração enviada ao mestre.'; else close();
  });
  if (embedded) {
    cancel.hidden = true; save.textContent = 'Aplicar';
    form.addEventListener('change', () => form.requestSubmit());
    for (const button of form.querySelectorAll<HTMLButtonElement>('.token-editor__steps button[type=button]')) button.addEventListener('click', () => form.requestSubmit());
  }
  if (!embedded) { (dialog as HTMLDialogElement).showModal(); current.focus(); }
  return close;
}
