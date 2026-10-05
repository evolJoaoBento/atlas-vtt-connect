/**
 * Push requests become prompts, one per sender and item, shown while the request is pending. A
 * push never writes anything: Not now only dismisses it, and Pull is the one way in, through
 * `pullPushed`, the same pull the receiver would start from the dialog.
 */
import { dismissPush, type PushRequest, type ShareSessionState } from '../shareSessionStore';
import type { PullOutcome } from './notePull';
import { pullFailedText } from './shareErrors';
import type { SharedWithMe } from './SharedWithMe';

export interface PushPromptDeps {
  show(push: PushRequest, personName: string, answer: (pull: boolean) => void): { hide(): void };
  service(): Pick<SharedWithMe, 'pullPushed'> | null;
  notify(text: string): void;
}

/** Pulls a push the receiver accepted, telling them where it landed or why it did not. */
export function pullAcceptedPush(
  service: Pick<SharedWithMe, 'pullPushed'> | null,
  push: PushRequest,
  report: { pulled(path: string): void; failed(text: string): void },
): void {
  void service?.pullPushed(push).then(
    (outcome: PullOutcome) => { if ('path' in outcome) report.pulled(outcome.path); },
    (error: unknown) => report.failed(pullFailedText(error)),
  );
}

const keyOf = (push: Pick<PushRequest, 'from' | 'item'>): string => `${push.from}/${push.item}`;

/** A store listener that also takes every open prompt down when disposed (the plugin unloads). */
export type PushPromptListener = ((state: ShareSessionState) => void) & { dispose(): void };

/** A listener for `shareSessionStore`: prompts for new pushes, takes the prompt of a dismissed one down. */
export function pushPromptListener(deps: PushPromptDeps): PushPromptListener {
  const prompts = new Map<string, { hide(): void }>();
  const report = { pulled: (path: string): void => deps.notify(`Pulled into ${path}`), failed: (text: string): void => deps.notify(text) };
  const listener = (state: ShareSessionState): void => {
    for (const push of state.pushes) {
      const key = keyOf(push);
      if (prompts.has(key)) continue;
      const name = state.people.find((person) => person.personId === push.from)?.name ?? 'Someone';
      prompts.set(key, deps.show(push, name, (pull) => {
        dismissPush(push.from, push.item);
        if (pull) pullAcceptedPush(deps.service(), push, report);
      }));
    }
    for (const [key, prompt] of [...prompts]) {
      if (state.pushes.some((push) => keyOf(push) === key)) continue;
      prompt.hide();
      prompts.delete(key);
    }
  };
  const dispose = (): void => {
    prompts.forEach((prompt) => prompt.hide());
    prompts.clear();
  };
  return Object.assign(listener, { dispose });
}
