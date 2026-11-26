// online-client/initiativeView.mts
/**
 * The initiative list as Atlas 0.20's player window shows it (`PlayerInitiativePanel`, `playerInitiativeList.ts`,
 * `playerInitiativeCard.ts`, `player-initiative.scss`): a row across the top, one tile per combatant in turn order,
 * each filled with the token's art, the red of the life it lost rising in it (where players see hit points), the
 * turn's ring and glow in the accent (or the token's ring colour); a combatant that sits out the round is faded, one
 * defeated is greyed under a skull, its conditions fan down the card's left edge and its look-alike number sits in the
 * corner. The row scrolls sideways, the turn kept in view, and "Round N" closes it while a fight runs. By sides, the
 * combatants stand under their side's name, the side whose turn it is in the accent. As in Atlas 0.18, players see art
 * only: no initiative number, card dealt or side's roll is sent or drawn, the order is the list's. A combatant without a
 * token (a player at the table, an enemy added by name) is listed too, by its own art, else by its name or a stand-in.
 * The markup and class names are Atlas's, so Atlas's own stylesheet (Obsidian) or its copy (`atlas-initiative.css`, the
 * join page) draws it. Text only, never markup: everything comes from the GM. Shared with the Obsidian scene tab.
 */
import { SIDE_LABELS, sidesInOrder } from '@atlas-vtt/shared/rules';
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';
import { entryTokenId, listedSide } from '../src/app/online/scene/initiativeSides';
import type { PlayerCondition, PlayerInitiativeEntry, PlayerScene, PlayerSideRow, PlayerToken } from '../src/app/online/scene/sceneTypes';
import { colorNumber, isLightBadgeColor, NEUTRAL_BADGE_COLOR } from '../src/app/online/view/layers/tokenUiDrawing';
import { WIDGET_ICON_PATHS } from '../src/app/types/widgetIcons';

/** The heading of the group of combatants that delayed their turn (Atlas's `playerInit.delayed`). */
const DELAYED_LABEL = 'Delayed';
/** The label of the skull on a defeated combatant's card (Atlas's `playerInit.defeated`). */
const DEFEATED_LABEL = 'Defeated';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Atlas's widget icons are drawn in a 512 box (`WIDGET_ICON_VIEW_BOX`). */
const WIDGET_ICON_VIEW_BOX = '0 0 512 512';
/** The art is handed to a card as a picture this many pixels along its longer side: sharp at a card's size on a dense screen. */
const ART_PIXELS = 256;
/** Lucide's skull, the icon Atlas marks a defeated combatant with (its eyes are drawn apart). */
const SKULL_PATHS = ['m12.5 17-.5-1-.5 1h1z', 'M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z'];
/** Lucide's user and bot, the stand-ins of a combatant without art or a name to show (Atlas's `PlayerCardIcon`). */
const USER_PATHS = ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'];
const BOT_PATHS = ['M12 8V4H8', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'];
/** The most condition badges a card shows; the rest are counted (Atlas's `SHOWN_CARD_CONDITIONS`). */
const SHOWN_CARD_CONDITIONS = 3;
/** A badge's diameter, as Atlas's cards draw them, grown with the list. */
const CONDITION_SIZE = 'calc(18px * var(--atlas-initiative-scale, 1))';
/** The classes of the list's panel: Atlas's players' list, docked across the top as a row (`atlas-player-initiative--top`). */
const PANEL_CLASSES = ['atlas-initiative-panel', 'atlas-player-initiative', 'atlas-player-initiative--top', 'atlas-initiative-panel--row'];
/** How many cards of the row stay in view past the turn when it scrolls there (Atlas's `scrollWithin(..., 'nearest', 2)`). */
const CARDS_PAST_TURN = 2;

export interface InitiativeViewOptions {
  /** The panel; hidden while there is no fight to show. */
  panel: HTMLElement;
  /** A decoded token image by asset id, or null while it has not arrived. */
  images(assetId: string): DecodedImage | null;
  /** Called with the token of a combatant a player clicked (Atlas 0.9.1: the click finds the token); without it the cards do nothing. */
  onFind?: (tokenId: string) => void;
}

/** What a card is drawn from, besides its entry. */
interface CardLook {
  token: PlayerToken | undefined;
  /** The card is the turn's (a fight in turn order, the entry's own turn). */
  active: boolean;
}

/** The pictures made of decoded art, by the art itself: encoded once, and gone with it. */
const pictures = new WeakMap<object, string | null>();

/** A picture a card's `<img>` shows, from art a view decoded; null where none can be made. */
function pictureOf(art: DecodedImage, doc: Document): string | null {
  if (pictures.has(art)) return pictures.get(art) ?? null;
  let url: string | null = null;
  try {
    const { image } = art;
    // A picture the page already holds by address is shown by it; a bitmap is drawn smaller and encoded.
    const address = (image as Partial<HTMLImageElement>).src;
    if (typeof address === 'string' && address !== '') url = address;
    else if (art.width > 0 && art.height > 0) {
      const scale = Math.min(1, ART_PIXELS / Math.max(art.width, art.height));
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, Math.round(art.width * scale));
      canvas.height = Math.max(1, Math.round(art.height * scale));
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/webp', 0.9);
        url = encoded.startsWith('data:image/') ? encoded : null;
      }
    }
  } catch {
    url = null;
  }
  pictures.set(art, url);
  return url;
}

export class InitiativeView {
  /** What the panel was last drawn from, so a scene patch that changes nothing of it draws nothing. */
  private drawn = '';

  constructor(private readonly options: InitiativeViewOptions) {
    options.panel.classList.add(...PANEL_CLASSES);
    options.panel.hidden = true;
  }

  /** Draws the panel for `scene`; again after images arrived (`force`). */
  update(scene: PlayerScene | null, force = false): void {
    const { panel } = this.options;
    const initiative = scene?.initiative ?? null;
    if (!scene || !initiative || initiative.entries.length === 0) {
      this.drawn = '';
      panel.replaceChildren();
      panel.hidden = true;
      return;
    }
    const tokenOf = (entry: PlayerInitiativeEntry): PlayerToken | undefined => {
      const id = entryTokenId(entry);
      return id !== undefined && Object.hasOwn(scene.tokens, id) ? scene.tokens[id] : undefined;
    };
    const key = JSON.stringify([initiative, initiative.entries.map((entry) => this.portraitKey(tokenOf(entry), entry.image))]);
    if (key === this.drawn && !force) return;
    this.drawn = key;
    panel.hidden = false;
    const doc = panel.ownerDocument;
    const surface = doc.createElement('div');
    surface.className = 'atlas-initiative-panel__surface';
    surface.setAttribute('aria-hidden', 'true');
    const list = doc.createElement('div');
    list.className = 'atlas-initiative-panel__list';
    list.setAttribute('role', 'list');
    const { sides } = initiative;
    if (sides) {
      // Atlas's own list of sides, in the order they act; from an older GM, the two built-in sides, `first` first.
      const rows: readonly PlayerSideRow[] = initiative.sideList
        ?? sidesInOrder(sides.first).map((side) => ({ id: side, name: SIDE_LABELS[side], ...(sides.active === side && { turn: true as const }) }));
      for (const row of rows) {
        const members = initiative.entries.filter((entry) => listedSide(scene.tokens, entry) === row.id);
        if (members.length === 0) continue;
        // By sides the turn is the side's, so no card holds it alone.
        list.append(this.group(row.name, row.turn === true, false, members.map((entry) => this.card(entry, { token: tokenOf(entry), active: false }))));
      }
    } else {
      // In turn order, a combatant that delayed its turn is listed apart, after the order, as Atlas's list does.
      const waiting = initiative.entries.filter((entry) => entry.delayed === true);
      list.append(...initiative.entries.filter((entry) => entry.delayed !== true).map((entry) => this.card(entry, { token: tokenOf(entry), active: initiative.active })));
      if (waiting.length > 0) list.append(this.group(DELAYED_LABEL, false, true, waiting.map((entry) => this.card(entry, { token: tokenOf(entry), active: false }))));
    }
    const children: HTMLElement[] = [surface, list];
    // The cards scrolled past the list's start fade under a shade; with no round at the end, one there as well.
    const top = doc.createElement('div');
    top.className = 'atlas-initiative-panel__top-shade';
    top.setAttribute('aria-hidden', 'true');
    children.push(top);
    if (initiative.active) {
      const round = doc.createElement('div');
      round.className = 'atlas-initiative-panel__round';
      round.textContent = `Round ${initiative.round}`;
      children.push(round);
    } else {
      const bottom = doc.createElement('div');
      bottom.className = 'atlas-initiative-panel__bottom-shade';
      bottom.setAttribute('aria-hidden', 'true');
      children.push(bottom);
    }
    panel.replaceChildren(...children);
    // Drawn anew on every change, scrolled to the start: the turn is brought back into view.
    const turn = list.querySelector<HTMLElement>('.atlas-initiative-side--active, .atlas-initiative-card--active');
    if (turn && initiative.active && list.scrollWidth > list.clientWidth) {
      const wanted = turn.offsetLeft + turn.offsetWidth + CARDS_PAST_TURN * (turn.offsetWidth + 4) - list.clientWidth;
      list.scrollLeft = Math.max(0, Math.min(wanted, turn.offsetLeft - 4));
    }
  }

  /** What a card is drawn from: its art (and whether it has arrived), its ring and what is drawn over it; a combatant without a token has only `image`. */
  private portraitKey(token: PlayerToken | undefined, image?: string | null): string {
    if (!token) return image ? `${image}|${this.options.images(image) ? 1 : 0}` : '';
    return `${token.image ?? ''}|${token.image && this.options.images(token.image) ? 1 : 0}|${token.ring ?? ''}|${token.downed === true ? 1 : 0}|${JSON.stringify(token.conditions)}|${token.instance ?? ''}`;
  }

  /** A side's cards under its name (Atlas's `atlas-initiative-side`), or the group of the delayed. */
  private group(name: string, active: boolean, delayed: boolean, cards: readonly HTMLElement[]): HTMLElement {
    const doc = this.options.panel.ownerDocument;
    const group = doc.createElement('div');
    group.className = 'atlas-initiative-side';
    group.setAttribute('role', 'list');
    group.setAttribute('aria-label', name);
    if (delayed) group.classList.add('atlas-initiative-side--delayed');
    if (active) {
      group.classList.add('atlas-initiative-side--active');
      group.setAttribute('aria-current', 'true');
    }
    const label = doc.createElement('div');
    label.className = 'atlas-initiative-side__label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = name;
    group.append(label, ...cards);
    return group;
  }

  /** One of the card's icons: lucide's strokes, as Atlas's `setIcon` draws them. */
  private icon(paths: readonly string[], extra?: (svg: SVGElement) => void): SVGElement {
    const doc = this.options.panel.ownerDocument;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    extra?.(svg);
    return svg;
  }

  private shape(svg: SVGElement, tag: 'circle' | 'rect', attributes: Record<string, string>): void {
    const element = this.options.panel.ownerDocument.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    svg.append(element);
  }

  /** Atlas's skull over a defeated combatant (`atlas-initiative-card__defeated-overlay`); the card is dimmed with it. */
  private skull(): HTMLElement {
    const overlay = this.options.panel.ownerDocument.createElement('div');
    overlay.className = 'atlas-initiative-card__defeated-overlay';
    overlay.setAttribute('role', 'img');
    overlay.setAttribute('aria-label', DEFEATED_LABEL);
    overlay.append(this.icon(SKULL_PATHS, (svg) => { for (const cx of [9, 15]) this.shape(svg, 'circle', { cx: String(cx), cy: '12', r: '1' }); }));
    return overlay;
  }

  /** The stand-in of a combatant with neither art nor a name to show. */
  private avatar(bot: boolean): HTMLElement {
    const avatar = this.options.panel.ownerDocument.createElement('div');
    avatar.className = 'atlas-initiative-card__avatar';
    avatar.append(bot
      ? this.icon(BOT_PATHS, (svg) => this.shape(svg, 'rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }))
      : this.icon(USER_PATHS, (svg) => this.shape(svg, 'circle', { cx: '12', cy: '7', r: '4' })));
    return avatar;
  }

  /** Atlas's condition badge (`createConditionBadge`): a disc in the condition's colour with its glyph, its number in a pip. */
  private badge(condition: PlayerCondition): HTMLElement {
    const doc = this.options.panel.ownerDocument;
    const badge = doc.createElement('span');
    badge.className = 'atlas-condition-badge';
    badge.setAttribute('aria-hidden', 'true');
    const color = condition.color && colorNumber(condition.color) !== null ? condition.color : NEUTRAL_BADGE_COLOR;
    if (isLightBadgeColor(colorNumber(color) ?? 0)) badge.classList.add('atlas-condition-badge--light');
    badge.style.setProperty('--atlas-condition-color', color);
    badge.style.setProperty('--atlas-condition-size', CONDITION_SIZE);
    const initial = Array.from((condition.name ?? '').trim())[0];
    if (condition.icon && Object.hasOwn(WIDGET_ICON_PATHS, condition.icon)) {
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', WIDGET_ICON_VIEW_BOX);
      svg.setAttribute('fill', 'currentColor');
      svg.setAttribute('aria-hidden', 'true');
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', WIDGET_ICON_PATHS[condition.icon as keyof typeof WIDGET_ICON_PATHS]);
      svg.append(path);
      badge.append(svg);
    } else if (initial) badge.append(initial.toLocaleUpperCase());
    if (condition.value !== null) {
      const value = doc.createElement('span');
      value.className = 'atlas-condition-badge__value';
      value.textContent = String(condition.value);
      badge.append(value);
    }
    return badge;
  }

  /** The card's conditions fanned down its left edge (Atlas's `CardConditions`), each named for assistive tech, the rest a count. */
  private conditions(card: HTMLElement, conditions: readonly PlayerCondition[]): void {
    const doc = this.options.panel.ownerDocument;
    card.classList.add('atlas-initiative-card--conditions');
    const row = doc.createElement('div');
    row.className = 'atlas-initiative-card__conditions';
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', 'Conditions');
    const nameOf = (condition: PlayerCondition): string => condition.name ?? condition.id;
    for (const condition of conditions.slice(0, SHOWN_CARD_CONDITIONS)) {
      const item = doc.createElement('span');
      item.className = 'atlas-initiative-card__condition';
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-label', condition.value !== null ? `${nameOf(condition)} ${condition.value}` : nameOf(condition));
      item.append(this.badge(condition));
      row.append(item);
    }
    if (conditions.length > SHOWN_CARD_CONDITIONS) {
      const rest = conditions.slice(SHOWN_CARD_CONDITIONS);
      const more = doc.createElement('span');
      more.className = 'atlas-initiative-card__condition-more';
      more.setAttribute('role', 'listitem');
      more.setAttribute('aria-label', rest.map(nameOf).join(', '));
      more.textContent = `+${rest.length}`;
      row.append(more);
    }
    card.append(row);
  }

  /** The token's art filling the card and the red of the life it lost rising in it (Atlas's `renderArt`); null without a picture. */
  private art(src: string | null, alt: string, framed: boolean, wound: number | null): HTMLElement | null {
    if (src === null) return null;
    const doc = this.options.panel.ownerDocument;
    const art = doc.createElement('div');
    art.className = 'atlas-initiative-card__art';
    if (framed) art.classList.add('atlas-initiative-card__art--framed');
    const img = doc.createElement('img');
    img.src = src;
    img.alt = alt;
    img.draggable = false;
    img.decoding = 'async';
    art.append(img);
    if (wound !== null) {
      const red = doc.createElement('div');
      red.className = 'atlas-initiative-wound';
      red.setAttribute('aria-hidden', 'true');
      red.style.setProperty('--atlas-wound', String(wound));
      art.append(red);
    }
    return art;
  }

  private card(entry: PlayerInitiativeEntry, { token, active }: CardLook): HTMLElement {
    const doc = this.options.panel.ownerDocument;
    const card = doc.createElement('div');
    card.className = 'atlas-initiative-card atlas-initiative-card--tile';
    card.setAttribute('role', 'listitem');
    if (active && entry.isActive) {
      card.classList.add('atlas-initiative-card--active');
      card.setAttribute('aria-current', 'true');
    }
    if (entry.sitsOut === true) card.classList.add('atlas-initiative-card--sitting-out');
    if (entry.delayed === true) card.classList.add('atlas-initiative-card--delayed');
    const side = token?.side ?? entry.side;
    // The players' own side is framed, so the sides read at a glance across the table
    if (side === 'players') card.classList.add('atlas-initiative-card--ally');
    // Its turn flashes in its token's ring colour
    if (token?.ring) card.style.setProperty('--atlas-turn-color', token.ring);
    // A click, Enter or Space on a combatant whose token players see brings that token into view.
    const { onFind } = this.options;
    const tokenId = entryTokenId(entry);
    if (onFind && token && tokenId !== undefined) {
      card.classList.add('is-findable');
      card.tabIndex = 0;
      card.addEventListener('click', () => onFind(tokenId));
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onFind(tokenId);
      });
    }
    // A combatant without a token has its art alone; the list is drawn from its own art, not the map's.
    const imageId = token ? token.image : tokenId === undefined ? entry.image ?? null : null;
    const decoded = imageId ? this.options.images(imageId) : null;
    const src = decoded ? pictureOf(decoded, doc) : null;
    const name = entry.name ?? '';
    // The life lost, red rising in the art: where players see hit points (`hpShare` is how full they are)
    const wound = typeof entry.hpShare === 'number' ? Math.min(1, Math.max(0, 1 - entry.hpShare)) : null;
    // A token whose art brings its own frame (no ring on the map) is cropped closer, so the frame falls outside the card
    const art = this.art(src, name, token !== undefined && token.ring === null, wound);
    if (art) {
      card.append(art);
      if (name) card.setAttribute('aria-label', name);
    }
    // A card without art has nothing but its name to tell it apart, where the GM shows it, else a stand-in
    if (!art && !entry.name) card.append(this.avatar(side === 'opponents' || (side === undefined && tokenId !== undefined)));
    // A defeated combatant (a resource that defeats it is spent, whether players see it or not) is greyed and marked, as Atlas's list does.
    if (token?.downed === true) {
      card.classList.add('atlas-initiative-card--defeated');
      card.append(this.skull());
    }
    // Atlas's badge shows the token's look-alike number.
    if (token?.instance !== undefined) {
      const marks = doc.createElement('span');
      marks.className = 'atlas-initiative-card__marks';
      const instance = doc.createElement('span');
      instance.className = 'atlas-initiative-card__instance-badge';
      instance.textContent = String(token.instance);
      instance.setAttribute('aria-label', `Number ${token.instance}`);
      marks.append(instance);
      card.append(marks);
    }
    if (!art && entry.name) {
      const label = doc.createElement('span');
      label.className = 'atlas-initiative-card__name';
      label.textContent = entry.name;
      card.append(label);
    }
    if (token && token.conditions.length > 0) this.conditions(card, token.conditions);
    return card;
  }
}
