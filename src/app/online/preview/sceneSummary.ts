/** Widgets and initiative as the lines the join page lists beside its preview. */
import { SIDE_LABELS, sidesInOrder } from '@atlas-vtt/shared/rules';
import { formatTimerTime } from '../../utils/timerWidget';
import type { PresencePlayer } from '../protocol';
import { listedSide } from '../scene/initiativeSides';
import type { PlayerInitiative, PlayerInitiativeEntry, PlayerSideRow, PlayerToken, PlayerWidget } from '../scene/sceneTypes';

export function widgetLines(widgets: readonly PlayerWidget[]): string[] {
  return widgets.map((widget) => {
    const value = widget.type === 'timer' ? formatTimerTime(widget.value) : String(widget.value);
    return `${widget.label || widget.type}: ${value}`;
  });
}

/** A list row: its text, and how full the bar after it is (0 to 1) where the player window draws one. */
export interface ListRow {
  text: string;
  share?: number;
  /** A side's name over its combatants (the list by sides). */
  heading?: true;
  /** The side whose turn it is (a heading). */
  current?: true;
  /** A combatant that does not act this round; the window fades it. */
  sittingOut?: true;
}

const bar = (entry: PlayerInitiativeEntry): Pick<ListRow, 'share' | 'sittingOut'> => ({
  ...(typeof entry.hpShare === 'number' ? { share: entry.hpShare } : {}),
  ...(entry.sitsOut === true && { sittingOut: true as const }),
});

/**
 * The initiative list's rows, as the player window lists them. In turn order a row is the number, the
 * name and a bar for the creature's health; by sides (`initiative.sides`) the combatants stand under
 * their side's name, the side that acts first on top and the side whose turn it is marked, with no
 * numbers. A side nobody is listed under is left out. `tokens` say which side a combatant fights on.
 */
export function initiativeLines(initiative: PlayerInitiative | null, tokens: Readonly<Record<string, Pick<PlayerToken, 'side'>>> = {}): ListRow[] {
  if (!initiative || initiative.entries.length === 0) return [];
  const lines: ListRow[] = initiative.active ? [{ text: `Round ${initiative.round}` }] : [];
  const { sides } = initiative;
  if (sides) {
    // The side list of Atlas, in the order the sides act; from an older GM, the two built-in sides, `first` first.
    const rows: readonly PlayerSideRow[] = initiative.sideList
      ?? sidesInOrder(sides.first).map((side) => ({ id: side, name: SIDE_LABELS[side], ...(sides.active === side && { turn: true as const }) }));
    for (const row of rows) {
      const members = initiative.entries.filter((entry) => listedSide(tokens, entry) === row.id);
      if (members.length === 0) continue;
      lines.push({ text: row.roll !== undefined ? `${row.name}, rolled ${row.roll}` : row.name, heading: true, ...(row.turn === true && { current: true as const }) });
      for (const entry of members) lines.push({ text: entry.name ?? 'Unnamed', ...bar(entry) });
    }
    return lines;
  }
  for (const entry of initiative.entries) {
    const turn = entry.isActive ? '▶ ' : '';
    lines.push({ text: `${turn}${entry.initiative} · ${entry.name ?? 'Unnamed'}`, ...bar(entry) });
  }
  return lines;
}

/** The players in the session, the away ones marked. */
export function playerLines(players: readonly PresencePlayer[]): string[] {
  return players.map((player) => (player.connected ? player.name : `${player.name} (away)`));
}
