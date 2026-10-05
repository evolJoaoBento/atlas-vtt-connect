import { afterEach, describe, expect, it, vi } from 'vitest';

describe("the 3D dice chunk's Obsidian globals", () => {
  const scope = globalThis as Record<string, unknown>;
  const saved = { createEl: scope.createEl, activeDocument: scope.activeDocument };
  afterEach(() => {
    Object.assign(globalThis, saved);
    vi.resetModules();
  });

  it('gives a plain page createEl (tag, class, attributes) and activeDocument', async () => {
    delete scope.createEl;
    delete scope.activeDocument;
    await import('../../../online-client/dice3d/obsidianShim.mts');
    const make = scope.createEl as (tag: string, info?: object) => HTMLElement;
    const canvas = make('canvas', { cls: 'atlas-dice-stage__canvas', attr: { 'aria-hidden': 'true', width: 64, hidden: false } });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.className).toBe('atlas-dice-stage__canvas');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.getAttribute('width')).toBe('64');
    expect(canvas.hasAttribute('hidden')).toBe(false);
    expect(scope.activeDocument).toBe(document);
  });

  it("never replaces Obsidian's own", async () => {
    const own = vi.fn();
    scope.createEl = own;
    await import('../../../online-client/dice3d/obsidianShim.mts');
    expect(scope.createEl).toBe(own);
  });
});
