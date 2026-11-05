import { describe, expect, it, vi } from 'vitest';
import { TokenCopyHandler, type TokenCopyHandlerOptions } from '../../../src/app/online/control/TokenCopyHandler';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';

function setup() {
  const control = new TokenControl();
  control.set('hero', 'a', true);
  const duplicate = vi.fn(() => 'copy');
  const send = vi.fn();
  const snapshot = { viewId: 'view', objects: { tokens: { hero: { isHidden: false } } } };
  const projection = {
    slotOf: () => ({ sceneId: 'scene', tab: { viewId: 'view' }, lastSent: { sceneId: 'scene', tokens: { hero: {} }, initiative: null } }),
    shownSnapshot: vi.fn(() => snapshot),
  };
  const handler = new TokenCopyHandler({ control, projection, session: { send }, tokens: { duplicate } } as unknown as TokenCopyHandlerOptions);
  const message = { v: 1, type: 'token-copy', sceneId: 'scene', tokenId: 'hero' } as ControlMessage;
  const copy = () => handler.onMessage({ playerId: 'a' } as SessionPlayer, message);
  return { control, duplicate, send, snapshot, projection, handler, message, copy };
}

describe('player token copies', () => {
  it('accepts the bounded protocol request without client token attributes', () => {
    expect(decodeControl(encodeControl({ v: 1, type: 'token-copy', sceneId: 'scene', tokenId: 'hero' }))).toMatchObject({ kind: 'message', message: { type: 'token-copy' } });
  });
  it('copies through Atlas and assigns only the sender to the new token', () => {
    const t = setup(); t.copy();
    expect(t.duplicate).toHaveBeenCalledWith('view', 'hero');
    expect(t.control.controls('a', 'copy')).toBe(true);
    expect(t.control.controls('b', 'copy')).toBe(false);
  });
  it('refuses another player token, stale scenes, hidden tokens, and paused/loading scenes', () => {
    for (const change of [
      (t: ReturnType<typeof setup>) => t.control.set('hero', 'a', false),
      (t: ReturnType<typeof setup>) => Object.assign(t.message, { sceneId: 'other' }),
      (t: ReturnType<typeof setup>) => { t.snapshot.objects.tokens.hero.isHidden = true; },
      (t: ReturnType<typeof setup>) => t.projection.shownSnapshot.mockReturnValue(null as never),
    ]) {
      const t = setup(); change(t); t.copy();
      expect(t.duplicate).not.toHaveBeenCalled();
    }
  });
  it('limits copies and retains control limits', () => {
    const t = setup();
    for (let i = 0; i < 10; i++) t.copy();
    expect(t.duplicate.mock.calls.length).toBeLessThanOrEqual(2);
    const full = setup();
    for (let i = 0; i < 255; i++) full.control.set(`token-${i}`, 'a', true);
    full.copy();
    expect(full.duplicate).not.toHaveBeenCalled();
  });
});
