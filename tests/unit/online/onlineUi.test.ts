import { beforeEach, describe, expect, it, vi } from 'vitest';

const notices: FakeNotice[] = [];
/** Like Obsidian: the message sits in the notice, and a click on the notice hides it. */
class FakeNotice {
  readonly noticeEl = document.createElement('div');
  hidden = false;
  constructor(public readonly message: string | DocumentFragment, _timeout?: number) {
    if (typeof message === 'string') this.noticeEl.textContent = message;
    else this.noticeEl.append(message);
    this.noticeEl.addEventListener('click', () => this.hide());
    notices.push(this);
  }
  hide(): void { this.hidden = true; }
}

vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<object>()), Notice: FakeNotice }));

const { showJoinRequestNotice } = await import('../../../src/app/online/ui/joinRequestNotice');

beforeEach(() => { notices.length = 0; });

// The fork's player page and own server settings blocks are ported with the setting tab (settingTab.test.ts).
describe('join request notice', () => {
  it('stays open when its text is clicked and closes with an answer', () => {
    const answers: boolean[] = [];
    showJoinRequestNotice({ playerId: 'p', name: 'Anna', status: 'pending' }, (allow) => answers.push(allow));
    const notice = notices[0]!;
    notice.noticeEl.querySelector<HTMLElement>('.atlas-connect-request__text')!.click();
    expect(notice.hidden).toBe(false);
    expect(answers).toEqual([]);
    notice.noticeEl.querySelector<HTMLButtonElement>('button.mod-cta')!.click();
    expect(answers).toEqual([true]);
    expect(notice.hidden).toBe(true);
  });

  it('offers Link for a new device with a known name, and marks who the player is', () => {
    let linked = 0;
    showJoinRequestNotice({ playerId: 'p', name: 'Anna', status: 'pending' }, () => undefined, {
      identity: { kind: 'new', sameName: { name: 'Anna', personId: 'person-1' } } as never,
      link: () => { linked++; },
    });
    const notice = notices[0]!;
    expect(notice.noticeEl.querySelector('.atlas-connect-request__mark')?.textContent).toBe(' (new)');
    expect(notice.noticeEl.querySelector('.atlas-connect-request__warning')?.textContent).toBe('Someone named Anna is already in your people list');
    const buttons = [...notice.noticeEl.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toEqual(['Allow', 'Link to Anna', 'Deny']);
    notice.noticeEl.querySelectorAll('button')[1]!.click();
    expect(linked).toBe(1);
    expect(notice.hidden).toBe(true);
  });
});
