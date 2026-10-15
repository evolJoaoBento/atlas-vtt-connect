import { fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
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

  it('LabelTooltip is fixed to the window and placed over its anchor, never in the flow of a scrolling panel', () => {
    const rects = new Map<string, DOMRect>();
    const box = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    rects.set('anchor', box(980, 400, 40, 30));
    rects.set('tip', box(0, 0, 160, 24));
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tooltip' ? rects.get('tip')! : this.className === 'atlas-connect-tooltip-anchor' ? rects.get('anchor')! : box(0, 0, 0, 0);
    });
    const { getByText } = render(<LabelTooltip label="Stop online session"><span>x</span></LabelTooltip>);
    fireEvent.mouseEnter(getByText('x'));
    const tip = getByText('Stop online session');
    // Over the anchor, and pulled in from the window's right edge (1024 wide): 1024 - 160 - 8.
    expect(tip.style.left).toBe('856px');
    expect(tip.style.top).toBe('372px');
    expect(tip.classList.contains('is-placed')).toBe(true);
    const css = readFileSync('styles/primitives.scss', 'utf8');
    expect(css).toMatch(/\.atlas-connect-tooltip \{[^}]*position: fixed;[^}]*visibility: hidden;/s);
    spy.mockRestore();
  });
});
