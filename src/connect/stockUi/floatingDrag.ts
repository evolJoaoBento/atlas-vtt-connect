/**
 * Makes a fixed element draggable by a handle, as the floating dice panel is: kept inside the window, below the
 * 44 px of Obsidian's title bar, with a pointer capture so a fast drag cannot lose the handle. Reports where it ended.
 * Everything it adds to the page is removed again by the returned function.
 */
import type { Disposer } from '@atlas-vtt/api-types';

/** Room kept above the element for Obsidian's title bar and ribbon. */
export const TOP_INSET = 44;

export interface Place {
  x: number;
  y: number;
}

/** `place` kept inside the window `win` for an element of `size`. */
export function clampToWindow(place: Place, size: { width: number; height: number }, win: { innerWidth: number; innerHeight: number }): Place {
  const maxX = Math.max(0, win.innerWidth - size.width);
  const maxY = Math.max(TOP_INSET, win.innerHeight - size.height);
  return { x: Math.max(0, Math.min(place.x, maxX)), y: Math.max(TOP_INSET, Math.min(place.y, maxY)) };
}

export function placeAt(element: HTMLElement, place: Place): void {
  element.setCssProps({ left: `${place.x}px`, top: `${place.y}px`, right: 'auto' });
}

export function makeDraggable(element: HTMLElement, handle: HTMLElement, onMoved: (place: Place) => void): Disposer {
  const win = element.ownerDocument.defaultView ?? window;
  let drag: { pointer: number; dx: number; dy: number } | null = null;
  const down = (event: PointerEvent): void => {
    // A button inside the handle is a button, not a grip.
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button') && event.target.closest('button') !== handle)) return;
    const rect = element.getBoundingClientRect();
    drag = { pointer: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    handle.classList.add('is-dragging');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // No capture (a synthetic event): the moves still arrive on the handle while the pointer stays over it.
    }
    event.preventDefault();
  };
  const move = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const place = clampToWindow({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, { width: element.offsetWidth, height: element.offsetHeight }, win);
    placeAt(element, place);
  };
  const end = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    handle.classList.remove('is-dragging');
    const rect = element.getBoundingClientRect();
    onMoved({ x: rect.left, y: rect.top });
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
  };
}
