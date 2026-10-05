/** Players' dice and lasers as hosted parts, over Atlas's `dice` and `lasers` (each exists only on an Atlas that has the capability). */
import type { DiceApi, LasersApi, SettingsApi } from '@atlas-vtt/api-types';
import type { OptionalParts } from '../hostedSession';
import { DiceHost } from '../tools/DiceHost';
import { LaserRelay } from '../tools/LaserRelay';

/** Player rolls are rolled by Atlas with the collection's rules, and every roll Atlas logs reaches the players' log. */
export function diceHostPart(dice: DiceApi): NonNullable<OptionalParts['dice']> {
  return ({ session, presented, projection }) => new DiceHost({
    session, presented, projection,
    roll: (request) => dice.roll(request),
    feed: { subscribe: (listener) => dice.onRolled(listener), publish: (result) => { dice.publish(result); } },
  });
}

/** Lasers are heard from and shown in the presented view; the GM's own is the colour set in Atlas. */
export function laserRelayPart(lasers: LasersApi, settings: Pick<SettingsApi, 'get'>): NonNullable<OptionalParts['laser']> {
  return ({ session, presented, projection }) => new LaserRelay({
    session, presented, projection,
    laser: { onLocal: (viewId, listener) => lasers.onLocal(viewId, listener), show: (viewId, laser) => { lasers.show(viewId, laser); } },
    gmColor: () => settings.get('laserPointer').color,
  });
}
