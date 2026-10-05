/**
 * Every field the coverage tables mark `sent` or `used` comes back out of the remote view's converter: the GM's
 * snapshot → the GM's real projection → `toRemoteScene`. A field added to a table as `sent` without a check here
 * fails. And every token field that is not sent is absent from what the remote view gets: new data is private by
 * default (spec §5), so a `TokenEntity` field must be decided before it can reach the view.
 */
import { describe, expect, it } from 'vitest';
import type { CollectionGridDefaults, DrawingStroke, FogOperation, GridState, ResourceDefinition, SceneSnapshot, TextElement, TokenEntity } from '@atlas-vtt/api-types';
import {
  DRAWING_FIELD_COVERAGE, FOG_FIELD_COVERAGE, GRID_FIELD_COVERAGE, INITIATIVE_COVERAGE, INITIATIVE_ENTRY_COVERAGE, INITIATIVE_RULES_COVERAGE,
  MEASUREMENT_FIELD_COVERAGE, OBJECT_COVERAGE, RESOURCE_DEFINITION_COVERAGE, SCENE_FIELD_COVERAGE, TEXT_FIELD_COVERAGE, TOKEN_FIELD_COVERAGE,
  type Coverage, type CoverageTable, type KeysOfUnion,
} from '../coverage';
import { IMAGES, line, sign, TRIPS, type Trip, type Trips } from './convertCoverageTrips';

type Check = (trips: Trips) => void;
type Checks<K extends PropertyKey> = { readonly [P in K]?: Check };


const tokenOf = (t: Trip, id: string): Record<string, unknown> => t.input.objects.tokens[id] as unknown as Record<string, unknown>;
const field = (id: string, key: string, value: unknown): Check => (t) => expect(tokenOf(t.full, id)[key]).toEqual(value);
const allTokens = (): Array<Record<string, unknown>> => Object.values(TRIPS).flatMap((t) => Object.values(t.input.objects.tokens) as unknown as Array<Record<string, unknown>>);

const TOKEN_CHECKS: Checks<KeysOfUnion<TokenEntity>> = {
  id: (t) => expect(Object.keys(t.full.input.objects.tokens).sort()).toEqual(['crate', 'fallen', 'ghoul', 'goblin', 'hero', 'imp']),
  kind: (t) => {
    expect(tokenOf(t.full, 'hero').kind).toBe('character');
    expect(tokenOf(t.full, 'crate').kind).toBe('token');
  },
  x: field('hero', 'x', 140),
  y: field('hero', 'y', 210),
  imagePath: (t) => {
    expect(t.full.input.tokenImages.hero).toBe(IMAGES.token(t.full.sent.tokens.hero?.image ?? null));
    expect(tokenOf(t.full, 'hero').imagePath).toBe(t.full.input.tokenImages.hero);
  },
  size: field('hero', 'size', 2),
  rotation: field('hero', 'rotation', 45),
  layer: field('hero', 'layer', 3),
  showRing: (t) => {
    expect(tokenOf(t.full, 'hero').showRing).toBe(true);
    expect(tokenOf(t.full, 'crate').showRing).toBe(false);
  },
  ringColor: field('hero', 'ringColor', '#3366ff'),
  conditions: field('hero', 'conditions', ['prone', 'frightened']),
  conditionValues: field('hero', 'conditionValues', { frightened: 2 }),
  isHidden: (t) => {
    expect(t.full.input.objects.tokens).not.toHaveProperty('spy');
    for (const token of Object.values(t.full.input.objects.tokens)) expect(token).not.toHaveProperty('isHidden');
  },
  name: field('hero', 'name', 'Anna'),
  statblockPath: (t) => {
    expect(tokenOf(t.full, 'imp').name).toBe('Unknown Creature');
    for (const token of Object.values(t.full.input.objects.tokens)) expect(token).not.toHaveProperty('statblockPath');
  },
  statblockName: field('goblin', 'name', 'Goblin'),
  side: (t) => {
    expect(tokenOf(t.full, 'hero')).not.toHaveProperty('side');
    expect(tokenOf(t.sidesFight, 'hero').side).toBe('players');
    expect(tokenOf(t.sidesFight, 'goblin')).not.toHaveProperty('side');
  },
  resources: (t) => {
    expect(tokenOf(t.full, 'hero').resources).toEqual({ bar0: { current: 70, max: 100 }, bar1: { current: 33, max: 100 }, downed: { current: 1, max: 1 } });
    expect(t.full.player.tokenUi.resources.hero).toEqual([
      expect.objectContaining({ key: 'bar0', color: '#22c55e', direction: 'drains', slot: 0, visibleToPlayers: true }),
      expect.objectContaining({ key: 'bar1', color: '#a855f7', slot: 1, visibleToPlayers: true }),
      expect.objectContaining({ key: 'downed', defeatedWhenSpent: true }),
    ]);
    expect(tokenOf(t.full, 'crate')).not.toHaveProperty('resources');
    expect(tokenOf(t.full, 'fallen').resources).toEqual({ bar0: { current: 0, max: 100 }, downed: { current: 0, max: 1 } });
    expect(t.full.player.tokenUi.resources.fallen?.[0]).toMatchObject({ key: 'bar0', defeatedWhenSpent: true, direction: 'drains' });
    expect(t.full.player.tokenUi.resources.ghoul).toEqual([expect.objectContaining({ key: 'downed', visibleToPlayers: false, defeatedWhenSpent: true })]);
    expect(tokenOf(t.full, 'ghoul').resources).toEqual({ downed: { current: 0, max: 1 } });
  },
};

const RESOURCE_CHECKS: Checks<keyof ResourceDefinition> = {
  key: (t) => {
    expect(Object.keys(tokenOf(t.renamedHp, 'hero').resources as object)).toEqual(['bar0', 'downed']);
    expect(t.renamedHp.player.initiative.health).toEqual({});
  },
  direction: (t) => expect(tokenOf(t.staticHp, 'hero').resources).toMatchObject({ bar0: { current: 100, max: 100 } }),
  color: (t) => expect(t.full.player.tokenUi.resources.hero?.slice(0, 2).map((definition) => definition.color)).toEqual(['#22c55e', '#a855f7']),
  defeatedWhenSpent: (t) => {
    expect(t.full.player.tokenUi.resources.fallen?.[0]?.color).toBe('#ef4444');
    expect(t.full.player.tokenUi.resources.hero?.[0]).not.toHaveProperty('defeatedWhenSpent');
  },
  visibleToPlayers: (t) => expect(Object.keys(tokenOf(t.full, 'hero').resources as object)).not.toContain('bar3'),
  slot: (t) => expect(Object.keys(tokenOf(t.full, 'hero').resources as object)).toEqual(['bar0', 'bar1', 'downed']),
};

const TEXT_SAME = [
  'id', 'x', 'y', 'text', 'fontSize', 'fontFamily', 'color', 'backgroundColor', 'padding', 'borderRadius', 'opacity',
  'width', 'height', 'align', 'bold', 'italic', 'rotation', 'scale',
] as const satisfies ReadonlyArray<keyof TextElement>;
const TEXT_CHECKS: Checks<keyof TextElement> = Object.fromEntries(TEXT_SAME.map((key) => [
  key, ((t) => expect(t.full.input.objects.texts.sign?.[key]).toEqual(sign[key])) satisfies Check,
]));

const DRAWING_CHECKS: Checks<keyof DrawingStroke> = {
  id: (t) => expect(Object.keys(t.full.input.objects.drawings).sort()).toEqual(['line', 'stamp']),
  timestamp: (t) => expect(t.full.input.objects.drawings.line?.timestamp).toBe(5),
  type: (t) => expect(t.full.input.objects.drawings.stamp?.type).toBe('icon'),
  points: (t) => expect(t.full.input.objects.drawings.line?.points).toEqual(line.points),
  color: (t) => expect(t.full.input.objects.drawings.line?.color).toBe('#ff0000'),
  width: (t) => expect(t.full.input.objects.drawings.line?.width).toBe(4),
  opacity: (t) => expect(t.full.input.objects.drawings.line?.opacity).toBe(0.8),
  icon: (t) => {
    expect(t.full.input.objects.drawings.stamp?.icon).toBe('skull');
    expect(t.full.input.objects.drawings.line).not.toHaveProperty('icon');
  },
};

const fogOf = (t: Trip, id: string): FogOperation | undefined => t.input.objects.fog[id];
const FOG_CHECKS: Checks<KeysOfUnion<FogOperation>> = {
  id: (t) => expect(Object.keys(t.full.input.objects.fog).sort()).toEqual(['brush', 'lasso', 'rect']),
  timestamp: (t) => expect(fogOf(t.full, 'lasso')?.timestamp).toBe(2),
  type: (t) => expect(fogOf(t.full, 'rect')?.type).toBe('rectangle'),
  isErasing: (t) => {
    expect(fogOf(t.full, 'brush')?.isErasing).toBe(true);
    expect(fogOf(t.full, 'rect')?.isErasing).toBe(false);
  },
  // The GM applies the drag offset before sending, so the points moved and no offset is left.
  offsetX: (t) => {
    expect(fogOf(t.full, 'brush')).toMatchObject({ points: [{ x: 110, y: 120 }, { x: 210, y: 170 }, { x: 130, y: 280 }] });
    expect(fogOf(t.full, 'brush')).not.toHaveProperty('offsetX');
  },
  offsetY: (t) => expect(fogOf(t.full, 'brush')).not.toHaveProperty('offsetY'),
  points: (t) => expect(fogOf(t.full, 'lasso')).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }] }),
  brushRadius: (t) => expect(fogOf(t.full, 'brush')).toMatchObject({ brushRadius: 30 }),
  x: (t) => expect(fogOf(t.full, 'rect')).toMatchObject({ x: 2000 }),
  y: (t) => expect(fogOf(t.full, 'rect')).toMatchObject({ y: 2000 }),
  width: (t) => expect(fogOf(t.full, 'rect')).toMatchObject({ width: 100 }),
  height: (t) => expect(fogOf(t.full, 'rect')).toMatchObject({ height: 50 }),
};

const gridOf = (t: Trip): GridState | null => t.input.grid;
const GRID_CHECKS: Checks<keyof GridState> = {
  enabled: (t) => {
    expect(gridOf(t.full)?.visible).toBe(true);
    expect(gridOf(t.disabledGrid)?.visible).toBe(false);
  },
  visible: (t) => expect(gridOf(t.hiddenGrid)?.visible).toBe(false),
  type: (t) => expect(gridOf(t.full)?.type).toBe('hex-vertical'),
  size: (t) => expect(gridOf(t.full)?.size).toBe(70),
  offsetX: (t) => expect(gridOf(t.full)?.offsetX).toBe(5),
  offsetY: (t) => expect(gridOf(t.full)?.offsetY).toBe(7),
  color: (t) => expect(gridOf(t.full)?.color).toBe('#222222'),
  opacity: (t) => expect(gridOf(t.full)?.opacity).toBe(0.4),
  lineType: (t) => expect(gridOf(t.full)?.lineType).toBe('dashed'),
  lineWidth: (t) => expect(gridOf(t.full)?.lineWidth).toBe(2),
  cellNumbers: (t) => expect(gridOf(t.full)?.cellNumbers).toBe('letter-number'),
  cellNumberOpacity: (t) => expect(gridOf(t.full)?.cellNumberOpacity).toBe(0.6),
  snapToGrid: (t) => expect(gridOf(t.full)?.snapToGrid).toBe(false),
  // Without a collection, the map's grid decides the measurement.
  unitType: (t) => {
    expect(t.noCollection.player.measurement.unitType).toBe('meters');
    expect(gridOf(t.noCollection)?.unitType).toBe('meters');
  },
  unitDistance: (t) => expect(t.noCollection.player.measurement.unitDistance).toBe(1.5),
  measurementType: (t) => expect(t.noCollection.player.measurement.mode).toBe('metric'),
  // The scene's distance per cell for the ruler; the collection's stays the rules square.
  unitDistanceOverride: (t) => {
    expect(t.ownDistance.player.measurement).toMatchObject({ unitDistance: 3, ruleDistance: 2 });
    expect(gridOf(t.ownDistance)?.unitDistance).toBe(3);
  },
};

const MEASUREMENT_CHECKS: Checks<keyof CollectionGridDefaults> = {
  unitType: (t) => expect(t.full.player.measurement.unitType).toBe('yards'),
  unitDistance: (t) => expect(t.full.player.measurement.unitDistance).toBe(2),
  measurementMode: (t) => expect(t.full.player.measurement.mode).toBe('abstract'),
  abstractRangeBands: (t) => expect(t.full.player.measurement.rangeBands).toEqual([{ name: 'Close', maxSquares: 2 }]),
  diagonalRule: (t) => expect(t.full.player.measurement.diagonalRule).toBe('alternating'),
  coneAngle: (t) => expect(t.full.player.measurement.coneAngle).toBe(53.13),
};

const SCENE_CHECKS: Checks<keyof SceneSnapshot> = {
  background: (t) => {
    expect(t.full.input.background.url).toBe(IMAGES.background(t.full.sent.map.asset));
    expect(t.full.input.background.url).not.toBeNull();
  },
  mapSize: (t) => expect(t.full.input.background).toMatchObject({ width: 1000, height: 800 }),
  grid: (t) => expect(gridOf(t.full)).toMatchObject({ enabled: true, visible: true }),
  objects: (t) => expect(Object.keys(t.full.input.objects.tokens)).toHaveLength(6),
  widgets: (t) => {
    expect(Object.keys(t.full.input.widgets.settings.widgets)).toEqual(['torches', 'doom', 'fuse']);
    expect(t.full.input.widgets.settings.widgets.fuse).toMatchObject({ type: 'timer', value: 90 });
    expect(t.full.input.widgets.values).toEqual({ torches: 3, doom: 2 });
  },
  initiative: (t) => {
    expect(t.full.input.initiative).toMatchObject({ round: 2, isActive: true });
    expect(t.full.input.initiative.entries).toMatchObject([{ tokenId: 'hero', initiative: 17, name: 'Anna', isActive: true, imagePath: tokenOf(t.full, 'hero').imagePath }]);
    // The bar after the name is the token's hp resource, at its share
    expect(t.full.player.initiative.health).toEqual({ hero: { value: 70, max: 100 } });
  },
  // Atlas shows the list whenever it has entries (`RemoteSceneInput.initiative`).
  initiativeTrackerOpen: (t) => {
    expect(t.full.input.initiative.entries).toHaveLength(1);
    expect(t.closedTracker.input.initiative.entries).toEqual([]);
  },
};

const OBJECT_CHECKS: Checks<keyof typeof OBJECT_COVERAGE> = {
  tokens: (t) => expect(Object.keys(t.full.input.objects.tokens).length).toBeGreaterThan(0),
  fog: (t) => expect(Object.keys(t.full.input.objects.fog).length).toBeGreaterThan(0),
  texts: (t) => expect(Object.keys(t.full.input.objects.texts).length).toBeGreaterThan(0),
  drawings: (t) => expect(Object.keys(t.full.input.objects.drawings).length).toBeGreaterThan(0),
};

const INITIATIVE_CHECKS: Checks<keyof typeof INITIATIVE_COVERAGE> = {
  entries: (t) => expect(t.full.input.initiative.entries.map((entry) => entry.tokenId)).toEqual(['hero']),
  round: (t) => expect(t.full.input.initiative.round).toBe(2),
  isActive: (t) => expect(t.full.input.initiative.isActive).toBe(true),
  sides: (t) => {
    expect(t.sidesFight.input.initiative.sides).toEqual({ first: 'opponents', active: 'players' });
    expect(t.full.input.initiative).not.toHaveProperty('sides');
  },
};

const ENTRY_CHECKS: Checks<keyof typeof INITIATIVE_ENTRY_COVERAGE> = {
  id: (t) => expect(t.full.input.initiative.entries[0]?.id).toBe('e1'),
  tokenId: (t) => expect(t.full.input.initiative.entries[0]?.tokenId).toBe('hero'),
  name: (t) => expect(t.full.input.initiative.entries[0]?.name).toBe('Anna'),
  initiative: (t) => expect(t.full.input.initiative.entries[0]?.initiative).toBe(17),
  isActive: (t) => expect(t.full.input.initiative.entries[0]?.isActive).toBe(true),
  order: (t) => expect(t.full.input.initiative.entries[0]?.order).toBe(0),
  sitsOut: (t) => {
    expect(t.sitsOut.input.initiative.entries[0]?.sitsOut).toBe(true);
    expect(t.full.input.initiative.entries[0]).not.toHaveProperty('sitsOut');
  },
};

// The roll is never sent: the remote view's list reads Atlas's default roll.
const RULES_CHECKS: Checks<keyof typeof INITIATIVE_RULES_COVERAGE> = {
  mode: (t) => {
    expect(t.sidesBefore.player.initiative.rules?.mode).toBe('sides');
    expect(t.full.player.initiative.rules?.mode).toBe('turn-order');
  },
  firstSide: (t) => expect(t.sidesBefore.player.initiative.rules?.firstSide).toBe('opponents'),
};

function everySentField<K extends PropertyKey>(name: string, table: CoverageTable<K>, checks: Checks<K>): void {
  for (const [key, coverage] of Object.entries(table) as Array<[K, Coverage]>) {
    if (coverage.status !== 'sent' && coverage.status !== 'used') continue;
    const check = checks[key];
    expect(check, `${name}.${String(key)} is sent but has no round trip check`).toBeDefined();
    check?.(TRIPS);
  }
}

describe('the remote view converter covers every sent field', () => {
  it('object kinds', () => everySentField('OBJECT_COVERAGE', OBJECT_COVERAGE, OBJECT_CHECKS));
  it('token fields', () => everySentField('TOKEN_FIELD_COVERAGE', TOKEN_FIELD_COVERAGE, TOKEN_CHECKS));
  it('text fields', () => everySentField('TEXT_FIELD_COVERAGE', TEXT_FIELD_COVERAGE, TEXT_CHECKS));
  it('drawing fields', () => everySentField('DRAWING_FIELD_COVERAGE', DRAWING_FIELD_COVERAGE, DRAWING_CHECKS));
  it('fog fields', () => everySentField('FOG_FIELD_COVERAGE', FOG_FIELD_COVERAGE, FOG_CHECKS));
  it('grid fields', () => everySentField('GRID_FIELD_COVERAGE', GRID_FIELD_COVERAGE, GRID_CHECKS));
  it('resource definition fields', () => everySentField('RESOURCE_DEFINITION_COVERAGE', RESOURCE_DEFINITION_COVERAGE, RESOURCE_CHECKS));
  it('measurement fields', () => everySentField('MEASUREMENT_FIELD_COVERAGE', MEASUREMENT_FIELD_COVERAGE, MEASUREMENT_CHECKS));
  it('scene fields', () => everySentField('SCENE_FIELD_COVERAGE', SCENE_FIELD_COVERAGE, SCENE_CHECKS));
  it('initiative fields', () => everySentField('INITIATIVE_COVERAGE', INITIATIVE_COVERAGE, INITIATIVE_CHECKS));
  it('initiative entry fields', () => everySentField('INITIATIVE_ENTRY_COVERAGE', INITIATIVE_ENTRY_COVERAGE, ENTRY_CHECKS));
  it('initiative rules fields', () => everySentField('INITIATIVE_RULES_COVERAGE', INITIATIVE_RULES_COVERAGE, RULES_CHECKS));

  it('keeps every token field that is not sent out of the remote view: private by default', () => {
    const notSent = (Object.entries(TOKEN_FIELD_COVERAGE) as Array<[string, Coverage]>).filter(([, coverage]) => coverage.status !== 'sent' && coverage.status !== 'used');
    expect(notSent.map(([key]) => key)).toEqual(expect.arrayContaining(['notePath', 'tags', 'difficulty', 'playerId', 'vision', 'light', 'overriddenMax']));
    for (const [key] of notSent) {
      // A name plate shows for a sent name only; the GM's own setting never travels.
      if (key === 'showNameplate') {
        expect(tokenOf(TRIPS.full, 'hero').showNameplate).toBe(true);
        expect(tokenOf(TRIPS.full, 'imp').showNameplate).toBe(true);
        expect(tokenOf(TRIPS.full, 'crate')).not.toHaveProperty('showNameplate');
        continue;
      }
      for (const token of allTokens()) expect(token, `${key} is not sent but reached the remote view`).not.toHaveProperty(key);
    }
    // A remote token never names another vault's notes (`RemoteSceneInput.tokenImages`).
    for (const token of allTokens()) {
      expect(token).not.toHaveProperty('notePath');
      expect(token).not.toHaveProperty('statblockPath');
    }
  });
});
