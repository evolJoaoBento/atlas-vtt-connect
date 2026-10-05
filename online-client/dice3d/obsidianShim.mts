// online-client/dice3d/obsidianShim.mts
/**
 * The two Obsidian globals Atlas's 3D dice (`src/app/dice3d/`) reach for, which a plain web page
 * lacks: `activeDocument`, and `createEl` for the canvases it paints faces on and draws in (a tag,
 * a class and attributes are all it passes). Installed only where absent, before the dice load:
 * the lazy entry imports this first. The page's default dice look never reads `doc.win`
 * (`diceLookRuntime.ts`, which this chunk does not load).
 */
interface ElementInfo {
  cls?: string;
  attr?: Record<string, string | number | boolean | null>;
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, info?: ElementInfo): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (info?.cls) element.className = info.cls;
  for (const [name, value] of Object.entries(info?.attr ?? {})) {
    if (value !== null && value !== false) element.setAttribute(name, String(value));
  }
  return element;
}

const scope = globalThis as Record<string, unknown>;
if (typeof scope.createEl !== 'function') Object.assign(globalThis, { createEl: createElement });
if (!scope.activeDocument) Object.assign(globalThis, { activeDocument: document });
