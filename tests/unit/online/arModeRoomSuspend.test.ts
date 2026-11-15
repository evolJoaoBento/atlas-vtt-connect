/** Room AR through a cutscene: the session stops, AR stays on, and Back to AR starts a new session with the board to be put down again. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArMode, type ArBoard } from '../../../online-client/ar/arMode.mts';

function fakeSession() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    domOverlayState: { type: 'screen' },
    end: vi.fn(async () => { for (const listener of listeners.get('end') ?? []) listener(); }),
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    requestReferenceSpace: async () => ({}),
    requestHitTestSource: async () => ({ cancel: vi.fn() }),
    fire: (type: string) => { for (const listener of listeners.get(type) ?? []) listener(); },
  };
}

function setup(startRoomAr: ArBoard['startRoomAr'] = async () => true) {
  const board = { setAugmented: vi.fn(() => true), roomAr: true, startRoomAr: vi.fn(startRoomAr), placeRoomAr: vi.fn(), stopRoomAr: vi.fn() };
  const first = fakeSession();
  const video = document.createElement('video');
  const boardEl = document.createElement('div');
  const panel = document.createElement('div');
  const overlay = document.createElement('div');
  const parent = document.createElement('div');
  parent.append(panel);
  document.body.append(video, boardEl, parent, overlay);
  const onEnd = vi.fn();
  const onRoomSuspended = vi.fn();
  const ar = new ArMode({
    stream: null, session: Promise.resolve(first), video, boardEl, panel, overlay, board: () => board as unknown as ArBoard, tokens: () => [], onEnd, onRoomSuspended,
  });
  return { ar, board, first, onEnd, onRoomSuspended };
}

describe('ArMode and a cutscene', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it('suspends room tracking without ending AR, and resumes in a new session with the board to be put down again', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.ar.roomActive).toBe(true));
    // The player put the board down.
    (t.ar as unknown as { placed: boolean; preview: unknown }).placed = true;
    (t.ar as unknown as { placed: boolean; preview: unknown }).preview = { position: [1, 0, 1], yaw: 0.5 };
    t.ar.suspendRoom();
    expect(t.board.stopRoomAr).toHaveBeenCalledOnce();
    expect(t.first.end).toHaveBeenCalledOnce();
    // The session's end event does not end AR.
    expect(t.onEnd).not.toHaveBeenCalled();
    expect(t.ar.active).toBe(true);
    expect(t.ar.roomActive).toBe(false);
    expect(t.ar.roomSuspended).toBe(true);
    expect(localStorage.length).toBe(0);

    const second = fakeSession();
    t.ar.resumeRoom(Promise.resolve(second));
    await vi.waitFor(() => expect(t.ar.roomActive).toBe(true));
    expect(t.board.startRoomAr).toHaveBeenCalledTimes(2);
    expect(t.board.startRoomAr.mock.calls[1]![0]).toBe(second);
    // The old session's place means nothing in the new one: not placed, no old position given to the board.
    const state = t.ar as unknown as { placed: boolean; preview: unknown };
    expect(state.placed).toBe(false);
    expect(state.preview).toBeNull();
    expect(t.ar.roomSuspended).toBe(false);
    expect(document.querySelector('.ar-hint')?.textContent).toContain('tap to put it down');
    expect(t.board.placeRoomAr).not.toHaveBeenCalledWith(expect.objectContaining({ position: [1, 0, 1] }));
  });

  it('a session that cannot start after the run leaves AR waiting for another tap', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.ar.roomActive).toBe(true));
    t.ar.suspendRoom();
    t.board.startRoomAr.mockResolvedValueOnce(false);
    t.ar.resumeRoom(Promise.resolve(fakeSession()));
    await vi.waitFor(() => expect(t.onRoomSuspended).toHaveBeenCalled());
    expect(t.ar.active).toBe(true);
    expect(t.ar.roomSuspended).toBe(true);
    expect(t.onEnd).not.toHaveBeenCalled();
  });

  it('a refused session request does the same', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.ar.roomActive).toBe(true));
    t.ar.suspendRoom();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.ar.resumeRoom(Promise.reject(new Error('not allowed')));
    await vi.waitFor(() => expect(t.onRoomSuspended).toHaveBeenCalled());
    expect(t.ar.roomSuspended).toBe(true);
    expect(t.ar.active).toBe(true);
  });

  it('the player ending the session by hand still ends AR', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.ar.roomActive).toBe(true));
    t.first.fire('end');
    expect(t.onEnd).toHaveBeenCalledOnce();
  });
});
