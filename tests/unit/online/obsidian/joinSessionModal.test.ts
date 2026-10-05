import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import type { JoinProblem } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { JoinSessionModal } from '../../../../src/app/online/obsidian/ui/JoinSessionModal';
import type { PlayerSessionState } from '../../../../src/app/online/PlayerSession';

const state = (status: PlayerSessionState['status'], reason: string | null = null): PlayerSessionState => ({
  status, playerId: status === 'admitted' ? 'p1' : null, title: 'Table', players: [], reason,
});

function open(result: JoinProblem | null = null) {
  const service = { join: vi.fn((_link: string, _name: string): JoinProblem | null => result), leave: vi.fn() };
  const modal = new JoinSessionModal({} as App, service, 'Anna');
  const close = vi.spyOn(modal, 'close');
  modal.onOpen();
  const [link, name] = Array.from(modal.contentEl.querySelectorAll('input'));
  const button = (text: string): HTMLButtonElement =>
    Array.from(modal.contentEl.querySelectorAll('button')).find((candidate) => candidate.textContent === text)!;
  const type = (input: HTMLInputElement | undefined, value: string): void => {
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
  };
  const status = (): string => modal.contentEl.querySelector('[role="status"]')?.textContent ?? '';
  return { service, modal, close, link, name, button, type, status };
}

afterEach(() => { joinedSessionStore.setState({ session: null }); });

describe('Join online session dialog', () => {
  it('asks for the link and offers the remembered name, in the native Atlas dialog style', () => {
    const { modal, link, name } = open();
    expect(modal.titleEl.textContent).toBe('Join online session');
    expect(modal.modalEl.classList.contains('atlas-native-modal')).toBe(true);
    expect(link?.getAttribute('aria-label')).toBe('Join link');
    expect(name?.value).toBe('Anna');
  });

  it("says what is wrong with the link, the name or the moment, and stays open", () => {
    const { button, status, close } = open('hosting');
    button('Join').click();
    expect(status()).toBe('Stop hosting your online session before joining another.');
    expect(close).not.toHaveBeenCalled();
  });

  it('shows the way in and closes once the GM lets the player in, without leaving', () => {
    const { service, modal, button, type, link, status, close } = open();
    type(link, 'https://example.org/join/#id=gm');
    button('Join').click();
    expect(service.join).toHaveBeenCalledWith('https://example.org/join/#id=gm', 'Anna');
    joinedSessionStore.setState({ session: state('waiting') });
    expect(status()).toBe('Waiting for the GM to let you in…');
    expect(button('Join').disabled).toBe(true);
    joinedSessionStore.setState({ session: state('admitted') });
    expect(close).toHaveBeenCalled();
    modal.onClose();
    expect(service.leave).not.toHaveBeenCalled();
  });

  it("shows the GM's refusal, ends that join and offers Join again", () => {
    const { service, button, status } = open();
    button('Join').click();
    joinedSessionStore.setState({ session: state('denied', 'full') });
    expect(status()).toBe('The session is full.');
    expect(service.leave).toHaveBeenCalledOnce();
    expect(button('Join').disabled).toBe(false);
  });

  it('cancels the join when closed before the GM answers', () => {
    const { service, modal, button } = open();
    button('Join').click();
    joinedSessionStore.setState({ session: state('waiting') });
    modal.onClose();
    expect(service.leave).toHaveBeenCalledOnce();
  });

  it('focuses the link field and joins on Enter', () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
    const { service, link, name, type } = open();
    expect(focus.mock.contexts).toEqual([link]);
    focus.mockRestore();
    type(link, 'https://example.org/join/#id=gm');
    name!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(service.join).toHaveBeenCalledWith('https://example.org/join/#id=gm', 'Anna');
  });
});
