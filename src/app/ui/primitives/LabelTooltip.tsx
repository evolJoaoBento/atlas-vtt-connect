import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface LabelTooltipProps {
  label: string;
  side?: 'top' | 'bottom';
  /** A longer label that wraps instead of staying on one line. */
  multiline?: boolean;
  children: React.ReactElement;
}

const EDGE = 8;
const GAP = 4;

/**
 * A small tooltip on hover and focus, never the browser's (no `title`). It is fixed to the window, placed over its
 * anchor and kept inside the window. It is rendered into the anchor's document body, not beside the anchor: a fixed
 * element inside a transformed or blurred surface (a toolbar dropdown, a panel that slides in) is placed against that
 * surface and counts in its length, so it put a scrollbar on the panel and moved the button from under the pointer,
 * which closed the tooltip and opened it again.
 */
export function LabelTooltip({ label, side = 'top', multiline = false, children }: LabelTooltipProps): React.ReactElement {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const note = tip.current;
    const near = anchor.current;
    if (!host || !note || !near) return;
    const win = near.ownerDocument.defaultView ?? window;
    const at = near.getBoundingClientRect();
    const size = note.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(at.left + at.width / 2 - size.width / 2, win.innerWidth - size.width - EDGE));
    const top = side === 'top' ? at.top - size.height - GAP : at.bottom + GAP;
    note.setCssProps({ left: `${left}px`, top: `${Math.max(EDGE, top)}px` });
    note.classList.add('is-placed');
  }, [host, side, label]);
  // The anchor's own document: a popout window has its own body.
  const show = (event: React.SyntheticEvent<HTMLElement>): void => setHost(event.currentTarget.ownerDocument.body);
  const hide = (): void => setHost(null);
  return (
    <span
      ref={anchor}
      className="atlas-connect-tooltip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={host ? id : undefined}
    >
      {children}
      {host && createPortal(<span ref={tip} id={id} role="tooltip" className={`atlas-connect-tooltip${multiline ? ' is-multiline' : ''}`}>{label}</span>, host)}
    </span>
  );
}
