import { describe, expect, it, vi } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

function setup(capabilities: ConstructorParameters<typeof FakeAtlas>[0] = { capabilities: ['rules', 'dice', 'settings', 'remote-view', 'views', 'collections', 'dice-look-choice'] }) {
  const atlas = new FakeAtlas(capabilities);
  atlas.rules.saveCollection('camp', { maps: ['maps/a.atlasmap'] });
  const extension = atlas.connect(connectingPlugin('bones-ext'));
  return { atlas, extension, dice: extension.dice };
}

describe('FakeAtlas follows the dice look choice contract (1.18.0)', () => {
  it('lookFor answers the default until a collection chooses, as a full id, frozen', async () => {
    const { atlas, dice } = setup();
    expect(await dice.lookFor?.('camp')).toEqual({ lookId: '', from: 'default', loaded: true });
    await dice.useLook?.('bones');
    const answer = await dice.lookFor?.('camp');
    expect(answer).toEqual({ lookId: 'bones-ext:bones', from: 'default', loaded: false });
    expect(Object.isFrozen(answer)).toBe(true);
    await dice.useLook?.('coins', { collectionId: 'camp' });
    atlas.dice.registerLookId('bones-ext:coins');
    expect(await dice.lookFor?.('camp')).toEqual({ lookId: 'bones-ext:coins', from: 'collection', loaded: true });
    // Without a collection, and for one that chose nothing, it is the default.
    expect(await dice.lookFor?.()).toMatchObject({ lookId: 'bones-ext:bones', from: 'default' });
    expect(await dice.lookFor?.(null)).toMatchObject({ from: 'default' });
    await dice.useLook?.(null, { collectionId: 'camp' });
    expect(await dice.lookFor?.('camp')).toMatchObject({ lookId: 'bones-ext:bones', from: 'default' });
  });

  it("useLook rejects an unknown collection and a malformed look or options, and '' is Atlas's own dice", async () => {
    const { dice } = setup();
    await expect(dice.useLook?.('bones', { collectionId: 'nowhere' })).rejects.toThrow('no collection');
    await expect(dice.useLook?.(3 as unknown as string)).rejects.toThrow('dice.useLook');
    await expect(dice.useLook?.('bones', { collectionId: 4 } as unknown as { collectionId: string })).rejects.toThrow('dice.useLook');
    await dice.useLook?.('bones', { collectionId: 'camp' });
    await dice.useLook?.('', { collectionId: 'camp' });
    expect(await dice.lookFor?.('camp')).toEqual({ lookId: '', from: 'collection', loaded: true });
  });

  it("tells collections-changed for a collection's choice and settings-changed (diceLook) for the default's", async () => {
    const { extension, dice } = setup();
    const collections = vi.fn();
    const settings = vi.fn();
    extension.on('collections-changed', collections);
    extension.on('settings-changed', settings);
    await dice.useLook?.('bones', { collectionId: 'camp' });
    expect(collections).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    await dice.useLook?.('bones');
    expect(settings).toHaveBeenCalledWith('diceLook');
  });

  it('has neither member without the dice-look-choice capability', () => {
    const { dice } = setup({ capabilities: ['rules', 'dice'] });
    expect(dice.useLook).toBeUndefined();
    expect(dice.lookFor).toBeUndefined();
  });

  it('RemoteView.setDiceLook takes a string of at most 300 characters or null, and only with the capability', async () => {
    const { atlas, extension } = setup();
    const view = await extension.remoteViews!.open({ title: 'Online scene' });
    view.setDiceLook?.('bones-ext:bones');
    expect(atlas.remoteViews.latest().diceLook).toBe('bones-ext:bones');
    view.setDiceLook?.('');
    expect(atlas.remoteViews.latest().diceLook).toBe('');
    view.setDiceLook?.(null);
    expect(atlas.remoteViews.latest().diceLook).toBeNull();
    expect(() => view.setDiceLook?.('x'.repeat(301))).toThrow('setDiceLook');
    expect(() => view.setDiceLook?.(7 as unknown as string)).toThrow('setDiceLook');
    const old = await setup({ capabilities: ['views', 'remote-view'] }).extension.remoteViews!.open({ title: 'Online scene' });
    expect(old.setDiceLook).toBeUndefined();
  });
});
