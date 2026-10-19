/**
 * A token's stat block as Atlas draws it: the GM's Atlas renders the note's `atlas-statblock` card, and Connect sends
 * its markup, the CSS that styles it and the rolls in it (`statblockCards.ts` on the GM's side), so a player sees the
 * card the GM sees. Shared by the GM, the join page and Obsidian.
 *
 * What a player receives is markup from the GM, so both ends keep it to what a card is made of: every element and
 * attribute outside the lists below goes, as does any URL but an embedded image, and it is drawn in a shadow root
 * whose styles reach nothing else on the page (`online-client/cardView.mts`). A roll is asked for by its place among the card's rolls
 * and its text; the GM rolls the formula of its own copy (`cardRollFormula`), never one a player sends.
 */

export const CARD_LIMITS = {
  /** The card's markup, its images embedded. */
  html: 160_000,
  css: 96_000,
  rolls: 200,
  formula: 200,
  rollText: 200,
  label: 120,
  variables: 600,
  variable: 4000,
} as const;

export interface CardRoll {
  /** What Atlas rolls (`data-formula` of its dice link). */
  formula: string;
  /** The link's text, as the player clicks it. */
  text: string;
  /** What the roll is called in the log: the label or trait it stands in. */
  label: string;
}

export interface SheetCard {
  /** The card's markup, each roll marked `data-connect-roll="<index>"`. */
  html: string;
  /** The rules that style it, already scoped to the wrappers it is drawn in (`cardView.mts`). */
  css: string;
  /**
   * The values the GM's window gives the variables those rules read: used only where the player's own Obsidian (or
   * page) gives none, so the card takes the player's theme.
   */
  variables: Record<string, string>;
  rolls: CardRoll[];
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

export function isSheetCard(value: unknown): value is SheetCard {
  return isObject(value) && isText(value.html, CARD_LIMITS.html) && isText(value.css, CARD_LIMITS.css)
    && isObject(value.variables) && Object.keys(value.variables).length <= CARD_LIMITS.variables
    && Object.entries(value.variables).every(([name, variable]) => /^--[\w-]{1,120}$/.test(name) && isText(variable, CARD_LIMITS.variable))
    && Array.isArray(value.rolls) && value.rolls.length <= CARD_LIMITS.rolls
    && value.rolls.every((roll) => isObject(roll) && isText(roll.formula, CARD_LIMITS.formula) && isText(roll.text, CARD_LIMITS.rollText)
      && isText(roll.label, CARD_LIMITS.label));
}

/** The formula of the card's roll `index`, when its text is what the player clicked; null otherwise. */
export function cardRollFormula(card: SheetCard, index: number, text: string | undefined): string | null {
  const roll = card.rolls[index];
  return roll && roll.text === text && roll.formula ? roll.formula : null;
}

// ── What a card may hold ─────────────────────────────────────────────────

export const CARD_ELEMENTS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'br', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'img',
  'figure', 'figcaption', 'blockquote', 'code', 'pre', 'section', 'header', 'footer', 'article', 'aside', 'label', 'abbr', 'mark',
  'del', 'ins', 'kbd', 'q', 'cite', 'time', 'wbr',
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'use', 'symbol', 'clippath', 'lineargradient',
  'radialgradient', 'stop',
]);
/** Gone with all they hold; anything else unknown leaves its content behind. */
export const CARD_DROPPED = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'template', 'noscript', 'form',
  'input', 'textarea', 'select', 'button', 'option', 'audio', 'video', 'source', 'track', 'canvas', 'foreignobject', 'math', 'portal', 'slot',
  'title', 'head', 'dialog']);
export const CARD_ATTRIBUTES = new Set([
  'class', 'role', 'tabindex', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'scope', 'dir', 'lang', 'hidden', 'datetime', 'open',
  'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity',
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'transform', 'xmlns', 'preserveaspectratio', 'offset', 'stop-color',
  'gradientunits', 'id', 'style', 'src',
]);
export const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i;

/** CSS text without what could fetch or run anything: a URL that is no embedded image, an import, an old IE expression. */
export function safeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'invalid(')
    .replace(/-moz-binding\s*:/gi, 'invalid:')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _quote: string, url: string) => (IMAGE_DATA_URL.test(url.trim()) ? whole : 'none'));
}

