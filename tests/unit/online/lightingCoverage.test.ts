/**
 * The fork's lighting coverage, as it holds in Connect: Atlas works sight out (`playerVisibility`), so a field
 * marked `lighting` decides what players see only through Atlas's answer. Held to the same answer, flipping
 * one changes nothing Connect sends; a field marked as a look never does. The cases that worked out walls,
 * lights and light zones moved to Atlas with the sight code (A19, `playerLightingOf.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerVisibility, SceneLighting, SceneSnapshot } from '@atlas-vtt/api-types';
import { SCENE_FIELD_COVERAGE, SCENE_LIGHTING_COVERAGE, TOKEN_FIELD_COVERAGE, type CoverageTable } from '../../../src/app/online/coverage';
import { sameSlice, sliceOf } from '../../../src/app/online/scene/sceneSources';
import { character, PENDING, projectLit, ready, scene, UNLIT } from './lightingFixtures';

type Variants<K extends string> = Record<K, (base: SceneSnapshot) => SceneSnapshot>;

const night = (): SceneSnapshot => scene({ ambient: 0 }, { tokens: { hero: character('hero', 140, 400, { vision: { enabled: true } }) } });
const withLighting = (lighting: Partial<SceneLighting>) => (base: SceneSnapshot): SceneSnapshot => ({ ...base, lighting: { ...base.lighting, ...lighting } });
const withHero = (patch: Record<string, unknown>) => (base: SceneSnapshot): SceneSnapshot => ({
  ...base, objects: { ...base.objects, tokens: { hero: { ...base.objects.tokens.hero!, ...patch } as never } },
});

const ANSWERS: Record<string, PlayerVisibility> = {
  ready: ready({ hero: 'seen' }, (x) => x < 400),
  pending: PENDING,
  unlit: UNLIT,
};

/** With Atlas's answer held, no variant changes what players get: every field listed is `lighting` or a look. */
function expectAnswerDecides<K extends string>(table: CoverageTable<K>, variants: Partial<Variants<K>>, keys: readonly K[]): void {
  for (const [name, answer] of Object.entries(ANSWERS)) {
    const before = projectLit(night(), answer);
    for (const key of keys) {
      expect(['lighting', 'gm-only'], `${key} is marked ${table[key].status}`).toContain(table[key].status);
      expect(variants[key], `a variant for ${key}`).toBeDefined();
      expect(projectLit(variants[key]!(night()), answer), `${key} under ${name}`).toEqual(before);
    }
  }
}

describe('coverage of dynamic lighting', () => {
  it('marks how a token sees, the light it carries and the scene\'s lighting as deciding through lighting', () => {
    expect(TOKEN_FIELD_COVERAGE.vision.status).toBe('lighting');
    expect(TOKEN_FIELD_COVERAGE.light.status).toBe('lighting');
    expect(SCENE_FIELD_COVERAGE.lighting.status).toBe('lighting');
  });

  it('lets how a token sees and the light it carries decide only through Atlas\'s answer', () => {
    expectAnswerDecides(TOKEN_FIELD_COVERAGE, {
      vision: withHero({ vision: { enabled: true, angle: 90 } }),
      light: withHero({ light: { bright: 10, dim: 20, color: '#ffcc88', intensity: 1, animation: 'none' } }),
    }, ['vision', 'light']);
  });

  it('lets the scene\'s lighting options decide only through Atlas\'s answer, and never its looks', () => {
    const variants: Variants<keyof SceneLighting> = {
      enabled: withLighting({ enabled: false }),
      ambient: withLighting({ ambient: 1 }),
      ambientColor: withLighting({ ambientColor: '#ff0000' }),
      tokenVision: withLighting({ tokenVision: false }),
      exploredMemory: withLighting({ exploredMemory: false }),
      exploredColor: withLighting({ exploredColor: '#ff0000' }),
      unexploredColor: withLighting({ unexploredColor: '#00ff00' }),
      litThreshold: withLighting({ litThreshold: 0 }),
      sightOnDrop: withLighting({ sightOnDrop: true }),
      brightThreshold: withLighting({ brightThreshold: 0.4 }),
      darkSightLook: withLighting({ darkSightLook: 'grey' } as Partial<SceneLighting>),
      darkSightTint: withLighting({ darkSightTint: '#336699' } as Partial<SceneLighting>),
    };
    expectAnswerDecides(SCENE_LIGHTING_COVERAGE, variants, Object.keys(SCENE_LIGHTING_COVERAGE) as Array<keyof SceneLighting>);
  });

  it('changes what players get when Atlas\'s answer changes', () => {
    const lit = projectLit(night(), ANSWERS.ready!);
    expect(projectLit(night(), ready({ hero: 'seen' }, (x) => x < 600))).not.toEqual(lit);
    expect(projectLit(night(), PENDING)).not.toEqual(lit);
    expect(projectLit(night(), UNLIT)).not.toEqual(lit);
  });

  it('projects again when the scene\'s lighting changes, and only then among its lighting', () => {
    const base = night();
    const changed = (patch: Partial<SceneSnapshot>): boolean => !sameSlice(sliceOf(base), sliceOf({ ...base, ...patch }));
    expect(changed({ lighting: { ...base.lighting, ambient: 1 } })).toBe(true);
    expect(changed({ lighting: base.lighting })).toBe(false);
  });
});
