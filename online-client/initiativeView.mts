// online-client/initiativeView.mts
/**
 * The initiative list as Atlas's player window shows it (`playerInitiativeList.ts`, `player-initiative.scss`): a
 * column floating at the right edge, one card per combatant in turn order, each a square portrait of the token in its
 * ring, the initiative value, the name where nameplates show, and a thin green bar of its hit points where players see
 * them; the combatant whose turn it is takes the accent, one that sits out the round is faded, and "Round N" closes the
 * list while a fight runs, the turn kept in view. By sides, the combatants stand under their side's name, the side
 * whose turn it is in the accent, with no values. Text only, never markup: everything comes from the GM. Shared with
 * the Obsidian scene tab.
 */
import { computeTokenPixelSize, computeTokenStrokeWidth, getTokenRingOuterDiameter } from '@atlas-vtt/shared/draw';
import { SIDE_LABELS, sidesInOrder } from '@atlas-vtt/shared/rules';
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';
import { listedSide } from '../src/app/online/scene/initiativeSides';
import type { PlayerInitiativeEntry, PlayerScene, PlayerSideRow, PlayerToken } from '../src/app/online/scene/sceneTypes';
import { createCanvasSurface } from '../src/app/online/view/canvasSurface';

/** A portrait's canvas is drawn this many device pixels across: sharp at the card's width on a dense screen. */
const PORTRAIT_PIXELS = 160;
/** A portrait is drawn as a medium token on Atlas's reference grid, so its ring has the map's proportions. */
const REFERENCE_CELL = 70;
/** The heading of the group of combatants that delayed their turn (Atlas's `playerInit.delayed`). */
const DELAYED_LABEL = 'Delayed';
/** The label of the skull on a defeated combatant's card (Atlas's `playerInit.defeated`). */
const DEFEATED_LABEL = 'Defeated';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Lucide's skull, the icon Atlas marks a defeated combatant with (its eyes are drawn apart). */
const SKULL_PATHS = ['m12.5 17-.5-1-.5 1h1z', 'M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z'];

export interface InitiativeViewOptions {
  /** The column; hidden while there is no fight to show. */
  panel: HTMLElement;
  /** A decoded token image by asset id, or null while it has not arrived. */
  images(assetId: string): DecodedImage | null;
  /** Called with the token of a combatant a player clicked (Atlas 0.9.1: the click finds the token); without it the cards do nothing. */
  onFind?: (tokenId: string) => void;
}

export class InitiativeView {
  /** What the column was last drawn from, so a scene patch that changes nothing of it draws nothing. */
  private drawn = '';

  constructor(private readonly options: InitiativeViewOptions) {
    options.panel.hidden = true;
  }

  /** Draws the column for `scene`; again after images arrived or the ring texture loaded (`force`). */
  update(scene: PlayerScene | null, force = false): void {
    const { panel } = this.options;
    const initiative = scene?.initiative ?? null;
    if (!scene || !initiative || initiative.entries.length === 0) {
      this.drawn = '';
      panel.replaceChildren();
      panel.hidden = true;
      return;
    }
    const key = JSON.stringify([initiative, initiative.entries.map((entry) => this.portraitKey(scene.tokens[entry.tokenId]))]);
    if (key === this.drawn && !force) return;
    this.drawn = key;
    panel.hidden = false;
    const doc = panel.ownerDocument;
    const list = doc.createElement('div');
    list.className = 'initiative-list';
    list.setAttribute('role', 'list');
    const tokenOf = (entry: PlayerInitiativeEntry): PlayerToken | undefined => (Object.hasOwn(scene.tokens, entry.tokenId) ? scene.tokens[entry.tokenId] : undefined);
    const { sides } = initiative;
    if (sides) {
      // Atlas's own list of sides, in the order they act; from an older GM, the two built-in sides, `first` first.
      const rows: readonly PlayerSideRow[] = initiative.sideList
        ?? sidesInOrder(sides.first).map((side) => ({ id: side, name: SIDE_LABELS[side], ...(sides.active === side && { turn: true as const }) }));
      for (const row of rows) {
        const members = initiative.entries.filter((entry) => listedSide(scene.tokens, entry) === row.id);
        if (members.length === 0) continue;
        const group = doc.createElement('div');
        group.className = 'initiative-side';
        group.setAttribute('role', 'list');
        group.setAttribute('aria-label', row.roll !== undefined ? `${row.name}, rolled ${row.roll}` : row.name);
        if (row.turn === true) {
          group.classList.add('is-active');
          group.setAttribute('aria-current', 'true');
        }
        const label = doc.createElement('div');
        label.className = 'initiative-side-label';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = row.name;
        if (row.roll !== undefined) {
          const roll = doc.createElement('span');
          roll.className = 'initiative-side-roll';
          roll.textContent = String(row.roll);
          label.append(roll);
        }
        group.append(label, ...members.map((entry) => this.card(entry, tokenOf(entry), false, false)));
        list.append(group);
      }
    } else {
      // In turn order, a combatant that delayed its turn is listed apart, after the order, as Atlas's list does.
      const waiting = initiative.entries.filter((entry) => entry.delayed === true);
      list.append(...initiative.entries.filter((entry) => entry.delayed !== true).map((entry) => this.card(entry, tokenOf(entry), initiative.active, true)));
      if (waiting.length > 0) {
        const group = doc.createElement('div');
        group.className = 'initiative-side';
        group.setAttribute('role', 'list');
        group.setAttribute('aria-label', DELAYED_LABEL);
        const label = doc.createElement('div');
        label.className = 'initiative-side-label';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = DELAYED_LABEL;
        group.append(label, ...waiting.map((entry) => this.card(entry, tokenOf(entry), false, true)));
        list.append(group);
      }
    }
    const children: HTMLElement[] = [list];
    if (initiative.active) {
      const round = doc.createElement('div');
      round.className = 'initiative-round';
      round.textContent = `Round ${initiative.round}`;
      children.push(round);
    }
    panel.replaceChildren(...children);
    // Drawn anew on every change, scrolled to the top: the turn is brought back into view.
    const turn = list.querySelector<HTMLElement>('.initiative-side.is-active, .initiative-card.is-active');
    if (turn && list.scrollHeight > list.clientHeight) list.scrollTop = Math.max(0, turn.offsetTop - list.offsetTop - 4);
  }

  /** What a portrait is drawn from: its image (and whether it has arrived) and its ring. */
  private portraitKey(token: PlayerToken | undefined): string {
    if (!token) return '';
    return `${token.image ?? ''}|${token.image && this.options.images(token.image) ? 1 : 0}|${token.ring ?? ''}|${token.downed === true ? 1 : 0}`;
  }

  /** Atlas's mark of a defeated combatant (`atlas-player-initiative__defeated`): a skull, over the portrait when there is one. */
  private skull(over: boolean): HTMLElement {
    const doc = this.options.panel.ownerDocument;
    const mark = doc.createElement('span');
    mark.className = over ? 'initiative-defeated initiative-defeated--over' : 'initiative-defeated';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', DEFEATED_LABEL);
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of SKULL_PATHS) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    for (const cx of [9, 15]) {
      const eye = doc.createElementNS(SVG_NS, 'circle');
      eye.setAttribute('cx', String(cx));
      eye.setAttribute('cy', '12');
      eye.setAttribute('r', '1');
      svg.append(eye);
    }
    mark.append(svg);
    return mark;
  }

  private card(entry: PlayerInitiativeEntry, token: PlayerToken | undefined, fightActive: boolean, showValue: boolean): HTMLElement {
    const doc = this.options.panel.ownerDocument;
    const card = doc.createElement('div');
    card.className = 'initiative-card';
    card.setAttribute('role', 'listitem');
    if (fightActive && entry.isActive) {
      card.classList.add('is-active');
      card.setAttribute('aria-current', 'true');
    }
    if (entry.sitsOut === true) card.classList.add('is-sitting-out');
    // A click, Enter or Space on a combatant whose token players see brings that token into view.
    const { onFind } = this.options;
    if (onFind && token) {
      card.classList.add('is-findable');
      card.tabIndex = 0;
      card.addEventListener('click', () => onFind(entry.tokenId));
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onFind(entry.tokenId);
      });
    }
    const portrait = token ? this.portrait(token, entry.name ?? '') : null;
    if (portrait) card.append(portrait);
    // A defeated combatant (a resource that defeats it is spent, whether players see it or not) is greyed and marked, as Atlas's list does.
    if (token?.downed === true) {
      card.classList.add('is-defeated');
      card.append(this.skull(portrait !== null));
    }
    if (showValue) {
      const value = doc.createElement('span');
      value.className = 'initiative-value';
      value.textContent = entry.awaiting === true ? '–' : String(entry.initiative);
      card.append(value);
    }
    if (entry.name) {
      const name = doc.createElement('span');
      name.className = 'initiative-name';
      name.textContent = entry.name;
      card.append(name);
    }
    if (typeof entry.hpShare === 'number') {
      const hp = doc.createElement('progress');
      hp.className = 'initiative-hp';
      hp.max = 1;
      hp.value = Math.max(0, Math.min(1, entry.hpShare));
      hp.setAttribute('aria-label', 'HP');
      card.append(hp);
    }
    return card;
  }

  /** The token's art in its ring, as the map draws it; null without art to draw. */
  private portrait(token: PlayerToken, name: string): HTMLCanvasElement | null {
    const art = token.image ? this.options.images(token.image) : null;
    if (!art && token.ring === null) return null;
    const canvas = this.options.panel.ownerDocument.createElement('canvas');
    canvas.className = 'initiative-portrait';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', name);
    const surface = createCanvasSurface(canvas);
    if (!surface) return null;
    const size = computeTokenPixelSize(REFERENCE_CELL, 1);
    const stroke = computeTokenStrokeWidth(REFERENCE_CELL);
    const outer = token.ring !== null ? getTokenRingOuterDiameter(size, stroke, 1) : size;
    surface.begin(PORTRAIT_PIXELS, PORTRAIT_PIXELS, null);
    surface.setCamera(PORTRAIT_PIXELS / outer, PORTRAIT_PIXELS / 2, PORTRAIT_PIXELS / 2);
    if (art) {
      const scale = Math.max(size / art.width, size / art.height);
      surface.image(art.image, (-art.width * scale) / 2, (-art.height * scale) / 2, art.width * scale, art.height * scale, { x: 0, y: 0, radius: size / 2 });
    }
    if (token.ring !== null) surface.tokenRing(0, 0, outer, size, token.ring);
    return canvas;
  }
}
