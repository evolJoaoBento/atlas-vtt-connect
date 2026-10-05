import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal, TFile, type App } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';

const { notices, FakeNotice } = vi.hoisted(() => {
  const shown: string[] = [];
  class Shown {
    constructor(message: string) { shown.push(message); }
    hide(): void {}
  }
  return { notices: shown, FakeNotice: Shown };
});
vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<object>()), Notice: FakeNotice }));

const { openShareWithModal, MAP_UNREADABLE_TEXT } = await import('../../../../src/app/online/sharing/ui/ShareWithModal');
const { testPeople } = await import('./sharingFixtures');

const MAP = 'maps/Inn.atlasmap';

/** Opens Share with… for the map, Atlas's scenes answering as given; resolves once the dialog has decided what to show. */
async function shareMap(scenes: Pick<ScenesApi, 'findByMap' | 'getData' | 'setData' | 'readMap'>): Promise<{ closed: boolean }> {
  const state = { closed: false };
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) { this.onOpen(); });
  vi.spyOn(Modal.prototype, 'close').mockImplementation(() => { state.closed = true; });
  const file = new (TFile as unknown as new (path: string) => TFile)(MAP);
  const people = { ...testPeople([]), currentKey: () => null } as never;
  openShareWithModal({} as App, file, { people, catalogue: {} as never, scenes, selfAt: () => undefined, sections: {} as never });
  await vi.waitFor(() => expect(state.closed).toBe(true));
  return state;
}

afterEach(() => {
  notices.length = 0;
  vi.restoreAllMocks();
});

describe('Share with… for a map', () => {
  it('says the map could not be read when Atlas cannot read its file, and shares nothing', async () => {
    const setData = vi.fn();
    await shareMap({
      findByMap: async () => ({ id: 's1', name: 'Inn', collectionId: 'c', mapPath: MAP }),
      getData: async () => undefined, setData,
      readMap: async () => { throw new Error('Unexpected token'); },
    });
    expect(notices).toEqual([MAP_UNREADABLE_TEXT]);
    expect(MAP_UNREADABLE_TEXT).toBe("This map couldn't be read.");
    expect(setData).not.toHaveBeenCalled();
  });

  it('says the map has no scene when no scene record names it', async () => {
    await shareMap({ findByMap: async () => null, getData: async () => undefined, setData: vi.fn(), readMap: async () => null });
    expect(notices).toEqual(['This map has no scene in a collection, so it cannot be shared.']);
  });
});
