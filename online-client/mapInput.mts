// online-client/mapInput.mts
/**
 * Binds the canvas's pointer, wheel and double-click events and the page's Escape and waypoint
 * keys to the map's input and tools. Only the canvas takes map input, so a gesture that starts on
 * the top bar, the menu, the toolbar or a button never moves the map. The decisions live in
 * `ViewInput` and `PlayerTools`.
 */
import type { ScreenPoint } from '../src/app/online/view/camera';
import type { PlayerTools } from '../src/app/online/view/tools/PlayerTools';
import type { PointerInput, PointerKind, ViewInput } from '../src/app/online/view/ViewInput';
import { WAYPOINT_KEY } from '@atlas-vtt/shared/draw';

export interface MapInputOptions {
  canvas: HTMLCanvasElement;
  input: ViewInput;
  tools: PlayerTools;
  signal: AbortSignal;
  /** The mouse moved over the canvas (a point), or left it (null): the grab cursor follows. */
  onHover(point: ScreenPoint | null): void;
  /** Whether this map's surface has the keyboard (Escape, the waypoint key). The page always does. */
  active?: () => boolean;
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export function bindMapInput({ canvas, input, tools, signal, onHover, active }: MapInputOptions): void {
  const point = (event: MouseEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointer = (event: PointerEvent): PointerInput => ({
    id: event.pointerId, ...point(event), kind: pointerKind(event.pointerType), button: event.button, time: event.timeStamp,
  });
  canvas.addEventListener('pointerdown', (event) => {
    // The map takes the keyboard from a toolbar button, so Space mid-drag cannot press it.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    try {
      // Moves keep coming to the canvas when the finger leaves it.
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone, or the environment has no pointer capture.
    }
    input.down(pointer(event));
  }, { signal });
  canvas.addEventListener('pointermove', (event) => {
    const moved = pointer(event);
    // The browser merges the moves of a frame: a laser takes each of them, so its line follows the hand's path.
    const merged = tools.tool === 'laser' && moved.kind !== 'touch' ? event.getCoalescedEvents?.() ?? [] : [];
    for (const earlier of merged) if (earlier.timeStamp < event.timeStamp) input.move(pointer(earlier));
    input.move(moved);
    if (moved.kind === 'mouse') onHover({ x: moved.x, y: moved.y });
  }, { signal });
  canvas.addEventListener('pointerleave', () => onHover(null), { signal });
  canvas.addEventListener('pointerup', (event) => input.up(pointer(event)), { signal });
  canvas.addEventListener('pointercancel', (event) => input.cancel(event.pointerId), { signal });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    input.wheel(point(event), event.deltaY, event.deltaMode);
  }, { passive: false, signal });
  canvas.addEventListener('dblclick', (event) => {
    event.preventDefault();
    input.doubleClick(point(event));
  }, { signal });
  // Escape ends a drag or a measurement and returns to Move; menus, the tray and panels take it first.
  document.addEventListener('keydown', (event) => {
    if (active?.() === false) return;
    if (event.key === 'Escape') tools.escape();
    // Atlas's waypoint key: it must not also scroll the page or press a focused button.
    if (event.key === WAYPOINT_KEY && tools.isDragging()) {
      event.preventDefault();
      if (!event.repeat) tools.addWaypoint();
    }
  }, { signal });
}
