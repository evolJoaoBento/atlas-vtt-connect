// online-client/cardView.mts
/**
 * Atlas's card of a token's stat block on the player's side (`sheetCards.ts`): its markup kept to what a card is made
 * of, drawn in a shadow root so its styles and the page's never meet. Shared with the Obsidian scene tab.
 */
import { CARD_ATTRIBUTES, CARD_DROPPED, CARD_ELEMENTS, IMAGE_DATA_URL, safeCss, type CardRoll, type SheetCard } from '../src/app/online/tools/sheetCards';

/** `html` as a fragment of `doc` holding only what a card may hold. */
export function sanitizeCardHtml(html: string, doc: Document): DocumentFragment {
  // Parsed in a document of its own, which runs nothing and loads nothing, then cleaned before it is adopted.
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const clean = (parent: Node): void => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        continue;
      }
      const element = node as Element;
      const tag = element.localName.toLowerCase();
      if (CARD_DROPPED.has(tag)) {
        element.remove();
        continue;
      }
      if (!CARD_ELEMENTS.has(tag)) {
        clean(element);
        element.replaceWith(...element.childNodes);
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const kept = name.startsWith('data-') || name.startsWith('aria-') || (CARD_ATTRIBUTES.has(name) && keepValue(tag, name, attribute.value));
        if (!kept) element.removeAttribute(attribute.name);
        else if (name === 'style') element.setAttribute(attribute.name, safeCss(attribute.value));
      }
      clean(element);
    }
  };
  clean(parsed.body);
  const fragment = doc.createDocumentFragment();
  fragment.append(...Array.from(parsed.body.childNodes, (node) => doc.adoptNode(node)));
  return fragment;
}

function keepValue(tag: string, name: string, value: string): boolean {
  if (name === 'src') return tag === 'img' && IMAGE_DATA_URL.test(value.trim());
  // An svg `use` may point at a symbol of the card only.
  if (tag === 'use') return false;
  return !/javascript:|vbscript:|data:text/i.test(value);
}

/** What the card's rolls do when clicked: `bind` gets each link and its roll. */
export type CardRollBinder = (link: HTMLElement, index: number, roll: CardRoll) => void;

/**
 * After the card's rules: none of them takes the card out of its box, and the card stands in the drawer without a
 * frame of its own, as the drawer's content rather than a panel inside it.
 */
const GUARD = `
:host { display: block !important; position: relative !important; contain: layout paint !important; overflow: hidden !important; }
.atlas-statblock { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important; }
.atlas-statblock-body { padding: 0 !important; background: transparent !important; }`;

/**
 * Draws `card` in `host`'s shadow root, in the theme of the document it is in: within wrappers standing in for that
 * document's `<html>` and `<body>` (their classes, so `.theme-dark` rules follow the player's Obsidian), the
 * variables its Obsidian or page gives inherited as they are, the GM's values only for the ones it does not give.
 * Nothing of the page's styles reaches in, or the card's out.
 */
export function renderCard(host: HTMLElement, card: SheetCard, bind: CardRollBinder): void {
  const doc = host.ownerDocument;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const style = host.ownerDocument.createElement('style');
  style.textContent = `${safeCss(card.css)}\n${GUARD}`;
  const html = host.ownerDocument.createElement('div');
  html.setAttribute('data-connect-html', '');
  html.className = doc.documentElement.className;
  const body = host.ownerDocument.createElement('div');
  body.setAttribute('data-connect-body', '');
  body.className = doc.body.className;
  // A page outside Obsidian names no theme: the one it is drawn in.
  if (!/\btheme-(?:dark|light)\b/.test(`${html.className} ${body.className}`)) {
    body.classList.add(doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'theme-dark' : 'theme-light');
  }
  const local = doc.defaultView?.getComputedStyle(doc.body);
  for (const [name, value] of Object.entries(card.variables)) {
    if (!/^--[\w-]+$/.test(name) || local?.getPropertyValue(name).trim()) continue;
    html.style.setProperty(name, safeCss(value));
  }
  body.append(sanitizeCardHtml(card.html, doc));
  html.append(body);
  shadow.replaceChildren(style, html);
  for (const link of body.querySelectorAll<HTMLElement>('[data-connect-roll]')) {
    const index = Number.parseInt(link.dataset.connectRoll ?? '', 10);
    const roll = card.rolls[index];
    if (roll) bind(link, index, roll);
    else link.removeAttribute('data-connect-roll');
  }
}
