/**
 * Connect's claim on Atlas's one view. A hosted session sends players the scene that view shows, so the view must stay
 * while the session runs. Tabletop opens Atlas's tab behind a 3D board when none is open, and closes it again with its
 * last board unless someone still needs it: this says Connect does, for as long as it hosts.
 */
import type { AtlasHost } from '../../packages/atlas-host/src/index';

export interface HostingState {
  /** The online session's status, as the store has it: `hosting` while a session runs. */
  state(): { status: string };
  subscribe(listener: () => void): () => void;
}

/** Holds a claim on the host while the session is hosted; returns the stop, which lets go of it. */
export function claimHostWhileHosting(host: Pick<AtlasHost, 'claim'>, hosting: HostingState): () => void {
  let release: (() => void) | null = null;
  const follow = (): void => {
    const now = hosting.state().status === 'hosting';
    if (now && !release) release = host.claim();
    else if (!now && release) {
      release();
      release = null;
    }
  };
  follow();
  const unsubscribe = hosting.subscribe(follow);
  return () => {
    unsubscribe();
    release?.();
    release = null;
  };
}
