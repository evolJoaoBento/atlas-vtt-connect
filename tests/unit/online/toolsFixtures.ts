/**
 * A GM with the real session and scene broadcaster over an in-memory network, and the player tools' GM
 * side: the dice host and the laser relay, built as the session service builds them, over a fake Atlas
 * whose dice roll the middle of every die and whose view shows the lasers it is given.
 */
import type { DiceRollResult, FogOperation, ViewId } from '@atlas-vtt/api-types';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { diceHostPart, laserRelayPart } from '../../../src/app/online/atlas/toolParts';
import type { ControlMessage } from '../../../src/app/online/protocol';
import type { HostedContext } from '../../../src/app/online/hostedSession';
import { controlWorld, partyState, type ControlPlayer } from './controlFixtures';
import type { ViewState } from './presentedFixtures';

/** Rolls the middle of every die: a d4 rolls 3, a d6 4, a d8 5, a d20 11. */
export const MIDDLE_ROLL = (): number => 0.5;

type Laser = Extract<ControlMessage, { type: 'laser' }>;
type DiceLog = Extract<ControlMessage, { type: 'dice-log' }>;

/** The party in the open and under one fog rectangle: goblin sits at (1050, 1050), the fog from (900, 900) to (1300, 1300). */
export function toolsState(): ViewState {
  const state = partyState();
  const fog = {
    f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 },
  } as unknown as Record<string, FogOperation>;
  const goblin = { id: 'goblin', kind: 'character', x: 1050, y: 1050, imagePath: 'art/goblin.png', name: 'Goblin' } as ViewState['objects']['tokens'][string];
  return { ...state, objects: { ...state.objects, fog, tokens: { ...state.objects.tokens, goblin } } };
}

export function toolsWorld(options: { rules?: Partial<PlayerViewRules> } = {}) {
  const world = controlWorld({ scene: { state: toolsState(), rules: { showTokenNameplates: true, ...options.rules } } });
  const scene = world.scene!;
  const { atlas, extension } = scene.presented;
  atlas.dice.setRandom(MIDDLE_ROLL);
  /** Every roll Atlas's dice log got, the GM's, players' and published ones alike. */
  const logged: DiceRollResult[] = [];
  extension.dice.onRolled((result) => logged.push(result));
  const context: HostedContext = { session: world.gm, presented: scene.presented, projection: scene.broadcaster };
  const dice = diceHostPart(extension.dice)(context);
  const lasers = laserRelayPart(extension.lasers, extension.settings)(context);
  dice.start();
  lasers.start();
  const viewId: ViewId = scene.view;
  return {
    ...world, ...scene, atlas, extension, dice, lasers, logged,
    /** Rolls made elsewhere, as Atlas's own dice tray and statblocks put them in the log. */
    publish: (result: DiceRollResult): void => extension.dice.publish(result),
    /** The GM draws with the laser in the presented view. */
    emitLocal: (event: Parameters<typeof atlas.lasers.emitLocal>[1]): void => atlas.lasers.emitLocal(viewId, event),
    /** What the GM's view drew of other people's lasers. */
    shown: () => atlas.lasers.shown(viewId),
    present: (): void => scene.presented.present(scene.view, scene.tavern),
    /** The dice logs the GM sent `player`, in order. */
    logs: (player: ControlPlayer): DiceLog[] => player.received.filter((message): message is DiceLog => message.type === 'dice-log'),
    /** The lasers the GM sent `player`, in order. */
    lasersOf: (player: ControlPlayer): Laser[] => player.received.filter((message): message is Laser => message.type === 'laser'),
    /** The GM removes the player from the session: the parts that track players hear the new list, as the hosted session tells them. */
    removePlayer(player: ControlPlayer): void {
      const players = world.gm.getPlayers().filter((entry) => entry.playerId !== player.playerId);
      for (const part of [dice, lasers]) part.playersChanged?.(players);
    },
    sceneId: (): string => scene.broadcaster.currentProjection()?.sceneId ?? 'none',
    finish(): void {
      lasers.stop();
      dice.stop();
      world.finish();
    },
  };
}
