import { render } from '@testing-library/react';
import { ChevronDown, Circle, Dices, Ellipsis, Flashlight, Hand, Minus, Plus, Ruler, Triangle, X } from 'lucide-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DIE_ART } from '../../../src/app/online/page/dieArt';
import { TOOL_ICON_MARKUP, toolIconUrl, type ToolIconName } from '../../../src/app/online/page/toolIcons';
import { DIE_ICONS } from '@atlas-vtt/shared/dice3d';
import { TRAY_DICE } from '@atlas-vtt/shared/rules';


type Shape = [tag: string, attributes: Record<string, string>, text: string];

function shapesOf(svg: Element | null): Shape[] {
  return [...(svg?.children ?? [])].map((child) => [
    child.tagName.toLowerCase(),
    Object.fromEntries([...child.attributes].map((attribute) => [attribute.name, attribute.value])),
    child.textContent ?? '',
  ]);
}
const rendered = (element: React.ReactElement): Shape[] => shapesOf(render(element).container.querySelector('svg'));
function parsed(markup: string): Shape[] {
  const host = document.createElement('div');
  host.innerHTML = `<svg>${markup}</svg>`;
  return shapesOf(host.querySelector('svg'));
}

describe('the join page icons', () => {
  it("are the Lucide icons of Atlas's toolbar", () => {
    const icons: Record<ToolIconName, React.ComponentType> = {
      hand: Hand, ruler: Ruler, circle: Circle, triangle: Triangle, flashlight: Flashlight, dices: Dices, ellipsis: Ellipsis,
      'chevron-down': ChevronDown, x: X, minus: Minus, plus: Plus,
    };
    for (const [name, Icon] of Object.entries(icons)) {
      expect(parsed(TOOL_ICON_MARKUP[name as ToolIconName]), name).toEqual(rendered(<Icon />));
    }
  });

  it('become CSS mask images of a 24 px glyph', () => {
    expect(toolIconUrl('hand')).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(toolIconUrl('hand'))).toContain('stroke-linecap="round"');
  });

  it("draws the tray's dice with the drawings of Atlas's tray, d100 as two d10s", () => {
    // Atlas's tray draws `DIE_ICONS` (inlined); the page links copies of the same files.
    const asData = (src: string): string => `data:image/webp;base64,${readFileSync(join(process.cwd(), src)).toString('base64')}`;
    for (const sides of TRAY_DICE) {
      if (sides === 100) continue;
      expect(DIE_ART[sides].map(asData), `d${sides}`).toEqual([DIE_ICONS[`d${sides}` as keyof typeof DIE_ICONS]]);
    }
    expect(DIE_ART[100]).toEqual([DIE_ART[10][0], DIE_ART[10][0]]);
  });
});
