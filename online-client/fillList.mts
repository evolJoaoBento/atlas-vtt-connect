/**
 * The join page's lists (players, widgets, initiative): a row is a line of text, and the initiative's
 * rows also carry a bar, drawn like the player window's initiative list draws it: no number, and
 * under a side's name where the window lists by sides.
 */
import type { ListRow } from '../src/app/online/preview/sceneSummary';

const listContent = new WeakMap<HTMLElement, string>();

/** Rebuilds a list only when its rows changed; scene patches arrive many times a second. */
export function fillList(list: HTMLElement, rows: ReadonlyArray<string | ListRow>): void {
  list.hidden = rows.length === 0;
  const joined = JSON.stringify(rows);
  if (listContent.get(list) === joined) return;
  listContent.set(list, joined);
  list.replaceChildren(...rows.map((entry) => {
    const row = typeof entry === 'string' ? { text: entry } : entry;
    const item = document.createElement('li');
    item.textContent = row.text;
    // The list by sides: a side's name heads its combatants, the side to act is marked, and one that sits out fades
    if (row.heading) item.className = 'side';
    if (row.current) item.setAttribute('aria-current', 'true');
    if (row.sittingOut) item.classList.add('sitting-out');
    if (row.share !== undefined) {
      const bar = document.createElement('progress');
      bar.max = 1;
      bar.value = row.share;
      bar.className = 'health';
      bar.setAttribute('aria-label', 'HP');
      item.append(' ', bar);
    }
    return item;
  }));
}
