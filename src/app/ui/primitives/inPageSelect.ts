/**
 * A dropdown drawn in the page, in place of a native `<select>`: the operating system draws a select's open list
 * outside the page, so screen recordings and remote views never show it. A button in Obsidian's `dropdown` look opens a
 * list in Obsidian's `menu` look, kept in the button's own wrapper (a click on it is a click inside whatever dialog holds
 * it) and fixed to the window beside the button, so no scrolling panel clips it.
 *
 * Keyboard as a select: Enter, Space, Alt+Down or the arrows open it; the arrows, Home and End move; Enter or Space
 * chooses; Escape or Tab closes, Escape without closing the dialog around it. Focus stays on the button, which names the
 * option in view (`aria-activedescendant`).
 */

export interface InPageOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** A heading the option sits under (an `optgroup`); options of one group come together. */
  group?: string;
}

export interface InPageSelectSpec {
  options: readonly InPageOption[];
  /** The chosen value; one no option has shows the placeholder. */
  value: string;
  /** What the button says while no option is chosen. */
  placeholder?: string;
  ariaLabel: string;
  /** Extra classes for the button. */
  className?: string;
  disabled?: boolean;
}

export interface InPageSelect {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly value: string;
  readonly isOpen: boolean;
  /** New options, value or label; an open list is drawn again. */
  update(spec: InPageSelectSpec): void;
  open(): void;
  close(): void;
  destroy(): void;
}

let counter = 0;

/** Makes the dropdown at the end of `parent`; `onChange` hears a value the user chose (never one given by `update`). */
export function inPageSelect(parent: HTMLElement, initial: InPageSelectSpec, onChange: (value: string) => void): InPageSelect {
  const doc = parent.ownerDocument;
  const id = `atlas-connect-select-${++counter}`;
  let spec = initial;
  let active = -1;
  let list: HTMLElement | null = null;
  const win = doc.defaultView;

  const el = parent.createSpan({ cls: 'atlas-connect-select' });
  const button = el.createEl('button', { type: 'button' });
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const label = button.createSpan({ cls: 'atlas-connect-select__label' });

  const enabled = (): number[] => spec.options.flatMap((option, index) => (option.disabled ? [] : [index]));
  const chosen = (): number => spec.options.findIndex((option) => option.value === spec.value);

  const paint = (): void => {
    button.className = ['dropdown', 'atlas-connect-select__button', spec.className ?? ''].filter(Boolean).join(' ');
    button.setAttribute('aria-label', spec.ariaLabel);
    button.disabled = spec.disabled === true;
    const option = spec.options[chosen()];
    label.textContent = option?.label ?? spec.placeholder ?? '';
    button.classList.toggle('is-placeholder', option === undefined);
  };

  const place = (): void => {
    if (!list || !win) return;
    const rect = button.getBoundingClientRect();
    list.style.minWidth = `${Math.max(rect.width, 0)}px`;
    list.style.left = `${rect.left}px`;
    const height = list.offsetHeight;
    const below = win.innerHeight - rect.bottom;
    // Above the button when it does not fit below and fits better above.
    const up = height > below && rect.top > below;
    list.style.top = `${up ? Math.max(rect.top - height - 4, 4) : rect.bottom + 4}px`;
  };

  const showActive = (): void => {
    if (!list) return;
    list.querySelectorAll('[role="option"]').forEach((item) => {
      const index = Number((item as HTMLElement).dataset.index);
      item.classList.toggle('selected', index === active);
      if (index === active) (item as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    });
    if (active >= 0) button.setAttribute('aria-activedescendant', `${id}-${active}`);
    else button.removeAttribute('aria-activedescendant');
  };

  const draw = (): void => {
    if (!list) return;
    list.replaceChildren();
    let group: string | undefined;
    spec.options.forEach((option, index) => {
      if (option.group !== group) {
        group = option.group;
        if (group !== undefined) {
          list!.createDiv({ cls: 'atlas-connect-select__group', text: group, attr: { role: 'presentation' } });
        }
      }
      const item = list!.createDiv({ cls: 'menu-item atlas-connect-select__option' });
      item.id = `${id}-${index}`;
      item.dataset.index = String(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === spec.value));
      if (option.disabled) {
        item.setAttribute('aria-disabled', 'true');
        item.classList.add('is-disabled');
      }
      if (option.value === spec.value) item.classList.add('is-chosen');
      item.createDiv({ cls: 'menu-item-title', text: option.label });
    });
    showActive();
  };

  const choose = (index: number): void => {
    const option = spec.options[index];
    if (!option || option.disabled) return;
    close();
    button.focus();
    if (option.value === spec.value) return;
    spec = { ...spec, value: option.value };
    paint();
    onChange(option.value);
  };

  const outside = (event: Event): void => {
    if (!el.contains(event.target as Node | null)) close();
  };
  const moved = (event: Event): void => {
    // A scroll of the list itself keeps it; any other moves the button, so the list follows.
    if (list && event.target instanceof Node && list.contains(event.target)) return;
    place();
  };

  function open(): void {
    if (list || button.disabled) return;
    list = el.createDiv({ cls: 'menu atlas-connect-select__list' });
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', spec.ariaLabel);
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const item = (event.target as Element | null)?.closest?.<HTMLElement>('[role="option"]');
      if (item) choose(Number(item.dataset.index));
    });
    list.addEventListener('mousemove', (event) => {
      const item = (event.target as Element | null)?.closest?.<HTMLElement>('[role="option"]');
      const index = item ? Number(item.dataset.index) : -1;
      if (index >= 0 && index !== active && !spec.options[index]?.disabled) {
        active = index;
        showActive();
      }
    });
    const at = chosen();
    active = at >= 0 && !spec.options[at]?.disabled ? at : (enabled()[0] ?? -1);
    draw();
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', list.id);
    el.classList.add('is-open');
    place();
    doc.addEventListener('mousedown', outside, true);
    doc.addEventListener('focusin', outside, true);
    win?.addEventListener('resize', place);
    doc.addEventListener('scroll', moved, true);
  }

  function close(): void {
    if (!list) return;
    list.remove();
    list = null;
    active = -1;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
    button.removeAttribute('aria-activedescendant');
    el.classList.remove('is-open');
    doc.removeEventListener('mousedown', outside, true);
    doc.removeEventListener('focusin', outside, true);
    win?.removeEventListener('resize', place);
    doc.removeEventListener('scroll', moved, true);
  }

  const step = (by: number): void => {
    const indexes = enabled();
    if (indexes.length === 0) return;
    const at = indexes.indexOf(active);
    active = at < 0 ? indexes[by > 0 ? 0 : indexes.length - 1]! : indexes[Math.min(Math.max(at + by, 0), indexes.length - 1)]!;
    showActive();
  };

  button.addEventListener('click', () => (list ? close() : open()));
  button.addEventListener('keydown', (event) => {
    const { key } = event;
    if (!list) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        open();
      }
      return;
    }
    const handled = (): void => { event.preventDefault(); event.stopPropagation(); };
    switch (key) {
      case 'Escape': handled(); close(); break;
      case 'Tab': close(); break;
      case 'ArrowDown': handled(); step(1); break;
      case 'ArrowUp': handled(); step(-1); break;
      case 'Home': handled(); active = -1; step(1); break;
      case 'End': handled(); active = -1; step(-1); break;
      case 'Enter':
      case ' ': handled(); choose(active); break;
      default: break;
    }
  });

  paint();
  return {
    el, button,
    get value() { return spec.value; },
    get isOpen() { return list !== null; },
    update: (next) => {
      spec = next;
      paint();
      if (list) {
        if (active >= spec.options.length || spec.options[active]?.disabled) active = enabled()[0] ?? -1;
        draw();
        place();
      }
    },
    open,
    close,
    destroy: () => {
      close();
      el.remove();
    },
  };
}
