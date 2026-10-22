/** Players' tokens, dice and lasers as hosted parts, over Atlas's `tokens`, `dice` and `lasers` (each exists only on an Atlas that has the capability). */
import type { AtlasExtension, Character, DiceApi, LasersApi, SettingsApi, TokensApi, ViewId } from '@atlas-vtt/api-types';
import type { OptionalParts } from '../hostedSession';
import { TokenControlHost } from '../control/TokenControlHost';
import { DiceHost, foldedRequest, SHEET_AWARE_DICE } from '../tools/DiceHost';
import { DEFAULT_DICE_RULES, offeredDiceRules } from '../tools/physicalRolls';
import type { OfferedDiceRules } from '../tools/toolMessages';
import { LaserRelay } from '../tools/LaserRelay';
import { SheetHost } from '../tools/SheetHost';
import { PingRelay } from '../tools/PingRelay';
import { TemplateHost } from '../tools/TemplateHost';
import type { MapTemplate } from '../tools/templates';
import type { SheetCard } from '../tools/sheetCards';

/** The tokens the GM assigns players, moved through Atlas's `tokens.move`; without `tokens` there is no host and no control list is sent. */
export function tokenControlPart(tokens: TokensApi): NonNullable<OptionalParts['tokenControl']> {
  return ({ session, projection }) => new TokenControlHost({ session, projection, tokens });
}

/** The dice rules of the collection holding a map, as the GM offers them and judges players' physical rolls by; Atlas's defaults when they cannot be read. */
export function offeredRulesOf(atlas: Pick<AtlasExtension, 'rules'>): (mapPath: string | null) => OfferedDiceRules {
  return (mapPath) => {
    try {
      return offeredDiceRules(atlas.rules.forMap(mapPath).dice);
    } catch (error) {
      console.warn('[Atlas VTT Connect] Could not read the dice rules of a map; using the defaults:', error);
      return DEFAULT_DICE_RULES;
    }
  };
}

/**
 * Player rolls are rolled by Atlas with the collection's rules, and every roll Atlas logs reaches the players' log.
 * With `rules`, players' physical rolls are judged by them and published into that log.
 */
export function diceHostPart(dice: DiceApi, rules?: (mapPath: string | null) => OfferedDiceRules): NonNullable<OptionalParts['dice']> {
  return ({ session, projection }) => new DiceHost({
    session, projection, ...(rules ? { rules } : {}),
    // Connect's stock stand-in hands the ability and the side to Atlas's dice tool; an Atlas API takes neither.
    roll: (request) => dice.roll(SHEET_AWARE_DICE.has(dice) ? request : foldedRequest(request)),
    feed: { subscribe: (listener) => dice.onRolled(listener), publish: (result) => { dice.publish(result); } },
  });
}

/** Lasers are heard from and shown in the view of the scene the GM's view shows; the GM's own is the colour set in Atlas. */
export function laserRelayPart(lasers: LasersApi, settings: Pick<SettingsApi, 'get'>): NonNullable<OptionalParts['laser']> {
  return ({ session, projection, board }) => new LaserRelay({
    session, projection, ...(board ? { board } : {}),
    laser: { onLocal: (viewId, listener) => lasers.onLocal(viewId, listener), show: (viewId, laser) => { lasers.show(viewId, laser); } },
    gmColor: () => settings.get('laserPointer').color,
  });
}

/** Reads the stat block a token links: Fantasy Statblocks' creature, or the note's own frontmatter (`statblockSource.ts`). */
export interface StatblockSource {
  read(token: Character): unknown;
  /** Atlas's card of the token's stat block (`sheetCards.ts`): undefined while it is drawn, null where there is none. */
  card?(token: Character): SheetCard | null | undefined;
  /** Calls `listener` when stat blocks may read differently; returns the stop. */
  onChange(listener: () => void): () => void;
}

/**
 * Players' own sheets over Atlas's rules (the resources of each map's collection) and the stat blocks tokens link;
 * without a stat block source they carry numbers only.
 */
export function sheetHostPart(atlas: Pick<AtlasExtension, 'rules'>, statblocks: StatblockSource | null): NonNullable<OptionalParts['sheets']> {
  return ({ session, projection, control, rollFor }) => new SheetHost({
    session, projection, control,
    resources: (mapPath) => atlas.rules.forMap(mapPath).resources,
    readStatblock: (token) => statblocks?.read(token) ?? null,
    ...(statblocks?.card ? { readCard: (token: Character) => statblocks.card?.(token) ?? null } : {}),
    ...(statblocks ? { onStatblocksChanged: (listener: () => void) => statblocks.onChange(listener) } : {}),
    ...(rollFor ? { rollFor } : {}),
  });
}

/** Shows a ping on a view's map: Connect's stock Atlas stand-in adds it to `lasers` (an Atlas API has none). */
type PingShowing = { showPing?: (viewId: ViewId, ping: { x: number; y: number; color: string }) => void };

/** Players' pings, relayed to the other players of their scene and shown in the GM's view where the lasers can draw. */
export function pingRelayPart(lasers: LasersApi | null): NonNullable<OptionalParts['pings']> {
  // The stand-in's lasers may carry it; an Atlas API's never do.
  const showPing = lasers ? (lasers as unknown as PingShowing).showPing : undefined;
  return ({ session, projection, board }) => new PingRelay({
    session, projection, ...(board ? { board } : {}),
    ...(typeof showPing === 'function' ? { show: (viewId: ViewId, ping: { x: number; y: number; color: string }) => showPing.call(lasers, viewId, ping) } : {}),
  });
}

/** Draws a scene's templates on a view's map: Connect's stock Atlas stand-in adds it to `lasers` (an Atlas API has none). */
type TemplateShowing = { showTemplates?: (viewId: ViewId, templates: readonly MapTemplate[], coneAngle: number, erase?: (id: string) => void) => void };

/** Players' lasting templates, kept per scene and drawn in the GM's view where the lasers can draw. */
export function templateHostPart(lasers: LasersApi | null, coneAngle: (mapPath: string | null) => number): NonNullable<OptionalParts['templates']> {
  const showTemplates = lasers ? (lasers as unknown as TemplateShowing).showTemplates : undefined;
  return ({ session, projection, board }) => new TemplateHost({
    session, projection, ...(board ? { board } : {}),
    ...(typeof showTemplates === 'function'
      ? { show: (viewId: ViewId, templates: readonly MapTemplate[], mapPath: string, erase: (id: string) => void) => showTemplates.call(lasers, viewId, templates, coneAngle(mapPath || null), erase) }
      : {}),
  });
}
