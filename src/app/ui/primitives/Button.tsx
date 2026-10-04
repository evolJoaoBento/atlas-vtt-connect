import React from 'react';

export interface ButtonProps {
  variant?: 'default' | 'cta' | 'warning' | 'ghost';
  size?: 'sm' | 'md';
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}

/** A button in Obsidian's own style (`mod-cta`, `mod-warning`), sized for Connect's panels. */
export function Button({ variant = 'default', size = 'md', className, children, ...rest }: ButtonProps): React.ReactElement {
  const classes = ['atlas-connect-button', `is-${size}`, variant === 'default' ? '' : `mod-${variant}`, className ?? ''].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest}>{children}</button>;
}
