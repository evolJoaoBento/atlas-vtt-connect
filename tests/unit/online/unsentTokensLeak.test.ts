import { describe, expect, it } from 'vitest';
import type { Character, FogOperation, SceneSnapshot } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { coverageOfFog, createDefaultInitiativeState, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * Atlas 0.7.0: tokens and door icons under fog are hidden from players, with their names; hidden tokens are never sent.
 * Nothing of a token players do not see may reach them under any field: its name, its statblock's name, its art.
 */
const SECRETS = ['Ghost Rider', 'Fog Orc', 'Offmap Lich', 'Hidden Statblock Name'];

const at = (id: string, x: number, name: string, extra: Partial<Character> = {}): Character =>
  ({ id, kind: 'character', x, y: 200, imagePath: `atlas-vtt/assets/${id}.png`, name, resources: { hp: { current: 3, max: 9 } }, ...extra }) as Character;

const fogLeft: FogCoverage = coverageOfFog({
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 500, height: 500 } satisfies FogOperation,
});

function scene(coverage: FogCoverage) {
  const requested: string[] = [];
  const assets = { idFor: (path: string | null | undefined): string | null => { if (!path) return null; requested.push(path); return `asset-${requested.length}`; } };
  const tokens = {
    anna: at('anna', 800, 'Anna'),
    ghost: at('ghost', 800, 'Ghost Rider', { isHidden: true, statblockName: 'Hidden Statblock Name', statblockPath: 'secret.md' }),
    fogged: at('fogged', 200, 'Fog Orc', { statblockName: 'Hidden Statblock Name', statblockPath: 'orc.md' }),
    lich: at('lich', 800, 'Offmap Lich', { offMap: true } as Partial<Character>),
  };
  const entry = (id: string, name: string, order: number) =>
    ({ id: `e-${id}`, tokenId: id, name, initiative: 10 - order, initiativeModifier: 0, hp: { current: 3, max: 9 }, imagePath: `atlas-vtt/assets/${id}.png`, isActive: false, isDefeated: false, isNPC: false, order });
  const base: SceneSnapshot = snapshotOf({
    background: 'atlas-vtt/assets/lair.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1 },
  });
  const state = {
    ...base,
    objects: { ...base.objects, tokens },
    initiative: { ...createDefaultInitiativeState(), entries: [entry('anna', 'Anna', 0), entry('ghost', 'Ghost Rider', 1), entry('fogged', 'Fog Orc', 2)] },
    initiativeTrackerOpen: true,
  };
  const context: ProjectionContext = {
    sceneId: 'scene-1', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
    coverage, assets, mapSize: { width: 1000, height: 800 },
  };
  return { projected: projectForPlayers(state, context), requested };
}

describe('what players are never sent of a token they cannot see', () => {
  it('sends only the visible token, and none of the others appears anywhere in the scene', () => {
    const { projected } = scene(fogLeft);
    expect(Object.keys(projected.tokens)).toEqual(['anna']);
    expect(isPlayerSceneBody(projected)).toBe(true);
    const json = JSON.stringify(projected);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain('secret.md');
    expect(json).not.toContain('orc.md');
    expect(projected.initiative?.entries.map((entry) => entry.tokenId)).toEqual(['anna']);
  });

  it("never so much as registers the art of a token players cannot see", () => {
    const { requested } = scene(fogLeft);
    expect(requested).toContain('atlas-vtt/assets/anna.png');
    for (const hidden of ['ghost', 'fogged', 'lich']) expect(requested.some((path) => path.includes(hidden))).toBe(false);
  });

  it('shows the fogged token again when the fog is gone, so the test above is the fog, not the fixture', () => {
    const { projected } = scene(FogCoverage.EMPTY);
    expect(Object.keys(projected.tokens).sort()).toEqual(['anna', 'fogged']);
    expect(JSON.stringify(projected)).toContain('Fog Orc');
    // Hidden and off-map ones stay out whatever the fog does.
    expect(JSON.stringify(projected)).not.toContain('Ghost Rider');
    expect(JSON.stringify(projected)).not.toContain('Offmap Lich');
  });
});
