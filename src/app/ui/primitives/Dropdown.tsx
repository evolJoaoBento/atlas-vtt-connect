import React, { useEffect, useRef } from 'react';
import { inPageSelect, type InPageOption, type InPageSelect } from './inPageSelect';

export type DropdownOption = InPageOption;

export interface DropdownProps {
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** A select drawn in the page (`inPageSelect`): its open list shows in screen recordings and remote views. */
export function Dropdown({ options, value, onChange, placeholder, className, disabled, 'aria-label': ariaLabel }: DropdownProps): React.ReactElement {
  const host = useRef<HTMLSpanElement>(null);
  const control = useRef<InPageSelect | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const spec = { options, value, ariaLabel, ...(placeholder !== undefined && { placeholder }), ...(className !== undefined && { className }), ...(disabled !== undefined && { disabled }) };

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const made = inPageSelect(el, spec, (next) => changed.current(next));
    control.current = made;
    return () => {
      made.destroy();
      control.current = null;
    };
  }, []);

  useEffect(() => {
    control.current?.update(spec);
  });

  return <span ref={host} className="atlas-connect-dropdown" />;
}
