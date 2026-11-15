/**
 * A session with a stand-in for the GM's Atlas store, for the tests of `MeasureHost`: three players on scene `s1`,
 * whose map the Atlas view `v1` holds; measures land in `measures`, and every history transaction is counted.
 */
import { vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { MeasureHost } from '../../../src/app/online/tools/MeasureHost';
import { PlayerColors } from '../../../src/app/online/tools/playerColors';
import type { MapSpell, SpellRequest } from '../../../src/app/online/tools/spells';
import { stockMeasuresApi, type MeasureStoreView } from '../../../src/connect/stockMeasures';

export const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
export const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
export const CARA: SessionPlayer = { playerId: 'p3', name: 'Cara', status: 'admitted' };
export const MAP = 'maps/cave.atlasmap';

export function measureWorld(options: { cap?: number; cutscene?: () => boolean; colors?: boolean } = {}) {
  const sent: Array<[string, ControlMessage]> = [];
  const measures: Record<string, Record<string, unknown>> = {};
  const flashes: Array<[string, MapSpell]> = [];
  const handlers: SessionHandler[] = [];
  let slotListener: ((change: never) => void) | null = null;
  let players = [ANA, BEN, CARA];
  let transactions = 0;
  let next = 0;
  let held = MAP;
  // The clock stands still unless a test moves it on (`tick`): requests are held to a rate.
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const state = () => ({
    mapPath: held, mapLoaded: true, isMapLoading: false, objects: { measures },
    addMeasure: (data: Record<string, unknown>): string | null => {
      if (Object.keys(measures).length >= (options.cap ?? 256)) return null;
      const id = `measure_${++next}`;
      measures[id] = { id, kind: 'measure', ...data };
      return id;
    },
    updateMeasure: (id: string, changes: Record<string, unknown>) => { Object.assign(measures[id]!, changes); },
    deleteMeasure: (id: string) => { delete measures[id]; },
  });
  const view: MeasureStoreView = { atlasStore: { getState: state, temporal: { getState: () => ({ transaction: <T>(fn: () => T): T => { transactions++; return fn(); } }) } } };
  const slot = { sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: MAP };
  const session = { use: (h: SessionHandler) => { handlers.push(h); return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => players };
  // Players' own colours, where a test asks for them: their picks recolour what they made.
  const colors = options.colors ? new PlayerColors(session as never) : null;
  colors?.start();
  const host = new MeasureHost({
    session: session as never,
    ...(colors ? { colors } : {}),
    projection: {
      slotOf: () => slot, audience: () => players.map((player) => player.playerId), shownSlot: () => slot,
      onSlotChange: (listener: (change: never) => void) => { slotListener = listener; return () => undefined; },
    } as never,
    measures: stockMeasuresApi({ view: (id) => (id === 'v1' ? view : null) }),
    board: { flash: (mapPath, cast) => { flashes.push([mapPath, cast]); }, templatesChanged: () => undefined },
    ...(options.cutscene ? { cutscene: { running: options.cutscene } } : {}),
  });
  // Ana and Ben control the wizard; Cara controls nothing.
  const control = new Map([['wizard', new Set(['p1', 'p2'])]]);
  const notify = vi.fn();
  host.useAsks({ controls: (playerId, tokenId) => control.get(tokenId)?.has(playerId) ?? false, notify });
  host.start();
  const lastOf = <T extends ControlMessage['type']>(playerId: string, type: T) => sent.filter(([to, m]) => to === playerId && m.type === type).at(-1)?.[1] as Extract<ControlMessage, { type: T }> | undefined;
  return {
    host, sent, measures, flashes, notify, control, lastOf,
    asks: (playerId: string): SpellRequest[] => lastOf(playerId, 'spell-asks')?.asks ?? [],
    transactions: () => transactions,
    tick: (ms = 1000) => { now += ms; },
    list: () => Object.values(measures),
    send: (player: SessionPlayer, message: ControlMessage) => { for (const handler of handlers) handler.onMessage?.(player, message); },
    admit: (player: SessionPlayer) => { for (const handler of handlers) handler.onAdmitted?.(player); },
    setPlayers: (list: SessionPlayer[]) => { players = list; host.playersChanged(list); },
    /** Atlas goes to another map: `MAP` is no longer held. */
    hold: (mapPath: string) => { held = mapPath; },
    slotChange: (kind: string) => slotListener?.({ kind, slot } as never),
  };
}
