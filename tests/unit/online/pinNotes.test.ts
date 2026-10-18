import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { NoteHost } from '../../../src/app/online/tools/NoteHost';
import { isPinNote, PIN_NOTE_LIMITS, pinNote, withoutFrontmatter, type PinNote } from '../../../src/app/online/tools/pinNotes';

// The projection keeps each sent pin's note path; here a pin's note is named by its title.
vi.mock('../../../src/app/online/scene/projectForPlayers', () => ({
  notePathOf: (pin: { title: string | null }) => (pin.title ? `${pin.title}.md` : null),
}));

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };

describe("a readable pin's note, as players are sent it", () => {
  it('leaves out the GM comments and every embed, keeps links, and gives a one-line title', () => {
    const note = pinNote('  The   Cellar ', 'Cold.%% the GM only %%\n<!-- hidden -->\nSee [[Guard|the guard]].\n![[Secret map.png]]\n![alt](https://x.test/a.png)\n\n\n\nEnd');
    expect(note).toEqual({ title: 'The Cellar', body: 'Cold.\n\nSee [[Guard|the guard]].\n\nEnd' });
    expect(JSON.stringify(note)).not.toMatch(/GM only|hidden|Secret map|x\.test/);
    expect(pinNote('', 'x').title).toBe('Note');
  });

  it('cuts a long note to fit a message, and says so', () => {
    const note = pinNote('Long', 'é'.repeat(PIN_NOTE_LIMITS.bodyBytes));
    expect(note.cut).toBe(true);
    expect(new TextEncoder().encode(note.body).length).toBeLessThanOrEqual(PIN_NOTE_LIMITS.bodyBytes);
    expect(isPinNote(note)).toBe(true);
  });

  it('reads past the frontmatter only at the very top', () => {
    expect(withoutFrontmatter('---\nsecret: 1\n---\nBody')).toBe('Body');
    expect(withoutFrontmatter('Body\n---\nnot: frontmatter\n---')).toBe('Body\n---\nnot: frontmatter\n---');
  });

  it('travels as note-request, which a player may send, and pin-note, which only the GM sends', () => {
    expect(PLAYER_MESSAGE_TYPES.has('note-request')).toBe(true);
    expect(PLAYER_MESSAGE_TYPES.has('pin-note')).toBe(false);
    const answer: ControlMessage = { v: 1, type: 'pin-note', sceneId: 's1', pinId: 'pin-0', note: { title: 'T', body: 'B' } };
    expect(decodeControl(encodeControl(answer))).toEqual({ kind: 'message', message: answer });
    expect(decodeControl(encodeControl({ v: 1, type: 'note-request', sceneId: 's1', pinId: 'pin-0' })).kind).toBe('message');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'pin-note', sceneId: 's1', pinId: 'pin-0', note: { title: 1 } })).kind).toBe('invalid');
  });
});

type Slot = { sceneId: string; mapPath: string; lastSent: { pins?: Array<{ id: string; title: string | null }> } | null } | null;

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  let now = 0;
  let slot: Slot = { sceneId: 's1', mapPath: 'maps/Inn.atlasmap', lastSent: { pins: [{ id: 'pin-0', title: 'Cellar' }, { id: 'pin-1', title: 'Dock' }] } };
  const pins: Record<string, Record<string, unknown>> = {
    a: { notePath: 'Cellar.md', readable: true },
    b: { notePath: 'Dock.md', readable: true },
  };
  const read = vi.fn((notePath: string, mapPath: string): Promise<PinNote | null> => Promise.resolve({ title: notePath, body: `from ${mapPath}` }));
  const host = new NoteHost({
    session: {
      use: (h: SessionHandler) => { handler = h; return () => { handler = null; }; },
      send: (playerId: string, message: ControlMessage) => { sent.push([playerId, message]); },
      getPlayers: () => [ANA],
    } as never,
    projection: { slotOf: () => slot, shownSnapshot: () => ({ objects: { pins } }) } as never,
    read,
    now: () => now,
  });
  host.start();
  /** Opens a pin as Ana; the note she is answered, null for none, undefined when nothing came back. */
  const open = async (pinId: string, sceneId = 's1'): Promise<PinNote | null | undefined> => {
    const before = sent.length;
    handler?.onMessage?.(ANA, { v: 1, type: 'note-request', sceneId, pinId });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = sent.slice(before).find(([to, message]) => to === 'p1' && message.type === 'pin-note');
    return reply ? (reply[1] as Extract<ControlMessage, { type: 'pin-note' }>).note : undefined;
  };
  return { host, sent, read, pins, open, setSlot: (next: Slot) => { slot = next; }, tick: (ms: number) => { now += ms; } };
}

describe("the GM's notes for players who open a pin", () => {
  it('sends the note of a pin their scene was sent, read from that map', async () => {
    const w = world();
    expect(await w.open('pin-1')).toEqual({ title: 'Dock.md', body: 'from maps/Inn.atlasmap' });
    expect(w.read).toHaveBeenCalledWith('Dock.md', 'maps/Inn.atlasmap');
  });

  it('answers none for a pin not sent to them, another scene, or a pin the GM no longer offers', async () => {
    const w = world();
    expect(await w.open('pin-9')).toBeNull();
    w.tick(1000);
    expect(await w.open('pin-0', 's2')).toBeNull();
    w.tick(1000);
    w.pins.a = { notePath: 'Cellar.md', readable: true, gmOnly: true };
    expect(await w.open('pin-0')).toBeNull();
    w.tick(1000);
    w.pins.a = { notePath: 'Cellar.md' };
    expect(await w.open('pin-0')).toBeNull();
    w.tick(1000);
    w.setSlot(null);
    expect(await w.open('pin-1')).toBeNull();
    expect(w.read).not.toHaveBeenCalled();
  });

  it('answers none when the pin went while its note was read, or the note cannot be read', async () => {
    const w = world();
    w.read.mockImplementationOnce(() => {
      w.setSlot({ sceneId: 's2', mapPath: 'x', lastSent: { pins: [] } });
      return Promise.resolve({ title: 'Dock', body: 'late' });
    });
    expect(await w.open('pin-1')).toBeNull();
    w.setSlot({ sceneId: 's1', mapPath: 'maps/Inn.atlasmap', lastSent: { pins: [{ id: 'pin-1', title: 'Dock' }] } });
    w.tick(1000);
    w.read.mockRejectedValueOnce(new Error('gone'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await w.open('pin-1')).toBeNull();
    warn.mockRestore();
  });

  it('opens at most a couple of pins a second for each player, and stops hearing them when stopped', async () => {
    const w = world();
    expect(await w.open('pin-0')).not.toBeUndefined();
    expect(await w.open('pin-1')).not.toBeUndefined();
    expect(await w.open('pin-0')).toBeUndefined();
    w.tick(1000);
    expect(await w.open('pin-0')).not.toBeUndefined();
    w.host.stop();
    expect(await w.open('pin-1')).toBeUndefined();
  });
});
