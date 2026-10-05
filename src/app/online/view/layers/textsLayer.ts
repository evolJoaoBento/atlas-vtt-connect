/**
 * Atlas's map texts, as `TextRenderer` draws them: centred on their position, rotated
 * and scaled, with an optional background grown by its padding (`textBoxLayout`). Text
 * reaches the surface only through `text`, never as markup.
 */
import {
  TEXT_LINE_SPACING, textBackground, textFontStyle, textFontWeight, textRotation, textScale,
} from '@atlas-vtt/shared/draw';
import type { PlayerText } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { PlayerLayer } from './layerTypes';

/** Measured line widths are kept between frames; the store is emptied when it grows past this. */
const MAX_MEASURED = 5000;

/** The CSS font of a text, built from the same fields PIXI uses. */
export function textFont(text: PlayerText): string {
  const style = textFontStyle(text) === 'italic' ? 'italic ' : '';
  const weight = textFontWeight(text) === 'bold' ? 'bold ' : '';
  return `${style}${weight}${text.fontSize}px ${text.fontFamily}`;
}

export function createTextsLayer(): PlayerLayer {
  const widths = new Map<string, number>();
  const measure = (surface: ViewSurface, line: string, font: string): number => {
    const key = `${font}\n${line}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size >= MAX_MEASURED) widths.clear();
      width = surface.measureText(line, font);
      widths.set(key, width);
    }
    return width;
  };
  return {
    draw(surface, frame): void {
      for (const text of Object.values(frame.scene.texts)) {
        const font = textFont(text);
        const lines = text.text.split('\n');
        const width = lines.reduce((widest, line) => Math.max(widest, measure(surface, line, font)), 0);
        const lineHeight = text.fontSize * TEXT_LINE_SPACING;
        const height = lines.length * lineHeight;
        const box = { x: -width / 2, y: -height / 2, width, height };
        const background = textBackground(text, box);
        const outer = background ?? box;
        const scale = textScale(text.scale);
        // Half the diagonal holds the box at any rotation.
        const reach = (Math.hypot(outer.width, outer.height) / 2) * scale;
        if (!intersects({ x: text.x - reach, y: text.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        surface.push(text.x, text.y, textRotation(text.rotation), scale);
        if (background) {
          const style = { fill: background.color, alpha: background.alpha };
          if (background.radius) surface.roundRect(background.x, background.y, background.width, background.height, background.radius, style);
          else surface.rect(background.x, background.y, background.width, background.height, style);
        }
        const x = text.align === 'left' ? box.x : text.align === 'right' ? box.x + box.width : 0;
        lines.forEach((line, index) => {
          surface.text(line, x, box.y + lineHeight * (index + 0.5), { font, color: text.color, align: text.align });
        });
        surface.pop();
      }
    },
  };
}
