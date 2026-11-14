import { isManualTurn } from '../src/app/online/control/manualTurns';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';

/** Free names and values are stored in the shared native initiative tracker. */
export class TurnOrderView {
  private scene: PlayerScene | null = null;
  private readonly choice: HTMLInputElement;
  private readonly roll: HTMLInputElement;
  private readonly list: HTMLOListElement;
  private readonly note: HTMLElement;
  constructor(private readonly panel: HTMLElement, button: HTMLButtonElement, send: (id: string, value: number) => boolean, private readonly remove?: (id: string) => boolean) {
    const doc = panel.ownerDocument;
    const title = doc.createElement('h2'); title.textContent = 'Ordem de turnos';
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = 'Fechar';
    const open = (value: boolean): void => { panel.hidden = !value; button.setAttribute('aria-expanded', String(value)); };
    button.addEventListener('click', () => open(panel.hidden)); close.addEventListener('click', () => open(false));
    doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') open(false); });
    const form = doc.createElement('form');
    this.choice = doc.createElement('input'); this.choice.type = 'text'; this.choice.maxLength = 120; this.choice.required = true; this.choice.placeholder = 'Nome'; this.choice.setAttribute('aria-label', 'Nome para iniciativa');
    this.roll = doc.createElement('input'); this.roll.type = 'number'; this.roll.min = '-1000'; this.roll.max = '1000'; this.roll.step = '1'; this.roll.required = true; this.roll.placeholder = 'Resultado da iniciativa'; this.roll.setAttribute('aria-label', 'Resultado da iniciativa');
    const submit = doc.createElement('button'); submit.textContent = 'Adicionar turno'; submit.type = 'submit';
    this.note = doc.createElement('p'); this.note.setAttribute('role', 'status');
    this.list = doc.createElement('ol');
    form.append(this.choice, this.roll, submit); panel.append(title, close, form, this.note, this.list);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const value = Number(this.roll.value);
      if (!this.roll.value || !Number.isInteger(value) || value < -1000 || value > 1000 || !this.choice.value.trim()) return;
      this.note.textContent = send(this.choice.value.trim(), value) ? 'Iniciativa enviada ao mestre.' : 'Não foi possível enviar. Confira a conexão e o controle do token.';
    });
  }
  update(scene: PlayerScene | null, _controlled: readonly string[]): void {
    this.scene = scene;
    this.list.replaceChildren();
    const initiative = this.scene?.initiative;
    for (const entry of [...(initiative?.entries ?? [])].sort((a, b) => b.initiative - a.initiative)) {
      const row = this.list.ownerDocument.createElement('li'); row.textContent = `${entry.awaiting ? '—' : entry.initiative} · ${entry.name ?? scene?.tokens[entry.tokenId]?.name ?? 'Personagem'}${entry.isActive && initiative?.active ? ' ← turno atual' : ''}`;
      if (this.remove && (isManualTurn(entry.tokenId) || _controlled.includes(entry.tokenId))) {
        const button = row.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Excluir'; button.setAttribute('aria-label', `Excluir turno de ${entry.name ?? 'Personagem'}`);
        button.addEventListener('click', () => { this.note.textContent = this.remove?.(entry.id) ? 'Exclusão enviada ao mestre.' : 'Não foi possível excluir este turno.'; });
        row.append(button);
      }
      this.list.append(row);
    }
    if (!initiative?.entries.length) { const row = this.list.ownerDocument.createElement('li'); row.textContent = 'Nenhuma iniciativa registrada.'; this.list.append(row); }
  }
}
