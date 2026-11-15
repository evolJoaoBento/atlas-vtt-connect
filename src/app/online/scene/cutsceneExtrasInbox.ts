/**
 * Puts the parts of a cutscene scene's board extras together: each map of a run (`key`) sends its extras in parts of one
 * `seq`; a newer `seq` replaces an older one, and the whole is given once every part is here.
 */
import type { BoardExtras } from './boardTypes';

/** The parts of one extras put together: the first part's fields, with every part's walls, lights and props. */
export function mergeBoardExtras(first: BoardExtras, rest: readonly BoardExtras[]): BoardExtras {
  return rest.reduce<BoardExtras>((sum, next) => ({
    ...sum, walls: [...sum.walls, ...next.walls], lights: [...sum.lights, ...next.lights], props: [...sum.props, ...next.props],
  }), first);
}

export class CutsceneExtrasInbox {
  private readonly byKey = new Map<string, { seq: number; parts: Array<BoardExtras | undefined> }>();

  /** Takes one part; returns the whole extras when it completes `seq`, else null. */
  part(runId: string, key: string, seq: number, part: number, parts: number, extras: BoardExtras): BoardExtras | null {
    const id = `${runId}:${key}`;
    let entry = this.byKey.get(id);
    if (entry && seq < entry.seq) return null;
    if (!entry || seq > entry.seq) {
      entry = { seq, parts: new Array<BoardExtras | undefined>(parts).fill(undefined) };
      this.byKey.set(id, entry);
    }
    if (entry.parts.length !== parts || part >= parts) return null;
    entry.parts[part] = extras;
    if (entry.parts.some((each) => each === undefined)) return null;
    const [first, ...rest] = entry.parts as BoardExtras[];
    return mergeBoardExtras(first!, rest);
  }

  clear(): void {
    this.byKey.clear();
  }
}
