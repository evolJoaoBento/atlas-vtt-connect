import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/app/ui/primitives/Button';
import { LabelTooltip } from '../../src/app/ui/primitives/LabelTooltip';

describe('primitives', () => {
  it('Button uses Obsidian classes and calls onClick', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Button variant="cta" onClick={onClick}>Allow</Button>);
    const button = getByRole('button', { name: 'Allow' });
    expect(button.className).toContain('mod-cta');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('LabelTooltip never sets a title attribute', () => {
    const { container, getByText } = render(<LabelTooltip label="Kick"><span>x</span></LabelTooltip>);
    expect(container.querySelector('[title]')).toBeNull();
    fireEvent.mouseEnter(getByText('x'));
    expect(getByText('Kick')).toBeTruthy();
  });
});
