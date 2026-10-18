/**
 * Notes sent with Send to…: one recipient may pull one note for a while, whatever its `atlas-share` rule says and
 * whether or not they are in the People book. A grant names the recipient by table and person, as the session knows
 * them, and lapses after `SEND_GRANT_MS` (the receiver answers the prompt long before), or when this Atlas restarts.
 */
import type { Recipient } from './audience';

export const SEND_GRANT_MS = 30 * 60_000;

export class SendGrants {
  private readonly grants = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Lets `recipient` pull the note at `path` until the grant lapses. */
  grant(recipient: Recipient, path: string): void {
    const key = keyOf(recipient);
    const paths = this.grants.get(key) ?? new Map<string, number>();
    paths.set(path, this.now() + SEND_GRANT_MS);
    this.grants.set(key, paths);
  }

  /** The notes `recipient` was sent and may still pull. */
  paths(recipient: Recipient): string[] {
    const paths = this.grants.get(keyOf(recipient));
    if (!paths) return [];
    const now = this.now();
    for (const [path, until] of [...paths]) if (until <= now) paths.delete(path);
    return [...paths.keys()];
  }

  /** A note moved: its grants follow it; one deleted takes them away. */
  moved(from: string, to: string | null): void {
    for (const paths of this.grants.values()) {
      const until = paths.get(from);
      if (until === undefined) continue;
      paths.delete(from);
      if (to !== null) paths.set(to, until);
    }
  }
}

function keyOf(recipient: Recipient): string {
  return `${recipient.tableId}/${recipient.personId}`;
}
