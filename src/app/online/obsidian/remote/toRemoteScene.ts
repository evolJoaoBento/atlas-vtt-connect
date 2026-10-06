/**
 * The presented scene as Atlas's remote view takes it (`RemoteSceneInput`), and the player's part of it
 * (`RemotePlayerState`): Atlas's own records rebuilt from what players receive, images by object URL. Only the
 * fields players are sent are read (`playerSceneRecords.ts`, `convert*.ts`), so nothing more than the GM's
 * projection can reach the view. A token carries no `notePath` or `statblockPath`: they would name the GM's notes.
 *
 * Atlas copies a record again only when it is handed a different object, so `RemoteSceneMemo` hands the same
 * converted object back while the received record, its image and where this view holds it stay the same.
 */
import type {
  DrawingStroke, FogOperation, GridState, InitiativeState, RemoteMeasurementInput, RemotePlayerState, RemoteSceneInput, TextElement, TokenEntity,
} from '@atlas-vtt/api-types';
import { sameValue, setOwn } from '../../scene/sceneDiff';
import { withMeasurementDefaults } from '../../scene/sceneLimits';
import type { PlayerMeasurement, PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import type { RemoteImages } from '../onlineJoinTypes';
import { atlasInitiative, atlasInitiativeRules, atlasWidgets } from '../convertPanels';
import { atlasInitiativeHealth, atlasResourceDefinitions } from '../convertResources';
import { atlasDrawing, atlasFog, atlasText } from '../convertShapes';
import { atlasToken, neutralConditions } from '../convertTokens';
import { atlasGrid } from '../playerSceneRecords';

/** Where this view shows a token instead of the GM's position (a drop the GM has not answered); null for the GM's. */
export type PositionOf = (tokenId: string) => ScenePoint | null;

interface Entry<S, A> { source: S; key: string; record: A }

/**
 * Converted records by id, the same object while its source (the same object, or equal by value: a snapshot hands
 * new objects for what did not change) and key stay the same; the same record while every entry is.
 */
class RecordMemo<S, A> {
  private entries = new Map<string, Entry<S, A>>();
  private result: Record<string, A> | null = null;

  build(records: Readonly<Record<string, S>>, keyOf: (id: string) => string, convert: (id: string, source: S) => A): Record<string, A> {
    const next = new Map<string, Entry<S, A>>();
    const result: Record<string, A> = {};
    let unchanged = this.result !== null && this.entries.size === Object.keys(records).length;
    for (const [id, source] of Object.entries(records)) {
      const key = keyOf(id);
      const previous = this.entries.get(id);
      const same = previous !== undefined && previous.key === key && (previous.source === source || sameValue(previous.source, source));
      const entry = same ? previous : { source, key, record: convert(id, source) };
      if (!same) unchanged = false;
      next.set(id, entry);
      setOwn(result, id, entry.record);
    }
    this.entries = next;
    if (unchanged && this.result) return this.result;
    this.result = result;
    return result;
  }
}

/** One value, made again only when one of its sources is a different object or its key changed. */
class Kept<T> {
  private sources: readonly unknown[] = [];
  private key = '';
  private value: T | undefined;

  of(sources: readonly unknown[], key: string, make: () => T): T {
    const same = this.value !== undefined && key === this.key && sources.length === this.sources.length && sources.every((source, i) => source === this.sources[i]);
    if (!same) {
      this.sources = sources;
      this.key = key;
      this.value = make();
    }
    return this.value as T;
  }
}

/** The GM's measurement as Atlas's settings, for the drag ruler and the measure tool. */
export function atlasMeasurement(measurement: PlayerMeasurement): RemoteMeasurementInput {
  return {
    mode: measurement.mode,
    unitType: measurement.unitType,
    unitDistance: measurement.unitDistance,
    // Atlas before API 1.14.0 checks only the fields it knows, so the extra one is harmless there. Atlas refuses one
    // that is not above 0; left out, it takes the distance per cell.
    ...(measurement.ruleDistance > 0 ? { ruleDistance: measurement.ruleDistance } : {}),
    diagonalRule: measurement.diagonalRule,
    rangeBands: measurement.rangeBands.map((band) => ({ name: band.name, maxSquares: band.maxSquares })),
    coneAngle: measurement.coneAngle,
  };
}

/**
 * The player's part: the tokens they may move (none unless they are in the session), the GM's measurement, and the
 * stand-ins the GM's projection decided on (neutral conditions, bar definitions per token, the initiative's grouping
 * and health bars). Without a scene: nothing to move and Atlas's default measurement.
 */
export function remotePlayerState(scene: PlayerScene | null, movableTokenIds: readonly string[]): RemotePlayerState {
  const health = atlasInitiativeHealth(scene?.initiative ?? null);
  return {
    movableTokenIds: [...movableTokenIds],
    measurement: atlasMeasurement(scene?.measurement ?? withMeasurementDefaults(undefined)),
    tokenUi: {
      conditions: scene ? neutralConditions(scene.tokens) : [],
      resources: scene ? atlasResourceDefinitions(scene.tokens) : {},
    },
    initiative: { rules: scene ? atlasInitiativeRules(scene.initiative) : null, health },
  };
}

/** Converts scenes for one remote view, keeping unchanged records the same objects. */
export class RemoteSceneMemo {
  private readonly tokens = new RecordMemo<PlayerScene['tokens'][string], TokenEntity>();
  private readonly fog = new RecordMemo<PlayerScene['fog'][string], FogOperation>();
  private readonly texts = new RecordMemo<PlayerScene['texts'][string], TextElement>();
  private readonly drawings = new RecordMemo<PlayerScene['drawings'][string], DrawingStroke>();
  private readonly grid = new Kept<GridState>();
  private readonly widgets = new Kept<RemoteSceneInput['widgets']>();
  private readonly initiative = new Kept<InitiativeState>();

  /** The scene for `RemoteView.setScene`; `positionOf` holds tokens where this view shows them. */
  input(scene: PlayerScene, images: RemoteImages, positionOf: PositionOf = () => null): RemoteSceneInput {
    const tokenImages: Record<string, string | null> = {};
    for (const [id, token] of Object.entries(scene.tokens)) setOwn(tokenImages, id, images.token(token.image));
    const urlOf = (id: string): string => tokenImages[id] ?? '';
    const keyOf = (id: string): string => {
      const point = positionOf(id);
      return `${urlOf(id)}|${point ? `${point.x},${point.y}` : ''}`;
    };
    const tokens = this.tokens.build(scene.tokens, keyOf, (id, token) => atlasToken(id, token, urlOf(id), positionOf(id)));
    // An entry's avatar is its token's art.
    const avatars = (scene.initiative?.entries ?? []).map((entry) => urlOf(entry.tokenId)).join('|');
    return {
      background: { url: images.background(scene.map.asset), width: scene.map.width, height: scene.map.height },
      grid: this.grid.of([scene.grid, scene.map, scene.measurement], '', () => atlasGrid(scene)),
      objects: {
        tokens,
        fog: this.fog.build(scene.fog, () => '', atlasFog),
        texts: this.texts.build(scene.texts, () => '', atlasText),
        drawings: this.drawings.build(scene.drawings, () => '', atlasDrawing),
      },
      tokenImages,
      widgets: this.widgets.of([scene.widgets], '', () => {
        const { widgetSettings, widgetValues } = atlasWidgets(scene.widgets);
        return { settings: widgetSettings, values: widgetValues };
      }),
      initiative: this.initiative.of([scene.initiative], avatars, () => atlasInitiative(scene.initiative, tokens).initiative),
    };
  }
}
