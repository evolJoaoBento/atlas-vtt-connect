import React, { useId, useLayoutEffect, useRef, useState } from 'react';

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
 * anchor and kept inside the window: in the flow of a panel that scrolls it would lengthen the panel, put a scrollbar on
 * it, and move the button from under the pointer, which closes the tooltip and opens it again.
 */
export function LabelTooltip({ label, side = 'top', multiline = false, children }: LabelTooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const note = tip.current;
    const near = anchor.current;
    if (!open || !note || !near) return;
    const win = near.ownerDocument.defaultView ?? window;
    const at = near.getBoundingClientRect();
    const size = note.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(at.left + at.width / 2 - size.width / 2, win.innerWidth - size.width - EDGE));
    const top = side === 'top' ? at.top - size.height - GAP : at.bottom + GAP;
    note.setCssProps({ left: `${left}px`, top: `${Math.max(EDGE, top)}px` });
    note.classList.add('is-placed');
  }, [open, side, label]);
  return (
    <span
      ref={anchor}
      className="atlas-connect-tooltip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && <span ref={tip} id={id} role="tooltip" className={`atlas-connect-tooltip${multiline ? ' is-multiline' : ''}`}>{label}</span>}
    </span>
  );
}
