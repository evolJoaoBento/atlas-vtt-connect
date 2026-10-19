import { describe, expect, it, vi } from 'vitest';
import { cardRollFormula, isSheetCard, safeCss, type SheetCard } from '../../../src/app/online/tools/sheetCards';
import { renderCard, sanitizeCardHtml } from '../../../online-client/cardView.mts';
import { isSheetRollRef, isTokenSheets } from '../../../src/app/online/tools/sheets';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';
const CARD: SheetCard = {
  html: `<div class="atlas-statblock"><h1 class="atlas-sb-heading">Modelo NPC</h1><img class="token" src="${PIXEL}">`
    + '<span class="atlas-sb-label">Attack</span><span class="atlas-dice-link" data-connect-roll="0" role="button" tabindex="0">Claws</span>'
    + '<span data-connect-roll="7">stale</span></div>',
  css: '.atlas-sb-heading { color: var(--accent); background: var(--text-normal); }',
  variables: { '--accent': '#7c5cff', '--text-normal': '#dadada' },
  rolls: [{ formula: '1d6+2', text: 'Claws', label: 'Attack' }],
};

const html = (fragment: DocumentFragment): string => {
  const box = document.createElement('div');
  box.append(fragment);
  return box.innerHTML;
};

describe("Atlas's card for a player", () => {
  it('keeps what a card is made of, and nothing that could run, fetch or reach the page', () => {
    const dirty = '<div class="a" onclick="steal()" style="color: red; background: url(https://evil.example/x.png)">'
      + '<script>steal()</script><style>body{}</style><iframe src="https://evil.example"></iframe>'
      + '<a href="javascript:steal()">link <b>bold</b></a><img src="https://evil.example/t.png" onerror="steal()">'
      + `<img src="${PIXEL}" alt="art"><button onclick="x()">no</button><svg viewBox="0 0 2 2"><path d="M0 0" onload="x()"/><use href="#x"/></svg>`
      + '<span data-formula="+2" aria-label="Roll +2" role="button">+2</span><!-- note --></div>';
    const clean = html(sanitizeCardHtml(dirty, document));
    for (const gone of ['onclick', 'steal', 'script', '<style', 'iframe', 'evil', 'href', 'onerror', '<button', 'onload', 'note']) expect(clean).not.toContain(gone);
    expect(clean).toContain('link <b>bold</b>');
    expect(clean).toContain(`<img src="${PIXEL}" alt="art">`);
    expect(clean).toContain('data-formula="+2"');
    expect(clean).toContain('style="color: red; background: none"');
    expect(clean).toContain('<path d="M0 0">');
  });

  it('keeps no URL in its CSS but an embedded image', () => {
    expect(safeCss('@import url(x.css); a { background: url("https://x/y.png"); } b { background: url(' + PIXEL + '); } c { width: expression(alert(1)); }'))
      .toBe(` a { background: none; } b { background: url(${PIXEL}); } c { width: invalid(alert(1)); }`);
  });

  it("draws the card in a shadow root in the player's theme, the GM's values only where the player has none, its rolls bound", () => {
    document.documentElement.className = 'mod-windows';
    document.body.className = 'theme-light obsidian-app';
    document.body.style.setProperty('--text-normal', '#222');
    const host = document.createElement('div');
    const bind = vi.fn();
    renderCard(host, CARD, bind);
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector('style')?.textContent).toContain('.atlas-sb-heading { color: var(--accent); background: var(--text-normal); }');
    const wrapper = shadow.querySelector<HTMLElement>('[data-connect-html]')!;
    expect(wrapper.className).toBe('mod-windows');
    expect(shadow.querySelector('[data-connect-body]')?.className).toBe('theme-light obsidian-app');
    expect(wrapper.style.getPropertyValue('--accent')).toBe('#7c5cff');
    // The player's Obsidian gives this one: theirs is kept.
    expect(wrapper.style.getPropertyValue('--text-normal')).toBe('');
    document.body.style.removeProperty('--text-normal');
    document.body.className = '';
    document.documentElement.className = '';
    expect(shadow.querySelector('h1')?.textContent).toBe('Modelo NPC');
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(shadow.querySelector('.atlas-dice-link'), 0, CARD.rolls[0]);
    // A link the card's rolls do not hold rolls nothing.
    expect(shadow.querySelector('[data-connect-roll="7"]')).toBeNull();
    expect(host.children).toHaveLength(0);
  });

  it('is checked on both ends, and rolls only its own formula for the text that was clicked', () => {
    expect(isSheetCard(CARD)).toBe(true);
    expect(isSheetCard({ ...CARD, html: 'x'.repeat(200_000) })).toBe(false);
    expect(isSheetCard({ ...CARD, rolls: [{ formula: 1 }] })).toBe(false);
    expect(isTokenSheets([{ tokenId: 't', name: 'x', resources: [], sheet: null, card: CARD }])).toBe(true);
    expect(isTokenSheets([{ tokenId: 't', name: 'x', resources: [], sheet: null, card: { html: 1 } }])).toBe(false);
    expect(isSheetRollRef({ kind: 'card', index: 0, text: 'Claws', side: 'disadvantage' })).toBe(true);
    expect(isSheetRollRef({ kind: 'card', index: 0 })).toBe(false);
    expect(cardRollFormula(CARD, 0, 'Claws')).toBe('1d6+2');
    expect(cardRollFormula(CARD, 0, 'Bite')).toBeNull();
    expect(cardRollFormula(CARD, 3, 'Claws')).toBeNull();
  });
});
