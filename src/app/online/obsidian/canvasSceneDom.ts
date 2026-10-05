/**
 * The Canvas 2D scene tab's elements: the map, the top bar (session, connection, Reconnect, the dice log button),
 * the Follow GM and Fit map buttons, the notes, the dice tray, the toolbar and the dice log. They
 * are the page's (`online-client/index.html`) without the name form, the players menu and the image settings,
 * which the join dialog and Obsidian's own settings replace. The class names are the page's, scoped by
 * `styles/online-scene-canvas.scss`.
 */
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
  diceToast: HTMLButtonElement;
  diceTray: HTMLElement;
  toolbar: HTMLElement;
  diceLog: HTMLElement;
  diceLogClose: HTMLButtonElement;
  diceLogEmpty: HTMLElement;
  diceLogList: HTMLElement;
}

export function buildSceneDom(parent: HTMLElement): SceneDom {
  const root = parent.createDiv({ cls: 'atlas-connect-scene table', attr: { role: 'region', 'aria-label': 'Scene' } });
  const canvas = root.createEl('canvas', { cls: 'atlas-connect-scene__map', attr: { role: 'img', 'aria-label': 'Map' } });
  const bar = root.createEl('header', { cls: 'top-bar' });
  const sessionName = bar.createSpan({ cls: 'session-name' });
  const connection = bar.createSpan({ cls: 'connection', attr: { role: 'status' } });
  const message = bar.createSpan({ cls: 'connection scene-message' });
  const reconnect = bar.createEl('button', { cls: 'secondary', text: 'Reconnect', attr: { type: 'button' } });
  reconnect.hidden = true;
  const diceLogButton = bar.createEl('button', {
    cls: 'icon-button', attr: { type: 'button', 'aria-label': 'Dice log', 'aria-expanded': 'false' },
  });
  const viewButtons = root.createDiv({ cls: 'view-buttons' });
  viewButtons.hidden = true;
  const followButton = viewButtons.createEl('button', { text: 'Follow GM', attr: { type: 'button' } });
  const fitButton = viewButtons.createEl('button', { cls: 'secondary', text: 'Fit map', attr: { type: 'button' } });
  const stack = root.createDiv({ cls: 'top-stack' });
  const notes = stack.createDiv({ cls: 'top-notes' });
  const moveNotice = notes.createEl('p', { cls: 'move-notice', attr: { role: 'status' } });
  moveNotice.hidden = true;
  const diceToast = notes.createEl('button', { cls: 'dice-toast', attr: { type: 'button', 'aria-live': 'polite' } });
  diceToast.hidden = true;
  const diceTray = root.createDiv({ cls: 'dice-tray', attr: { role: 'group', 'aria-label': 'Dice tray' } });
  diceTray.hidden = true;
  const toolbar = root.createEl('nav', { cls: 'toolbar', attr: { 'aria-label': 'Tools' } });
  const diceLog = root.createEl('aside', { cls: 'dice-log', attr: { 'aria-label': 'Dice log' } });
  diceLog.hidden = true;
  const header = diceLog.createDiv({ cls: 'dice-log-header' });
  header.createEl('h2', { text: 'Dice log' });
  const diceLogClose = header.createEl('button', { cls: 'icon-button', text: '×', attr: { type: 'button', 'aria-label': 'Close dice log' } });
  const diceLogEmpty = diceLog.createEl('p', { cls: 'dice-log-empty', text: 'No rolls yet' });
  const diceLogList = diceLog.createEl('ol', { cls: 'dice-log-list', attr: { 'aria-label': 'Rolls' } });
  return {
    root, canvas, sessionName, connection, message, reconnect, diceLogButton, viewButtons, followButton, fitButton, moveNotice,
    diceToast, diceTray, toolbar, diceLog, diceLogClose, diceLogEmpty, diceLogList,
  };
}
