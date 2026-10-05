/**
 * Atlas's map icons (`MAP_ICON_SVG`, Lucide markup on a 24 × 24 grid) as SVG path data,
 * so the player view draws them with `Path2D`. Only Atlas's own markup is read; nothing
 * from the network is ever put into SVG. Shared with the web page.
 */
import { MAP_ICON_SVG } from '@atlas-vtt/shared/draw';

export interface IconPath {
  d: string;
  /** Filled as well as stroked (`fill="currentColor"`). */
  fill: boolean;
}

/** The icons' coordinate box. */
export const MAP_ICON_BOX = 24;

const ELEMENT = /<(path|circle|rect|line|polyline)\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([a-zA-Z0-9-]+)="([^"]*)"/g;

function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, key = '', value = ''] of source.matchAll(ATTRIBUTE)) attributes.set(key, value);
  return attributes;
}

function pathData(tag: string, attributes: Map<string, string>): string | null {
  const n = (key: string): number => Number(attributes.get(key) ?? 0);
  switch (tag) {
    case 'path':
      return attributes.get('d') ?? null;
    case 'circle': {
      const [cx, cy, r] = [n('cx'), n('cy'), n('r')];
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    }
    case 'rect': {
      const [x, y, width, height] = [n('x'), n('y'), n('width'), n('height')];
      const r = Math.min(n('rx') || n('ry'), width / 2, height / 2);
      if (r <= 0) return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
      const w = width - 2 * r;
      const h = height - 2 * r;
      return `M ${x + r} ${y} h ${w} a ${r} ${r} 0 0 1 ${r} ${r} v ${h} a ${r} ${r} 0 0 1 ${-r} ${r} `
        + `h ${-w} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-h} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
    }
    case 'line':
      return `M ${n('x1')} ${n('y1')} L ${n('x2')} ${n('y2')}`;
    case 'polyline': {
      const values = (attributes.get('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const pairs: string[] = [];
      for (let index = 0; index + 1 < values.length; index += 2) {
        const x = values[index];
        const y = values[index + 1];
        if (x !== undefined && y !== undefined) pairs.push(`${x} ${y}`);
      }
      return pairs.length > 0 ? `M ${pairs.join(' L ')}` : null;
    }
    default:
      return null;
  }
}

const cache = new Map<string, IconPath[]>();

/** The icon's paths in its 24 × 24 box; null for a name Atlas does not know. */
export function mapIconPaths(name: string): IconPath[] | null {
  if (!Object.hasOwn(MAP_ICON_SVG, name)) return null;
  const cached = cache.get(name);
  if (cached) return cached;
  const paths: IconPath[] = [];
  for (const [, tag = '', source = ''] of (MAP_ICON_SVG[name] ?? '').matchAll(ELEMENT)) {
    const attributes = attributesOf(source);
    const d = pathData(tag, attributes);
    if (d) paths.push({ d, fill: attributes.get('fill') === 'currentColor' });
  }
  cache.set(name, paths);
  return paths;
}
