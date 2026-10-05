/**
 * The `atlas-share` row of Obsidian's properties panel, in the share tags' colours. Obsidian has no API for
 * property widgets, so this only adds classes to what Obsidian drew (its list pills, or its text value) and a
 * line of its own under the row: labels for entries no pill shows, the reasons an entry is not recognised,
 * and who the note reaches. Obsidian's inputs are never replaced or changed, so editing works as before.
 * A `MutationObserver` on each properties container (child and text changes only, never our own class
 * changes) puts the classes back when Obsidian redraws the row.
 */
import type { SharePropertyView, ShareEntryLabel } from './shareProperty';
import { labelClass } from './tagElements';

export const SHARE_PROPERTY_SELECTOR = '.metadata-property[data-property-key="atlas-share"]';
const PILL = 'atlas-share-pill';
const TEXT = 'atlas-share-text';
const HINT = 'atlas-share-property-hint';
const STATUS_CLASS = { ok: '', 'not-met': 'atlas-share-not-met', unrecognised: 'atlas-share-unrecognised' } as const;

const ourClasses = (el: Element, prefix: string): string[] =>
  [...el.classList].filter((name) => name === prefix || name.startsWith(`${prefix}--`) || name === STATUS_CLASS['not-met'] || name === STATUS_CLASS.unrecognised);

function setLook(el: Element, prefix: string, labels: readonly ShareEntryLabel[]): void {
  el.classList.remove(...ourClasses(el, prefix));
  const first = labels[0];
  if (!first) return;
  const worst = labels.find((label) => label.status === 'unrecognised') ?? labels.find((label) => label.status === 'not-met') ?? first;
  el.classList.add(prefix, `${prefix}--${worst.status === 'unrecognised' ? 'private' : first.tone}`, ...(STATUS_CLASS[worst.status] ? [STATUS_CLASS[worst.status]] : []));
}

function labelEl(label: ShareEntryLabel): HTMLElement {
  return createSpan({ cls: [...labelClass(label.tone).split(' '), ...(STATUS_CLASS[label.status] ? [STATUS_CLASS[label.status]] : [])], text: label.text });
}

/** Applies `view` to one `atlas-share` row. Changes the DOM only where it differs, so an observer sees no loop. */
export function decorateShareProperty(property: HTMLElement, view: SharePropertyView): void {
  const pills = [...property.querySelectorAll<HTMLElement>('.multi-select-pill')];
  const unshown = [...view.items];
  for (const pill of pills) {
    const text = (pill.querySelector('.multi-select-pill-content')?.textContent ?? pill.textContent ?? '').trim();
    const at = unshown.findIndex((item) => item.entry !== null && item.entry.trim() === text);
    const item = at >= 0 ? unshown.splice(at, 1)[0] : undefined;
    setLook(pill, PILL, item?.labels ?? []);
  }
  const value = property.querySelector('.metadata-property-value');
  // A text value (no pills) is the whole property: colour it by its labels, which then show under it.
  if (value) setLook(value, TEXT, pills.length === 0 ? view.items.flatMap((item) => item.labels) : []);
  const shownLabels = pills.length === 0 ? view.items.flatMap((item) => item.labels) : unshown.flatMap((item) => item.labels);
  const reasons = [...new Set(view.items.flatMap((item) => item.labels).flatMap((label) => (label.reason ? [label.reason] : [])))];
  const signature = JSON.stringify([shownLabels, reasons, view.summary]);
  let hint = property.querySelector<HTMLElement>(`:scope > .${HINT}`);
  if (hint?.dataset.signature === signature) return;
  hint?.remove();
  hint = createDiv({ cls: HINT });
  hint.dataset.signature = signature;
  shownLabels.forEach((label) => hint?.append(labelEl(label)));
  hint.append(createSpan({ cls: `${HINT}__summary`, text: view.summary }));
  reasons.forEach((reason) => hint?.append(createSpan({ cls: `${HINT}__reason`, text: reason })));
  property.append(hint);
}

/** Takes everything `decorateShareProperty` added off the row. */
export function clearShareProperty(property: HTMLElement): void {
  property.querySelectorAll('.multi-select-pill').forEach((pill) => pill.classList.remove(...ourClasses(pill, PILL)));
  const value = property.querySelector('.metadata-property-value');
  if (value) value.classList.remove(...ourClasses(value, TEXT));
  property.querySelector(`:scope > .${HINT}`)?.remove();
}

/**
 * Keeps the `atlas-share` rows under `root` (one note view) decorated: on `refresh()` (the note's properties
 * or the people list changed) and when Obsidian redraws a properties container.
 */
export class SharePropertyDecorator {
  private readonly observers = new Map<Element, MutationObserver>();
  private frame: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly viewOf: () => SharePropertyView | null) {}

  refresh(): void {
    for (const container of this.root.querySelectorAll('.metadata-container')) {
      if (this.observers.has(container)) continue;
      const observer = new MutationObserver(() => this.schedule());
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      this.observers.set(container, observer);
    }
    for (const [container, observer] of this.observers) {
      if (!container.isConnected) { observer.disconnect(); this.observers.delete(container); }
    }
    const properties = [...this.root.querySelectorAll<HTMLElement>(SHARE_PROPERTY_SELECTOR)];
    if (properties.length === 0) return;
    const view = this.viewOf();
    properties.forEach((property) => (view ? decorateShareProperty(property, view) : clearShareProperty(property)));
  }

  destroy(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    this.root.querySelectorAll<HTMLElement>(SHARE_PROPERTY_SELECTOR).forEach(clearShareProperty);
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.refresh();
    });
  }
}
