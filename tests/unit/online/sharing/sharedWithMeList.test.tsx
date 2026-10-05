import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedWithMeList } from '../../../../src/app/online/sharing/receive/ui/SharedWithMeList';
import { ShareError } from '../../../../src/app/online/sharing/transport/ShareNode';

afterEach(cleanup);

const PUSH = { from: 'ana', item: 'c'.repeat(22), kind: 'note' as const, title: 'Cave', at: 1 };

function renderList(pullPushed: () => Promise<{ kind: 'created'; path: string }>) {
  const service = { refresh: vi.fn(async () => ({ personId: 'ana', items: [] })), pull: vi.fn(), pullPushed };
  const props = { dismissPush: vi.fn(), onPulled: vi.fn(), onProblem: vi.fn() };
  render(<SharedWithMeList service={service as never} people={[{ personId: 'ana', name: 'Ana' }]} pushes={[PUSH]} {...props} />);
  return props;
}

describe('Shared with me list push requests', () => {
  it('Pull dismisses the request and reports where it landed', async () => {
    const props = renderList(async () => ({ kind: 'created', path: 'Shared/Ana/Cave.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(props.onPulled).toHaveBeenCalledWith('Shared/Ana/Cave.md'));
    expect(props.dismissPush).toHaveBeenCalledWith(PUSH);
  });

  it('Pull that fails tells the receiver why instead of failing silently', async () => {
    const props = renderList(async () => { throw new ShareError('not-shared'); });
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(props.onProblem).toHaveBeenCalledWith('That is not shared with you any more.'));
    expect(props.onPulled).not.toHaveBeenCalled();
  });

  it('a pull that fails for a reason sharing does not know says so, and logs the error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new TypeError('vault.create is not a function');
    const props = renderList(async () => { throw cause; });
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(props.onProblem).toHaveBeenCalledWith('Could not pull that item.'));
    expect(logged).toHaveBeenCalledWith('[Atlas VTT Connect] Pull failed:', cause);
    logged.mockRestore();
  });

  it('a listed item whose pull fails logs the error beside the row', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('disk full');
    const item = { item: 'n'.repeat(22), kind: 'note' as const, title: 'Cave', version: 'v'.repeat(43), size: 1, state: 'new' as const };
    const service = { refresh: vi.fn(async () => ({ personId: 'ana', items: [item] })), pull: vi.fn(async () => { throw cause; }), pullPushed: vi.fn() };
    render(<SharedWithMeList service={service as never} people={[{ personId: 'ana', name: 'Ana' }]} pushes={[]} dismissPush={vi.fn()} onPulled={vi.fn()} onProblem={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pull' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not pull that item.');
    expect(logged).toHaveBeenCalledWith('[Atlas VTT Connect] Pull failed:', cause);
    logged.mockRestore();
  });

  it('Not now only dismisses', () => {
    const pullPushed = vi.fn(async () => ({ kind: 'created' as const, path: 'x' }));
    const props = renderList(pullPushed);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(props.dismissPush).toHaveBeenCalledWith(PUSH);
    expect(pullPushed).not.toHaveBeenCalled();
  });
});
