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
 * Draws `card` in `host`'s shadow root, within wrappers standing in for the GM's `<html>` and `<body>` so the rules
 * that name them apply, and nothing of the page's styles reaches in or the card's out.
 */
export function renderCard(host: HTMLElement, card: SheetCard, bind: CardRollBinder): void {
  const doc = host.ownerDocument;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const style = host.ownerDocument.createElement('style');
  // The guard after the card's rules, so none of them takes the card out of its box.
  style.textContent = `${safeCss(card.css)}\n:host { display: block !important; position: relative !important; contain: layout paint !important; overflow: hidden !important; }`;
  const html = host.ownerDocument.createElement('div');
  html.setAttribute('data-connect-html', '');
  html.className = card.rootClasses;
  const body = host.ownerDocument.createElement('div');
  body.setAttribute('data-connect-body', '');
  body.className = card.bodyClasses;
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
