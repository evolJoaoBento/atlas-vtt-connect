/** Players' tokens, dice and lasers as hosted parts, over Atlas's `tokens`, `dice` and `lasers` (each exists only on an Atlas that has the capability). */
import type { DiceApi, LasersApi, SettingsApi, TokensApi } from '@atlas-vtt/api-types';
import type { OptionalParts } from '../hostedSession';
import { TokenControlHost } from '../control/TokenControlHost';
import { DiceHost } from '../tools/DiceHost';
import { LaserRelay } from '../tools/LaserRelay';

/** The tokens the GM assigns players, moved through Atlas's `tokens.move`; without `tokens` there is no host and no control list is sent. */
export function tokenControlPart(tokens: TokensApi): NonNullable<OptionalParts['tokenControl']> {
  return ({ session, projection }) => new TokenControlHost({ session, projection, tokens });
}

/** Player rolls are rolled by Atlas with the collection's rules, and every roll Atlas logs reaches the players' log. */
export function diceHostPart(dice: DiceApi): NonNullable<OptionalParts['dice']> {
  return ({ session, projection }) => new DiceHost({
    session, projection,
    roll: (request) => dice.roll(request),
    feed: { subscribe: (listener) => dice.onRolled(listener), publish: (result) => { dice.publish(result); } },
  });
}

/** Lasers are heard from and shown in the view of the scene the GM's view shows; the GM's own is the colour set in Atlas. */
export function laserRelayPart(lasers: LasersApi, settings: Pick<SettingsApi, 'get'>): NonNullable<OptionalParts['laser']> {
  return ({ session, projection }) => new LaserRelay({
    session, projection,
    laser: { onLocal: (viewId, listener) => lasers.onLocal(viewId, listener), show: (viewId, laser) => { lasers.show(viewId, laser); } },
    gmColor: () => settings.get('laserPointer').color,
  });
}
