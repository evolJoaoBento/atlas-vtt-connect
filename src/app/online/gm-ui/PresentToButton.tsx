import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PresentToMenu } from './presentToRows';
import { PresentToPopover, type PopoverPlace } from './PresentToPopover';

/** How long the pointer rests on the button before the popover opens, and is away before it closes (spec 3.2). */
export const HOVER_DELAY_MS = 300;
/** The gap between the button and the popover, and the popover's least distance from the view's edges. */
const GAP_PX = 4;

/** Closed; opened by the pointer resting on it (closes when it leaves); or opened by a click or a key (stays open). */
type Opened = 'closed' | 'hover' | 'pinned';

interface PresentToButtonProps {
  label: string;
  disabled: boolean;
  /** The rows, built on every render so they follow the store; null when there is no tab to present. */
  menu: PresentToMenu | null;
}

/**
 * Where the popover goes: under the button (over it when there is no room below), kept inside the Obsidian pane the
 * panel is in, else the window. Fixed coordinates, so the panel's scrolling body never clips it (review I2).
 */
function placeFor(button: HTMLElement, popover: HTMLElement | null): PopoverPlace {
  const anchor = button.getBoundingClientRect();
  const win = button.ownerDocument.defaultView;
  const pane = button.closest('.workspace-leaf')?.getBoundingClientRect();
  const bounds = pane ?? { left: 0, top: 0, right: win?.innerWidth ?? 0, bottom: win?.innerHeight ?? 0 };
  const width = popover?.offsetWidth ?? 0;
  const height = popover?.offsetHeight ?? 0;
  const below = anchor.bottom + GAP_PX;
  const top = below + height > bounds.bottom - GAP_PX && anchor.top - GAP_PX - height >= bounds.top + GAP_PX ? anchor.top - GAP_PX - height : below;
  const left = Math.max(bounds.left + GAP_PX, Math.min(anchor.left, bounds.right - GAP_PX - width));
  return { top, left, maxHeight: Math.max(0, bounds.bottom - GAP_PX - top) };
}

/**
 * The "Present to:" button and its popover. Click, Enter or Space toggles it; a click on a popover the pointer opened
 * keeps it open (Review Focus B11). Hovering opens it after 300 ms and closes it 300 ms after the pointer left both
 * the button and the popover, unless it was opened by a click or a key, which close it with Escape, a click outside,
 * or the button again. The popover is rendered into the panel's document body (a portal), as Atlas's own popovers are.
 */
export function PresentToButton({ label, disabled, menu }: PresentToButtonProps): React.ReactElement {
  const [opened, setOpened] = useState<Opened>('closed');
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const popoverId = useId();

  const cancel = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const later = (next: Opened): void => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpened((now) => (now === 'pinned' ? now : next));
    }, HOVER_DELAY_MS);
  };
  useEffect(() => cancel, [cancel]);

  const shown = opened !== 'closed' && !disabled && menu !== null;
  const inside = (target: EventTarget | null): boolean => target instanceof Node
    && (wrapper.current?.contains(target) === true || popover.current?.contains(target) === true);

  // Placed after every render while shown (the rows change its height), and again when anything scrolls or resizes.
  useLayoutEffect(() => {
    if (!shown || !button.current) return;
    const next = placeFor(button.current, popover.current);
    setPlace((now) => (now && now.top === next.top && now.left === next.left && now.maxHeight === next.maxHeight ? now : next));
  });
  useEffect(() => {
    if (!shown) {
      setPlace(null);
      return undefined;
    }
    const doc = wrapper.current?.ownerDocument;
    const win = doc?.defaultView;
    const outside = (event: PointerEvent): void => { if (!inside(event.target)) setOpened('closed'); };
    const replace = (): void => { if (button.current) setPlace(placeFor(button.current, popover.current)); };
    doc?.addEventListener('pointerdown', outside);
    win?.addEventListener('scroll', replace, true);
    win?.addEventListener('resize', replace);
    return () => {
      doc?.removeEventListener('pointerdown', outside);
      win?.removeEventListener('scroll', replace, true);
      win?.removeEventListener('resize', replace);
    };
  }, [shown]);

  const enter = (): void => {
    if (opened === 'closed' && !disabled) later('hover');
    else if (opened === 'hover') cancel();
  };
  const leave = (event: React.MouseEvent): void => {
    // Between the button and the popover the pointer leaves one for the other: that is not leaving.
    if (inside(event.relatedTarget)) return;
    if (opened === 'hover') later('closed');
    else cancel();
  };
  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || !shown) return;
    event.stopPropagation();
    cancel();
    setOpened('closed');
    button.current?.focus();
  };
  const body = wrapper.current?.ownerDocument.body ?? null;

  return (
    <div ref={wrapper} className="atlas-connect-present-to" onMouseEnter={enter} onMouseLeave={leave} onKeyDown={keyDown}>
      <button
        ref={button}
        type="button"
        className="atlas-connect-button is-sm"
        disabled={disabled}
        aria-expanded={shown}
        aria-controls={shown ? popoverId : undefined}
        onClick={() => {
          cancel();
          setOpened((now) => (now === 'pinned' ? 'closed' : 'pinned'));
        }}
      >
        {label}
      </button>
      {shown && body && createPortal(
        <PresentToPopover ref={popover} id={popoverId} menu={menu} place={place} onMouseEnter={enter} onMouseLeave={leave} />,
        body,
      )}
    </div>
  );
}
