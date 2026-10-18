import { showConfirmNotice } from '../../../ui/confirmNotice';
import type { PushRequest } from '../../shareSessionStore';

/** The prompt's line: "Ana is sending you a note: Cellar." */
export function pushPromptText(push: Pick<PushRequest, 'kind' | 'title'>, personName: string): string {
  return `${personName} is sending you ${push.kind === 'map' ? 'a map' : 'a note'}: ${push.title}`;
}

/** "Ana is sending you a note: Cellar" with Allow and Decline, until answered. Names are text, never HTML. */
export function showPushPrompt(push: PushRequest, personName: string, answer: (pull: boolean) => void): { hide(): void } {
  return showConfirmNotice({
    text: (line) => line.setText(pushPromptText(push, personName)),
    answers: [
      { label: 'Allow', cta: true, run: () => answer(true) },
      { label: 'Decline', run: () => answer(false) },
    ],
  });
}
