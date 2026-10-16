/**
 * The Canvas 2D scene tab's elements: the map, the top bar (session, connection, Reconnect, the dice log button),
 * the Follow GM and Fit map buttons, the notes, the dice tray, the toolbar and the dice log. They
 * are the page's (`online-client/index.html`) without the name form, the players menu and the image settings,
 * which the join dialog and Obsidian's own settings replace. The class names are the page's, scoped by
 * `styles/online-scene-canvas.scss`.
 */
import type { HandoutViewOptions } from '../../../../online-client/handoutView.mts';
import { toolIconUrl, type ToolIconName } from '../page/toolIcons';

export interface SceneDom {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  sessionName: HTMLElement;
  connection: HTMLElement;
  message: HTMLElement;
  reconnect: HTMLButtonElement;
  diceLogButton: HTMLButtonElement;
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  moveNotice: HTMLElement;
  hoverCard: HTMLElement;
  initiative: HTMLElement;
  sheetButton: HTMLButtonElement;
  sheetPanel: HTMLElement;
  sheetClose: HTMLButtonElement;
  sheetTabs: HTMLElement;
  sheetBody: HTMLElement;
  handout: HandoutViewOptions;
  turnNotice: HTMLElement;
  diceToast: HTMLElement;
  diceTray: HTMLElement;
  toolbar: HTMLElement;
  diceLog: HTMLElement;
  diceLogClose: HTMLButtonElement;
  diceLogEmpty: HTMLElement;
  diceLogList: HTMLElement;
}

/** Atlas's icon in a CSS mask, in the colour of its button (`.tool-icon`). */
function icon(parent: HTMLElement, name: ToolIconName): void {
  const glyph = parent.createSpan({ cls: 'tool-icon', attr: { 'aria-hidden': 'true' } });
  glyph.setCssProps({ '--icon': toolIconUrl(name) });
}

/** One of the toolbar's icon buttons: Atlas's own tool-button shape, its name as the label and the tooltip. */
function toolButton(parent: HTMLElement, label: string, name: ToolIconName): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'tool-button', attr: { type: 'button', 'aria-label': label, 'data-label': label } });
  icon(button, name);
  return button;
}

export function buildSceneDom(parent: HTMLElement): SceneDom {
  const root = parent.createDiv({ cls: 'atlas-connect-scene table', attr: { role: 'region', 'aria-label': 'Scene' } });
  const canvas = root.createEl('canvas', { cls: 'atlas-connect-scene__map', attr: { role: 'img', 'aria-label': 'Map' } });
  const bar = root.createEl('header', { cls: 'top-bar' });
  // Two floating pills over the map, as Atlas's own toolbar floats: what the session is, and the dice log.
  const info = bar.createDiv({ cls: 'top-pill top-info' });
  const connection = info.createSpan({ cls: 'connection', attr: { role: 'status' } });
  const sessionName = info.createSpan({ cls: 'session-name' });
  const message = info.createSpan({ cls: 'connection scene-message' });
  const reconnect = info.createEl('button', { cls: 'secondary', text: 'Reconnect', attr: { type: 'button' } });
  reconnect.hidden = true;
  const actions = bar.createDiv({ cls: 'top-pill top-actions' });
  const diceLogButton = actions.createEl('button', {
    cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Dice log', 'aria-expanded': 'false' },
  });
  // Under the dice log's: the player's sheets, while they have any.
  const sheetButton = actions.createEl('button', {
    cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Your sheets', 'aria-expanded': 'false' },
  });
  sheetButton.hidden = true;
  const handoutButton = actions.createEl('button', {
    cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Shown image', 'aria-expanded': 'false' },
  });
  handoutButton.hidden = true;
  // Follow GM and Fit map are icon buttons of the toolbar: they start here and the scene moves them into it once the toolbar
  // has drawn its own controls (`CanvasScene`).
  const viewButtons = root.createDiv({ cls: 'toolbar-item view-buttons' });
  viewButtons.hidden = true;
  const followButton = toolButton(viewButtons, 'Follow GM', 'locate-fixed');
  const fitButton = toolButton(viewButtons, 'Fit map', 'maximize');
  const stack = root.createDiv({ cls: 'top-stack' });
  const notes = stack.createDiv({ cls: 'top-notes' });
  const turnNotice = notes.createEl('p', { cls: 'turn-notice', attr: { role: 'status' } });
  turnNotice.hidden = true;
  const moveNotice = notes.createEl('p', { cls: 'move-notice', attr: { role: 'status' } });
  moveNotice.hidden = true;
  const diceToast = notes.createDiv({ cls: 'dice-toasts', attr: { 'aria-live': 'polite' } });
  diceToast.hidden = true;
  const diceTray = root.createDiv({ cls: 'dice-tray', attr: { role: 'group', 'aria-label': 'Dice tray' } });
  diceTray.hidden = true;
  const toolbar = root.createEl('nav', { cls: 'toolbar', attr: { 'aria-label': 'Tools' } });
  // The image the GM shows players (`HandoutView`).
  const handout = root.createEl('section', { cls: 'handout', attr: { 'aria-label': 'Shown image' } });
  handout.hidden = true;
  const handoutHeader = handout.createDiv({ cls: 'handout-header' });
  const handoutTitle = handoutHeader.createEl('h2');
  const handoutClose = handoutHeader.createEl('button', { cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Close image' } });
  icon(handoutClose, 'x');
  const handoutStatus = handout.createEl('p', { cls: 'handout-status', text: 'Loading…' });
  const handoutCanvas = handout.createEl('canvas', { cls: 'handout-canvas', attr: { role: 'img', 'aria-label': 'Shown image' } });
  // The token card under the mouse (`HoverCardView`), placed in the window's coordinates.
  const hoverCard = root.createDiv({ cls: 'hover-card' });
  hoverCard.hidden = true;
  // The fight's order, as Atlas's player window floats it at the right edge (`InitiativeView`).
  const initiative = root.createDiv({ cls: 'initiative-panel', attr: { role: 'region', 'aria-label': 'Initiative order' } });
  initiative.hidden = true;
  const diceLog = root.createEl('aside', { cls: 'dice-log', attr: { 'aria-label': 'Dice log' } });
  diceLog.hidden = true;
  const header = diceLog.createDiv({ cls: 'dice-log-header' });
  // A chevron on the pane's left edge, pointing the way the drawer goes.
  const diceLogClose = header.createEl('button', { cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Close dice log' } });
  icon(diceLogClose, 'chevron-right');
  header.createEl('h2', { text: 'Dice log' });
  const diceLogEmpty = diceLog.createEl('p', { cls: 'dice-log-empty', text: 'No rolls yet' });
  const diceLogList = diceLog.createEl('ol', { cls: 'dice-log-list', attr: { 'aria-label': 'Rolls' } });
  // The player's sheets (`SheetView`): the same drawer as the dice log.
  const sheetPanel = root.createEl('aside', { cls: 'sheet-panel', attr: { 'aria-label': 'Your sheets' } });
  sheetPanel.hidden = true;
  const sheetHeader = sheetPanel.createDiv({ cls: 'sheet-header' });
  const sheetClose = sheetHeader.createEl('button', { cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Close sheets' } });
  icon(sheetClose, 'chevron-right');
  sheetHeader.createEl('h2', { text: 'Your sheets' });
  const sheetTabs = sheetPanel.createDiv({ cls: 'sheet-tabs' });
  sheetTabs.hidden = true;
  const sheetBody = sheetPanel.createDiv({ cls: 'sheet-body' });
  return {
    root, canvas, sessionName, connection, message, reconnect, diceLogButton, viewButtons, followButton, fitButton, moveNotice,
    diceToast, diceTray, toolbar, diceLog, diceLogClose, diceLogEmpty, diceLogList, hoverCard, turnNotice, initiative,
    sheetButton, sheetPanel, sheetClose, sheetTabs, sheetBody,
    handout: { panel: handout, title: handoutTitle, canvas: handoutCanvas, status: handoutStatus, closeButton: handoutClose, openButton: handoutButton },
  };
}
