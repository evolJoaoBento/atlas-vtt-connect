import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PresentToMenu } from './presentToRows';
import { PresentToPopover } from './PresentToPopover';

/** How long the pointer rests on the button before the popover opens, and is away before it closes (spec 3.2). */
export const HOVER_DELAY_MS = 300;

/** Closed; opened by the pointer resting on it (closes when it leaves); or opened by a click or a key (stays open). */
type Opened = 'closed' | 'hover' | 'pinned';

interface PresentToButtonProps {
  label: string;
  disabled: boolean;
  /** The rows, built on every render so they follow the store; null when there is no tab to present. */
  menu: PresentToMenu | null;
}

/**
 * The "Present to:" button and its popover. Click, Enter or Space toggles it; a click on a popover the pointer opened
 * keeps it open (Review Focus B11). Hovering opens it after 300 ms and closes it 300 ms after the pointer left both
 * the button and the popover, unless it was opened by a click or a key, which close it with Escape, a click outside,
 * or the button again.
 */
export function PresentToButton({ label, disabled, menu }: PresentToButtonProps): React.ReactElement {
  const [opened, setOpened] = useState<Opened>('closed');
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    if (!shown) return undefined;
    const doc = wrapper.current?.ownerDocument;
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !wrapper.current?.contains(event.target)) setOpened('closed');
    };
    doc?.addEventListener('pointerdown', outside);
    return () => doc?.removeEventListener('pointerdown', outside);
  }, [shown]);

  return (
    <div
      ref={wrapper}
      className="atlas-connect-present-to"
      onMouseEnter={() => { if (opened === 'closed' && !disabled) later('hover'); else if (opened === 'hover') cancel(); }}
      onMouseLeave={() => { if (opened === 'hover') later('closed'); else cancel(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !shown) return;
        event.stopPropagation();
        cancel();
        setOpened('closed');
        button.current?.focus();
      }}
    >
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
      {shown && <PresentToPopover id={popoverId} menu={menu} />}
    </div>
  );
}
