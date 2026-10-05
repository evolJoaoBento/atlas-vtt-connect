import React from 'react';

interface LabelledCheckProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** A radio button of the group `name`; a checkbox otherwise. */
  radio?: string;
}

/** A checkbox (or radio button) with its label, named for screen readers. Shared by the sharing dialogs. */
export function LabelledCheck({ label, checked, onChange, disabled, radio }: LabelledCheckProps): React.ReactElement {
  return (
    <label className="atlas-share__check">
      <input type={radio ? 'radio' : 'checkbox'} name={radio} checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}
