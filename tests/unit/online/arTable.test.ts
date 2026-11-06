import { describe, expect, it, vi } from 'vitest';
import { MarkerLayout } from '../../../online-client/ar/markerLayout.mts';
import { FIRST_CARD, groupOutline, markerGroup } from '../../../online-client/ar/markerSheet.mts';
import { intrinsicsFor, project, sheetPose, type Point } from '../../../online-client/ar/sheetPose.mts';
import type { Detected } from '../../../online-client/ar/sheetTracker.mts';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { boardParts } from '../../../src/app/online/scene/BoardSender';
import { isBoardExtras } from '../../../src/app/online/scene/boardValidation';
import type { BoardExtras } from '../../../src/app/online/scene/boardTypes';
import { ArViewRelay } from '../../../src/app/online/tools/ArViewRelay';
import { AR_TABLE_LIMITS, isArTable, type ArTable } from '../../../src/app/online/tools/arTable';

const camera = intrinsicsFor(640, 480, 65);
const tilt = (a: number): number[] => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];

/** The GM's table: three cards, in millimetres from the map's top left. */
const TABLE: ArTable = {
  squareMm: 25,
  groups: [
    { group: `card-${FIRST_CARD}`, x: 500, y: 300, heading: 0.3, w: 70, h: 68 },
    { group: `card-${FIRST_CARD + 1}`, x: 700, y: 320, heading: -0.2, w: 70, h: 68 },
    { group: `card-${FIRST_CARD + 2}`, x: 600, y: 520, heading: 1.2, w: 70, h: 68 },
  ],
};

function cornersOn(table: ArTable, id: number, shift = { x: 0, y: 0 }): Point[] {
  const place = table.groups.find((group) => group.group === markerGroup(id)!.group)!;
  const c = Math.cos(place.heading);
  const s = Math.sin(place.heading);
  return markerGroup(id)!.corners.map((p) => ({ x: place.x + shift.x + c * p.x - s * p.y, y: place.y + shift.y + s * p.x + c * p.y }));
}

/** A camera straight over the map point (x, y), `height` mm up, looking down (its picture's up the map's up). */
function over(x: number, y: number, height: number): { rotation: number[]; translation: number[] } {
  // Camera x = map x, camera y = map y, camera z = into the table: translation = −R·eye with eye (x, y, −height).
  return { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [-x, -y, height] };
}

function picture(pose: { rotation: number[]; translation: number[] }, ids: number[], shifts: Record<number, { x: number; y: number }> = {}): Detected[] {
  return ids.map((id) => {
    const seen = cornersOn(TABLE, id, shifts[id]).map((point) => project(pose, camera, point)!);
    return { id, seen, pose: sheetPose(markerGroup(id)!.corners, seen, camera) };
  });
}

const eyeOf = (pose: { rotation: number[]; translation: number[] }): number[] =>
  [0, 1, 2].map((k) => -(pose.rotation[k]! * pose.translation[0]! + pose.rotation[3 + k]! * pose.translation[1]! + pose.rotation[6 + k]! * pose.translation[2]!));

describe('a table the GM placed', () => {
  it('places the camera on the map from the first picture of any of its sheets', () => {
    const layout = new MarkerLayout();
    layout.fix(TABLE.groups);
    expect(layout.isFixed).toBe(true);
    // Only the third card in sight: nothing learnt, and still the camera is where it is over the map.
    const tracked = layout.observe(picture(over(610, 500, 400), [FIRST_CARD + 2]), camera, 640);
    expect(tracked).not.toBeNull();
    const eye = eyeOf(tracked!.pose);
    expect(eye[0]).toBeCloseTo(610, 0);
    expect(eye[1]).toBeCloseTo(500, 0);
    expect(eye[2]).toBeCloseTo(-400, 0);
  });

  it('keeps its sheets where the GM put them, and says when one seems moved', () => {
    const layout = new MarkerLayout();
    layout.fix(TABLE.groups);
    const moved = { [FIRST_CARD + 1]: { x: 40, y: 0 } };
    const all = [FIRST_CARD, FIRST_CARD + 1, FIRST_CARD + 2];
    // Two in sight say nothing: either could be the one moved.
    for (let i = 0; i < 12; i++) layout.observe(picture(over(600, 320, 450), [FIRST_CARD, FIRST_CARD + 1], moved), camera, 640);
    expect(layout.moved).toEqual([]);
    for (let i = 0; i < 12; i++) layout.observe(picture({ ...over(600, 400, 700), rotation: tilt(0.001 * i) }, all, moved), camera, 640);
    expect(layout.moved).toEqual([`card-${FIRST_CARD + 1}`]);
    // Its place is still the GM's.
    expect(layout.survey().find((group) => group.group === `card-${FIRST_CARD + 1}`)!.x).toBe(700);
    // Put back: no longer said.
    for (let i = 0; i < 2; i++) layout.observe(picture(over(600, 400, 700), all), camera, 640);
    expect(layout.moved).toEqual([]);
  });

  it('forgets it with null, and learns again from the first sheet seen', () => {
    const layout = new MarkerLayout();
    layout.fix(TABLE.groups);
    layout.fix(null);
    expect(layout.isFixed).toBe(false);
    expect(layout.size).toBe(0);
  });
});

describe('a survey', () => {
  it('gives the sheets placed and trusted, with their outlines', () => {
    const layout = new MarkerLayout();
    layout.fix(TABLE.groups);
    const groups = layout.survey().map((place) => ({ ...place, ...groupOutline(place.group) }));
    expect(isArTable({ squareMm: 25, groups })).toBe(true);
    expect(groupOutline('mat-0')).toEqual({ w: 210, h: 297 });
  });

  it('is checked on the wire', () => {
    expect(PLAYER_MESSAGE_TYPES.has('ar-survey')).toBe(true);
    const message: ControlMessage = { v: 1, type: 'ar-survey', sceneId: 's1', survey: TABLE };
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    for (const bad of [
      { ...TABLE, groups: [] },
      { ...TABLE, groups: [{ ...TABLE.groups[0]!, group: 'mat' }] },
      { ...TABLE, groups: [TABLE.groups[0]!, TABLE.groups[0]!] },
      { ...TABLE, groups: [{ ...TABLE.groups[0]!, x: 1e6 }] },
      { ...TABLE, squareMm: 0 },
      { ...TABLE, groups: Array.from({ length: AR_TABLE_LIMITS.groups + 1 }, (_, i) => ({ ...TABLE.groups[0]!, group: `card-${i + 10}` })) },
    ]) {
      expect(decodeControl(JSON.stringify({ ...message, survey: bad })).kind).toBe('invalid');
    }
  });

  it('goes to the GM\'s board for the sender\'s map, a few a minute at most', () => {
    let handler: SessionHandler | null = null;
    const survey = vi.fn();
    const ana: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
    new ArViewRelay({
      session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: () => undefined, getPlayers: () => [ana] } as never,
      projection: { slotOf: () => ({ sceneId: 's1', mapPath: 'Maps/a.md', lastSent: {} }) } as never,
      board: { viewer: vi.fn(), survey },
    }).start();
    const send = (sceneId = 's1'): void => handler!.onMessage?.(ana, { v: 1, type: 'ar-survey', sceneId, survey: TABLE });
    send('other');
    expect(survey).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) send();
    expect(survey).toHaveBeenCalledTimes(AR_TABLE_LIMITS.surveysPerMinute);
    expect(survey).toHaveBeenCalledWith('Maps/a.md', 'p1', 'Ana', TABLE);
  });
});

describe('the placed table in the board extras', () => {
  const extras: BoardExtras = {
    sceneId: 's1', walls: [], lights: [], props: [], materials: [], ambient: null,
    lighting: { enabled: false, ambient: 0.1, ambientColor: null }, fogHeight: null, wallThickness: null, arTable: TABLE,
  };

  it('is checked, and an older page reading extras without it is fine', () => {
    expect(isBoardExtras(extras)).toBe(true);
    expect(isBoardExtras({ ...extras, arTable: { ...TABLE, squareMm: -1 } })).toBe(false);
    const { arTable: _arTable, ...without } = extras;
    expect(isBoardExtras(without)).toBe(true);
  });

  it('rides on the first part only', () => {
    const many = { ...extras, walls: Array.from({ length: 4000 }, (_, i) => ({ id: `w${i}`, type: 'solid' as const, p1: { x: 0, y: 0 }, p2: { x: 1, y: i }, closed: false, height: null, material: null, doorProp: null })) } as unknown as BoardExtras;
    const parts = boardParts(many);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.arTable).toEqual(TABLE);
    expect(parts.slice(1).every((part) => part.arTable === undefined)).toBe(true);
  });
});
