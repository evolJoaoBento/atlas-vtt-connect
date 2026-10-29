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
import type { PlayerInitiativeEntry, PlayerScene, PlayerToken } from '../src/app/online/scene/sceneTypes';
import { createCanvasSurface } from '../src/app/online/view/canvasSurface';

/** A portrait's canvas is drawn this many device pixels across: sharp at the card's width on a dense screen. */
const PORTRAIT_PIXELS = 160;
/** A portrait is drawn as a medium token on Atlas's reference grid, so its ring has the map's proportions. */
const REFERENCE_CELL = 70;

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
      for (const side of sidesInOrder(sides.first)) {
        const members = initiative.entries.filter((entry) => (tokenOf(entry)?.side ?? 'opponents') === side);
        if (members.length === 0) continue;
        const group = doc.createElement('div');
        group.className = 'initiative-side';
        group.setAttribute('role', 'list');
        group.setAttribute('aria-label', SIDE_LABELS[side]);
        if (sides.active === side) {
          group.classList.add('is-active');
          group.setAttribute('aria-current', 'true');
        }
        const label = doc.createElement('div');
        label.className = 'initiative-side-label';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = SIDE_LABELS[side];
        group.append(label, ...members.map((entry) => this.card(entry, tokenOf(entry), false, false)));
        list.append(group);
      }
    } else {
      list.append(...initiative.entries.map((entry) => this.card(entry, tokenOf(entry), initiative.active, true)));
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
    return `${token.image ?? ''}|${token.image && this.options.images(token.image) ? 1 : 0}|${token.ring ?? ''}`;
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
    if (showValue) {
      const value = doc.createElement('span');
      value.className = 'initiative-value';
      value.textContent = String(entry.initiative);
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
