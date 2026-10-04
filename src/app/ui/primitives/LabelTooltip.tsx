import React, { useId, useState } from 'react';

export interface LabelTooltipProps { label: string; side?: 'top' | 'bottom'; children: React.ReactElement }

/** A small tooltip on hover and focus, never the browser's (no `title`). */
export function LabelTooltip({ label, side = 'top', children }: LabelTooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="atlas-connect-tooltip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && <span id={id} role="tooltip" className={`atlas-connect-tooltip is-${side}`}>{label}</span>}
    </span>
  );
}
