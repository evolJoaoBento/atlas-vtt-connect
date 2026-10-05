import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { diff3 } from '../../../../src/app/online/sharing/merge/diff3';
import { MergeView } from '../../../../src/app/online/sharing/merge/ui/MergeView';
import { UpdateChoiceForm } from '../../../../src/app/online/sharing/merge/ui/UpdateChoiceForm';

describe('the update choice', () => {
  it('offers the five choices with remember and silent', () => {
    const answer = vi.fn();
    render(<UpdateChoiceForm title="Goblin cave" personName="Ana" onAnswer={answer} />);
    expect(screen.getByText('Goblin cave changed on both sides')).toBeTruthy();
    for (const label of ['Keep both', 'Keep mine', 'Take theirs', 'Resolve conflicts']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remember for this note'));
    fireEvent.click(screen.getByLabelText('Save auto merges without showing them'));
    fireEvent.click(screen.getByRole('button', { name: 'Auto merge' }));
    expect(answer).toHaveBeenCalledWith({ choice: 'auto', remember: true, silent: true });
  });
});

describe('the merge page', () => {
  it('shows each conflict side by side, builds the result from choices and saves an edited result', () => {
    const save = vi.fn();
    render(<MergeView chunks={diff3('a\nb\nc', 'a\nmine\nc', 'a\ntheirs\nc')} preview={null} conflictDefault="both" onSave={save} onCancel={() => {}} />);
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Base')).toBeTruthy();
    expect(screen.getByText('Theirs')).toBeTruthy();
    const result = screen.getByLabelText('Result') as HTMLTextAreaElement;
    expect(result.value).toBe('a\nmine\ntheirs\nc');
    fireEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
    expect(result.value).toBe('a\ntheirs\nc');
    fireEvent.change(result, { target: { value: 'a\nby hand\nc' } });
    fireEvent.change(screen.getByLabelText('For conflicts next time'), { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save merge' }));
    expect(save).toHaveBeenCalledWith({ text: 'a\nby hand\nc', conflictDefault: 'mine' });
  });

  it('keeps typed edits when a conflict button is clicked: the buttons wait until the edits are discarded (M3)', () => {
    render(<MergeView chunks={diff3('a\nb\nc', 'a\nmine\nc', 'a\ntheirs\nc')} preview={null} conflictDefault="both" onSave={() => {}} onCancel={() => {}} />);
    const result = screen.getByLabelText('Result') as HTMLTextAreaElement;
    fireEvent.change(result, { target: { value: 'typed by hand' } });
    const take = screen.getByRole('button', { name: 'Take theirs' }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.click(take);
    expect(result.value).toBe('typed by hand');
    fireEvent.click(screen.getByRole('button', { name: 'Discard my edits' }));
    expect(result.value).toBe('a\nmine\ntheirs\nc');
    expect((screen.getByRole('button', { name: 'Take theirs' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts from an auto merge preview', () => {
    render(<MergeView chunks={diff3('a', 'a', 'b')} preview="b" conflictDefault="both" onSave={() => {}} onCancel={() => {}} />);
    expect((screen.getByLabelText('Result') as HTMLTextAreaElement).value).toBe('b');
  });

  it('cancel saves nothing', () => {
    const save = vi.fn();
    const cancel = vi.fn();
    render(<MergeView chunks={diff3('a', 'a', 'b')} preview="b" conflictDefault="both" onSave={save} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
