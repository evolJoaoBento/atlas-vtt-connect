/**
 * A note's stat block as Atlas draws it, for a player (`tools/sheetCards.ts`): Atlas's own `atlas-statblock` card,
 * rendered off screen in the GM's window, then taken as markup with every rule of the window's style sheets that
 * styles it, the variables those read, its images shrunk and embedded, and its dice links numbered.
 *
 * Rendering is Atlas's: an Atlas without the card (no `atlas-statblock` fence) gives no card, and the player gets the
 * text sheet. Cards are drawn one at a time and kept until their note, a template or the bestiary changes.
 */
import { Component, MarkdownRenderer, type App } from 'obsidian';
import { CARD_LIMITS, type CardRoll, type SheetCard } from '../app/online/tools/sheetCards';

/** About the width of a player's drawer, so Atlas picks the columns the player will see. */
const CARD_WIDTH = 330;
/** Atlas renders with React: the card is done once it stops changing for this long. */
const QUIET_MS = 150;
const RENDER_TIMEOUT_MS = 4000;
/** An image's longest side at most, at twice what the card shows. */
const MAX_IMAGE_PX = 256;

/** Pseudo-classes and pseudo-elements that a rule may style but no element matches while the card is captured. */
const DYNAMIC = /::?(?:before|after|marker|placeholder|selection|backdrop|first-line|first-letter|-webkit-[a-z-]+|-moz-[a-z-]+|hover|focus|focus-visible|focus-within|active|visited|checked|disabled|enabled|target)(?:\([^)]*\))?/gi;

function splitSelectors(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function matchesAny(selector: string, elements: readonly Element[]): boolean {
  // What is left of a `:not(:hover)` says nothing either way.
  const plain = selector.replace(DYNAMIC, '').replace(/:(?:not|is|where)\(\s*\)/g, '').trim() || '*';
  try {
    return elements.some((element) => element.matches(plain));
  } catch {
    return false;
  }
}

/** A selector naming the GM's `<html>` or `<body>`, made to name the wrappers the card is drawn in (`renderCard`). */
export function scopeSelector(selector: string): string {
  return selector
    .replace(/:root\b/g, ':where([data-connect-html])')
    .replace(/(^|[\s>+~(,])html(?=$|[\s.:#[>+~),])/g, '$1:where([data-connect-html])')
    .replace(/(^|[\s>+~(,])body(?=$|[\s.:#[>+~),])/g, '$1:where([data-connect-body])');
}

/** The rules of the window's style sheets that style an element of `elements`, in their order, scoped. */
function rulesFor(elements: readonly Element[], doc: Document): string[] {
  const kept: string[] = [];
  const walk = (rules: CSSRuleList): string[] => {
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const selectors = splitSelectors(rule.selectorText).filter((selector) => matchesAny(selector, elements));
        if (selectors.length > 0) {
          const body = rule.cssText.slice(rule.cssText.indexOf('{'));
          out.push(`${selectors.map(scopeSelector).join(', ')} ${body}`);
        }
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule || (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule)) {
        const inner = walk(rule.cssRules);
        if (inner.length > 0) out.push(`${rule.cssText.slice(0, rule.cssText.indexOf('{')).trim()} {\n${inner.join('\n')}\n}`);
      } else if (rule instanceof CSSLayerBlockRule) {
        out.push(...walk(rule.cssRules));
      }
    }
    return out;
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      kept.push(...walk(sheet.cssRules));
    } catch {
      // A sheet from another origin cannot be read.
    }
  }
  return kept;
}

/** The `@keyframes` the kept rules animate with. */
function keyframesFor(css: string, doc: Document): string[] {
  const found: string[] = [];
  const walk = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSKeyframesRule && new RegExp(`\\b${rule.name.replace(/[^\w-]/g, '')}\\b`).test(css)) found.push(rule.cssText);
      else if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) walk(rule.cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Another origin.
    }
  }
  return found;
}

/**
 * Values of the variables the card reads, as the card's root has them (computed: no `var()` left): the player's
 * side uses each only where its own Obsidian (or page) has none, so the card takes the player's theme.
 */
async function variablesFor(css: string, root: Element): Promise<Record<string, string>> {
  const names = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(match[1]!);
  const computed = getComputedStyle(root);
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim();
    if (!value || value.length > CARD_LIMITS.variable || Object.keys(values).length >= CARD_LIMITS.variables) continue;
    values[name] = value.includes('url(') ? await embedUrls(value) : value;
  }
  return values;
}

/** An image as a small embedded WebP; null when it cannot be read. */
async function shrunk(url: string, longest = MAX_IMAGE_PX): Promise<string | null> {
  try {
    const image = createEl('img');
    // Loaded, not decoded: `decode()` waits for a window that is not on screen, as the GM's may well be.
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timed out')), RENDER_TIMEOUT_MS);
      image.onload = () => { window.clearTimeout(timer); resolve(); };
      image.onerror = () => { window.clearTimeout(timer); reject(new Error('unreadable')); };
      image.src = url;
    });
    const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = createEl('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.85);
  } catch {
    return null;
  }
}

/** The CSS with every image it names shrunk and embedded, and every other URL gone. */
async function embedUrls(css: string): Promise<string> {
  const urls = new Set<string>();
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) urls.add(match[2]!);
  const replaced = new Map<string, string>();
  for (const url of urls) replaced.set(url, (await shrunk(url)) ?? '');
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (_whole, _quote: string, url: string) => {
    const data = replaced.get(url);
    return data ? `url("${data}")` : 'none';
  });
}

/** What a roll is called: the label it follows, else the trait it is in, else its formula. */
function rollLabel(link: Element, formula: string): string {
  const labelled = link.closest('.atlas-sb-labelled, .atlas-sb-metric__number');
  const label = labelled?.querySelector('.atlas-sb-label')?.textContent?.trim();
  if (label) return label;
  const trait = link.closest('.atlas-sb-trait');
  const name = trait?.querySelector('[class*="name"], strong, b, em')?.textContent?.trim().replace(/[.:]$/, '');
  return name || formula;
}

/** Waits until `element` has stopped changing, or the timeout. */
function settled(element: Element): Promise<void> {
  return new Promise((resolve) => {
    let quiet = window.setTimeout(done, QUIET_MS);
    const limit = window.setTimeout(done, RENDER_TIMEOUT_MS);
    const observer = new MutationObserver(() => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(done, QUIET_MS);
    });
    observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
    function done(): void {
      observer.disconnect();
      window.clearTimeout(quiet);
      window.clearTimeout(limit);
      resolve();
    }
  });
}

/** A token's art as the card shows it in place of the note's own picture (`useTokenPortrait` in Atlas). */
export interface TokenArt {
  imagePath: string;
  ringColor?: string | undefined;
  showRing?: boolean | undefined;
}

/**
 * The card's header with the token's art at its right, as Atlas draws a stat block shown for a token
 * (`StatblockHeader`, `TokenPortrait`): the art the map shows, so the creature never looks different from its token.
 */
function putTokenArt(app: App, root: Element, art: TokenArt): void {
  const file = app.vault.getFileByPath(art.imagePath);
  const header = root.querySelector('.atlas-sb-header');
  if (!file || !header) return;
  const frame = header.querySelector<HTMLElement>(':scope > [data-block-id="header-token"]') ?? header.createDiv();
  frame.className = 'atlas-sb-item atlas-sb-item--fit';
  const attributes = { 'data-type': 'image', 'data-block': 'image', 'data-prop': 'image', 'data-block-id': 'header-token', 'data-look': 'token' };
  for (const [name, value] of Object.entries(attributes)) frame.setAttribute(name, value);
  const showRing = art.showRing !== false;
  frame.empty();
  const portrait = frame.createDiv({ cls: ['atlas-token-portrait', ...(showRing ? [] : ['atlas-token-portrait--unframed']), 'atlas-sb-token-image'] });
  portrait.createDiv({ cls: 'atlas-token-image-wrapper' }).createEl('img', { attr: { src: app.vault.getResourcePath(file), alt: '', draggable: 'false' } });
  if (showRing) {
    const ring = portrait.createDiv({ cls: 'atlas-token-ring' });
    if (art.ringColor) ring.style.setProperty('--atlas-token-ring-color', art.ringColor);
  }
}

/** Atlas's card of the note at `notePath`, with `art` in its header, ready for a player; null when this Atlas draws none. */
export async function captureCard(app: App, notePath: string, art: TokenArt | null = null): Promise<SheetCard | null> {
  const doc = document;
  // Outside a note, as Atlas draws its own sheets: a note's table rules would widen the ability tables past the card.
  const container = createDiv();
  container.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${CARD_WIDTH}px; pointer-events: none;`;
  container.setAttribute('aria-hidden', 'true');
  doc.body.append(container);
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, '```atlas-statblock\n```', container, notePath, component);
    await settled(container);
    const card = container.querySelector('.atlas-statblock');
    if (!card) return null;
    container.querySelectorAll('.atlas-statblock-fence__bar').forEach((bar) => bar.remove());
    const root = container.firstElementChild ?? container;
    if (art) putTokenArt(app, root, art);

    const rolls: CardRoll[] = [];
    for (const link of Array.from(root.querySelectorAll<HTMLElement>('[data-formula]'))) {
      const formula = (link.dataset.formula ?? '').slice(0, CARD_LIMITS.formula);
      if (!formula || rolls.length >= CARD_LIMITS.rolls) {
        link.removeAttribute('data-formula');
        continue;
      }
      link.setAttribute('data-connect-roll', String(rolls.length));
      rolls.push({ formula, text: (link.textContent ?? '').trim().slice(0, CARD_LIMITS.rollText), label: rollLabel(link, formula).slice(0, CARD_LIMITS.label) });
    }

    const elements = [container, ...Array.from(container.querySelectorAll('*'))];
    const rules = rulesFor(elements, doc).join('\n');
    const frames = keyframesFor(rules, doc).join('\n');
    // The variables read inline too: Atlas sets some on its elements (`--atlas-sb-max-columns`).
    const inline = Array.from(container.querySelectorAll('[style]')).map((element) => element.getAttribute('style') ?? '').join(';');
    const variables = await variablesFor(`${rules}\n${inline}`, container);
    const css = await embedUrls(`${rules}\n${frames}`);

    for (const image of Array.from(container.querySelectorAll('img'))) {
      const shown = Math.max(image.getBoundingClientRect().width, image.getBoundingClientRect().height);
      const data = image.src ? await shrunk(image.src, Math.min(MAX_IMAGE_PX, Math.max(64, Math.round(shown * 2)))) : null;
      if (data) image.setAttribute('src', data);
      else image.remove();
      image.removeAttribute('srcset');
    }

    const outer = container.outerHTML.replace(/ style="position: fixed;[^"]*"/, '').replace(/ aria-hidden="true"/, '');
    if (outer.length > CARD_LIMITS.html || css.length > CARD_LIMITS.css) {
      console.warn(`[Atlas VTT Connect] The stat block of ${notePath} is too large to send as a card (${outer.length} + ${css.length} characters).`);
      return null;
    }
    return { html: outer, css, variables, rolls };
  } finally {
    component.unload();
    container.remove();
  }
}

/** What a card is kept by: its note and the art of the token it is for, which the card's header shows. */
export function cardKey(notePath: string, art: TokenArt | null): string {
  return [notePath, art?.imagePath ?? '', art?.ringColor ?? '', art?.showRing === false ? 'unframed' : ''].join(KEY_SEPARATOR);
}

const KEY_SEPARATOR = '\u0000';

/** The note and art a key stands for. */
export function cardKeyParts(key: string): { notePath: string; art: TokenArt | null } {
  const [notePath = '', imagePath = '', ringColor = '', framed = ''] = key.split(KEY_SEPARATOR);
  return { notePath, art: imagePath ? { imagePath, ...(ringColor ? { ringColor } : {}), showRing: framed !== 'unframed' } : null };
}

/**
 * Cards by note and token art (`cardKey`), drawn on demand one at a time: `get` answers from what is kept and asks for a drawing when
 * there is none or it is out of date, `drawn` is called once one is ready. A card out of date is still given until
 * its new drawing replaces it, so a player never sees it go while a note is edited.
 */
export class StatblockCards {
  private readonly cards = new Map<string, SheetCard | null>();
  private readonly stale = new Set<string>();
  private readonly queue: string[] = [];
  /** The note being drawn now. */
  private drawing: string | null = null;
  private generation = 0;

  constructor(private readonly draw: (notePath: string) => Promise<SheetCard | null>, private readonly drawn: () => void) {}

  /** The card of the note at `notePath`: undefined until it is first drawn, null when Atlas draws none. */
  get(notePath: string): SheetCard | null | undefined {
    if (!this.cards.has(notePath) || this.stale.has(notePath)) this.request(notePath);
    return this.cards.get(notePath);
  }

  /** Marks the cards of `notePath`, or every card, out of date: each is drawn again when next asked for. */
  forget(notePath?: string): void {
    this.generation += 1;
    for (const key of this.cards.keys()) {
      if (notePath === undefined || key === notePath || key.startsWith(`${notePath}${KEY_SEPARATOR}`)) this.stale.add(key);
    }
  }

  private request(notePath: string): void {
    if (this.drawing !== notePath && !this.queue.includes(notePath)) this.queue.push(notePath);
    void this.next();
  }

  private async next(): Promise<void> {
    if (this.drawing !== null) return;
    const notePath = this.queue.shift();
    if (notePath === undefined) return;
    this.drawing = notePath;
    const generation = this.generation;
    let card: SheetCard | null = null;
    try {
      card = await this.draw(notePath);
    } catch (error) {
      console.warn('[Atlas VTT Connect] Could not draw a stat block card:', error);
    }
    this.cards.set(notePath, card);
    // A change heard while drawing: the drawing may show the note as it was, so it is drawn again.
    if (generation === this.generation) this.stale.delete(notePath);
    else if (!this.queue.includes(notePath)) this.queue.push(notePath);
    this.drawing = null;
    if (this.queue.length > 0) void this.next();
    else this.drawn();
  }
}
