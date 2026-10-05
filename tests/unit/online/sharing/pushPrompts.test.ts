import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushPromptListener, type PushPromptDeps } from '../../../../src/app/online/sharing/receive/pushPrompts';
import { addPush, shareSessionStore } from '../../../../src/app/online/sharing/shareSessionStore';

const PUSH = { from: 'ana', item: 'c'.repeat(22), kind: 'note' as const, title: 'Cave', at: 1 };

function setup() {
  const answers: Array<(pull: boolean) => void> = [];
  const hide = vi.fn();
  const pullPushed = vi.fn(async () => ({ kind: 'created' as const, path: 'Shared/Ana/Cave.md' }));
  const deps: PushPromptDeps = {
    show: vi.fn((_push, _name, answer) => { answers.push(answer); return { hide }; }),
    service: () => ({ pullPushed }),
    notify: vi.fn(),
  };
  shareSessionStore.setState({ people: [{ personId: 'ana', name: 'Ana' }], pushes: [] });
  const stop = shareSessionStore.subscribe(pushPromptListener(deps));
  return { deps, answers, hide, pullPushed, stop };
}

afterEach(() => shareSessionStore.setState({ session: null, people: [], pushes: [] }));

describe('push prompts', () => {
  it('a push only shows a prompt, named for the sender, once', () => {
    const { deps, pullPushed, stop } = setup();
    addPush(PUSH);
    addPush({ ...PUSH, at: 2 });
    expect(deps.show).toHaveBeenCalledTimes(1);
    expect(deps.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cave' }), 'Ana', expect.any(Function));
    expect(pullPushed).not.toHaveBeenCalled();
    stop();
  });

  it('Not now dismisses the push and writes nothing: nothing is pulled', () => {
    const { answers, pullPushed, stop } = setup();
    addPush(PUSH);
    answers[0]!(false);
    expect(shareSessionStore.getState().pushes).toEqual([]);
    expect(pullPushed).not.toHaveBeenCalled();
    stop();
  });

  it('Pull dismisses the push and pulls it, through pullPushed only', async () => {
    const { deps, answers, pullPushed, stop } = setup();
    addPush(PUSH);
    answers[0]!(true);
    expect(shareSessionStore.getState().pushes).toEqual([]);
    expect(pullPushed).toHaveBeenCalledWith(PUSH);
    await vi.waitFor(() => expect(deps.notify).toHaveBeenCalledWith('Pulled into Shared/Ana/Cave.md'));
    stop();
  });

  it('takes the prompt down when the push goes away some other way', () => {
    const { hide, stop } = setup();
    addPush(PUSH);
    shareSessionStore.setState({ pushes: [] });
    expect(hide).toHaveBeenCalledTimes(1);
    stop();
  });

  it('disposing the listener (the plugin unloads) takes every open prompt down (M5)', () => {
    const hide = vi.fn();
    const deps: PushPromptDeps = { show: vi.fn(() => ({ hide })), service: () => null, notify: vi.fn() };
    shareSessionStore.setState({ people: [{ personId: 'ana', name: 'Ana' }], pushes: [] });
    const listener = pushPromptListener(deps);
    const stop = shareSessionStore.subscribe(listener);
    addPush(PUSH);
    addPush({ ...PUSH, item: 'd'.repeat(22) });
    expect(deps.show).toHaveBeenCalledTimes(2);
    listener.dispose();
    expect(hide).toHaveBeenCalledTimes(2);
    listener.dispose();
    expect(hide).toHaveBeenCalledTimes(2);
    stop();
  });
});
