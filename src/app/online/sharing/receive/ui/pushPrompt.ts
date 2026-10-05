import { showConfirmNotice } from '../../../ui/confirmNotice';
import type { PushRequest } from '../../shareSessionStore';

/** "Ana asks you to pull Goblin cave." with Pull and Not now, until answered. Names are text, never HTML. */
export function showPushPrompt(push: PushRequest, personName: string, answer: (pull: boolean) => void): { hide(): void } {
  return showConfirmNotice({
    text: (line) => line.setText(`${personName} asks you to pull ${push.title}.`),
    answers: [
      { label: 'Pull', cta: true, run: () => answer(true) },
      { label: 'Not now', run: () => answer(false) },
    ],
  });
}
