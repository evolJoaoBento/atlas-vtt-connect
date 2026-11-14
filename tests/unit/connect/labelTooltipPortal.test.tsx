import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabelTooltip } from '../../../src/app/ui/primitives/LabelTooltip';

afterEach(cleanup);
it('renders the imported upstream tooltip outside a transformed/scrolled parent and removes it on blur', () => {
  const view = render(<div style={{ transform: 'translateX(1px)', overflow: 'auto' }}><LabelTooltip label="Dica de teste"><button>Controle</button></LabelTooltip></div>);
  fireEvent.focus(screen.getByRole('button'));
  const tip = screen.getByRole('tooltip');
  expect(tip.parentElement).toBe(document.body);
  expect(view.container.contains(tip)).toBe(false);
  expect(tip.textContent).toBe('Dica de teste');
  fireEvent.blur(screen.getByRole('button')); expect(screen.queryByRole('tooltip')).toBeNull();
});
