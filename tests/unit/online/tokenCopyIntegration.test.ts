import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlWorld, type ControlWorld } from './controlFixtures';
import { HUB_PATHS, onHubPath } from './hubPath';

describe.each(HUB_PATHS)('token copy round trip, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('broadcasts the host copy to both players and grants movement only to the copier', async () => {
    let w: ControlWorld;
    w = controlWorld({ duplicate: (_viewId, tokenId) => {
      const source = w.token(tokenId);
      if (!source) return null;
      w.store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, copiedHero: { ...structuredClone(source), id: 'copiedHero' } } } }));
      return 'copiedHero';
    } });
    try {
      w.present();
      const a = await w.join('A');
      const b = await w.join('B');
      w.control.set('hero', a.playerId, true);
      expect(a.session.sendTokenCopy('hero')).toBe(true);
      await w.tick();
      expect(a.session.scene?.tokens.copiedHero).toMatchObject({ x: 140, y: 140 });
      expect(b.session.scene?.tokens.copiedHero).toMatchObject({ x: 140, y: 140 });
      expect(a.controlLists().at(-1)).toContain('copiedHero');
      expect(b.controlLists().at(-1) ?? []).not.toContain('copiedHero');
      b.move('copiedHero', 300, 150);
      expect(b.refusals()).toContain('copiedHero');
      expect(w.token('copiedHero')).toMatchObject({ x: 140, y: 140 });
      a.move('copiedHero', 300, 150);
      expect(w.token('copiedHero')).toMatchObject({ x: 315, y: 175 });
      expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    } finally { w.finish(); }
  });
});
