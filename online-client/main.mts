// online-client/main.mts
/**
 * The join page: the name form, the session, image loading, the map and the player's tools.
 * The logic lives in tested shared modules under `src/app/online/` and the tested views beside
 * this file; this file finds the page's elements and connects them.
 */
import { AssetCache } from '../src/app/online/assets/AssetCache';
import { AssetLoader } from '../src/app/online/assets/AssetLoader';
import { openIndexedDbImageStore } from '../src/app/online/assets/indexedDbImageStore';
import { randomId } from '../src/app/online/ids';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { keptPlayerKey, pageKey, readKept } from '../src/app/online/page/pageStorage';
import { createOnlineLog } from '../src/app/online/onlineLog';
import { loadDiceDisplay, saveDiceDisplay } from '../src/app/online/page/diceDisplayStore';
import { loadLaserColor, loadLaserSize, saveLaserColor, saveLaserSize } from '../src/app/online/page/laserColorStore';
import { OwnRollThrows } from '../src/app/online/page/ownRollThrows';
import { browserDomHost } from './dice3d/browserDomHost.mts';
import { INCOMPLETE_LINK_TEXT, NAME_PROBLEM_TEXT, NO_CANVAS_TEXT, pageScreen, type PageScreen } from '../src/app/online/page/pageScreen';
import type { PlayerSession, PlayerSessionState } from '../src/app/online/PlayerSession';
import { createJoinSession } from '../src/app/online/preview/joinSession';
import { playerLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import { normalizePlayerName } from '../src/app/online/protocol';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { AssetsPanel, rememberedKeep } from './assetsPanel.mts';
import { createCanvasSurface } from '../src/app/online/view/canvasSurface';
import { DiceDisplayView } from './diceDisplayView.mts';
import { DiceLogView } from './diceLogView.mts';
import { SheetView } from './sheetView.mts';
import { DiceTrayView } from './diceTrayView.mts';
import { fillList } from './fillList.mts';
import { decodeImage } from './imageDecoder.mts';
import { MapView, type MapViewOptions } from './mapView.mts';
import { SceneSwitch } from './sceneSwitch.mts';
import { BoardSceneView } from '../src/app/online/obsidian/BoardSceneView';
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';
import type { AssetMime } from '../src/app/online/assets/assetIds';
import { Menu } from './menu.mts';
import { PageToolbar } from './toolbar.mts';

const VERSION = '0.1.0';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const screen = element<HTMLElement>('screen');
const form = element<HTMLFormElement>('join');
const nameInput = element<HTMLInputElement>('name');
const rememberName = element<HTMLInputElement>('remember-name');
const status = element<HTMLParagraphElement>('status');
const waitingLoader = element<HTMLElement>('loader');
const table = element<HTMLElement>('table');
const sessionName = element<HTMLElement>('session-name');
const connection = element<HTMLElement>('connection');
const playerList = element<HTMLUListElement>('players');
const widgetList = element<HTMLUListElement>('widgets');
const canvas = element<HTMLCanvasElement>('map');

const cache = new AssetCache({ keep: rememberedKeep(), openStore: openIndexedDbImageStore });
const panel = new AssetsPanel(cache);
new Menu(element<HTMLButtonElement>('menu-button'), element<HTMLElement>('menu'), element<HTMLButtonElement>('menu-close'));
const surface = createCanvasSurface(canvas);
const boardEl = element<HTMLElement>('board-3d');
const followButton = element<HTMLButtonElement>('follow-gm');
const fitButton = element<HTMLButtonElement>('fit-map');
/** Set once the player joins; until then a drop, a laser or a roll has nowhere to go. */
let session: PlayerSession | null = null;
// The lookup runs at draw time, in a later animation frame, so `loader` below is already set;
// it asks the loader every time, so a released image is never drawn.
const mapOptions = (): MapViewOptions => ({
    canvas, surface: createCanvasSurface(canvas) ?? surface!, images: (id) => loader.image(id),
    viewButtons: element('view-buttons'), followButton, fitButton,
    sendMove: (tokenId, x, y) => session?.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: (points, lifted, dt, color, size) => session?.sendLaser(points, lifted, dt, color, size) ?? false,
    sendPing: (x, y) => session?.sendPing(x, y) ?? false,
    sendTemplate: (change) => session?.sendTemplate(change) ?? false,
    laserColor: loadLaserColor(() => localStorage),
    onLaserColor: (color) => saveLaserColor(color, () => localStorage),
    laserSize: loadLaserSize(() => localStorage),
    onLaserSize: (size) => saveLaserSize(size, () => localStorage),
    notice: element('move-notice'),
    hoverCard: element('hover-card'),
    turnNotice: element('turn-notice'),
    initiative: element('initiative-panel'),
    statblockPreview: element('statblock-preview'),
    handout: {
      panel: element('handout'), title: element('handout-title'), canvas: element('handout-canvas'),
      status: element('handout-status'), closeButton: element('handout-close'), openButton: element('handout-button'),
    },
    note: { panel: element('note-panel'), title: element('note-title'), body: element('note-body'), closeButton: element('note-close') },
    requestNote: (pinId) => session?.sendNoteRequest(pinId) ?? false,
    onToolsChange: () => syncToolbar(),
  });
/** An image's URL, for Tabletop's board (which loads its textures by URL): the page's decoder gives one. */
const urlOf = (image: (DecodedImage & { url?: string }) | null): string | null => image?.url ?? null;
// The 2D map, or Tabletop's 3D board while the GM offers it (its code loads with the first offer).
const map: SceneSwitch | null = surface
  ? new SceneSwitch({
    makeMap: () => new MapView(mapOptions()),
    makeBoard: (factory, parent) => new BoardSceneView({
      parent, factory,
      image: (id) => loader.image(id),
      imageUrl: (id) => urlOf(loader.image(id)),
      model: (id) => loader.model(id),
      sendMove: (tokenId, x, y) => session?.sendTokenMove(tokenId, x, y) ?? false,
      sendLaser: (points, lifted, dt, color, size) => session?.sendLaser(points, lifted, dt, color, size) ?? false,
      sendPing: (x, y) => session?.sendPing(x, y) ?? false,
      sendTemplate: (change) => session?.sendTemplate(change) ?? false,
      sendSpell: (change) => session?.sendSpell(change) ?? false,
      onEyeChange: () => map?.eyesChanged(),
      requestNote: (pinId) => session?.sendNoteRequest(pinId) ?? false,
      onToolsChange: () => syncToolbar(),
      hoverCard: element('hover-card'),
      statblockPreview: element('statblock-preview'),
      initiative: element('initiative-panel'),
      turnNotice: element('turn-notice'),
      handout: {
        panel: element('handout'), title: element('handout-title'), canvas: element('handout-canvas'),
        status: element('handout-status'), closeButton: element('handout-close'), openButton: element('handout-button'),
      },
      note: { panel: element('note-panel'), title: element('note-title'), body: element('note-body'), closeButton: element('note-close') },
      doc: document,
    }),
    loadBoard: () => import('./tabletopBoard.mts').then((chunk) => chunk.webPlayerBoard()),
    canvas, boardEl,
    dimensionButton: element('dimension-button'),
    eyeButton: element('eye-button'),
    eyeMenu: element('eye-menu'),
    ar: { button: element('ar-button'), panel: element('ar-panel'), video: element('ar-video'), overlay: element('table') },
    viewButtons: element('view-buttons'),
    requestBoard: (on) => {
      // Back to 2D: the board's materials and models are let go.
      if (!on) loader.setBoard(null);
      return session?.sendBoardRequest(on) ?? false;
    },
    onViewChange: () => {
      // The board draws minis: their models are asked for now (or let go).
      if (scene) loader.setScene(scene);
      syncToolbar();
    },
    tokenName: (tokenId) => scene?.tokens[tokenId]?.name ?? 'Token',
    sendArView: (pose) => session?.sendArView(pose) ?? false,
    sendArSurvey: (survey) => session?.sendArSurvey(survey) ?? false,
    onError: (message, error) => { console.warn(message, error); },
  })
  : null;
// On the board, Follow GM and Fit map are the board's (the 2D map listens to them itself).
followButton.addEventListener('click', () => { if (map?.showsBoard) map.followGm(); });
fitButton.addEventListener('click', () => { if (map?.showsBoard) map.fitMap(); });
const diceTray = new DiceTrayView({
  root: element('dice-tray'),
  roll: (dice, modifier, advantage) => session?.sendDiceRoll(dice, modifier, advantage) ?? false,
  onClose: () => setDiceOpen(false),
});
const diceDisplay = new DiceDisplayView(element('dice-display'), loadDiceDisplay(() => localStorage), (display) => {
  saveDiceDisplay(display, () => localStorage);
});
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
// Each player sees their own rolls thrown; three.js and the dice load with the first throw.
const ownRolls = new OwnRollThrows({
  container: element('dice-throws'),
  display: () => diceDisplay.value,
  reducedMotion: () => reducedMotion?.matches === true,
  // Atlas's dice draw through a DOM host (API 1.17.0): the page's is installed with them, in their own chunk.
  load: () => import('@atlas-vtt/shared/dice3d').then(({ installDomHost }) => {
    installDomHost(browserDomHost());
    return import('./dice3d/diceThrows.mts');
  }).then((chunk) => chunk.diceThrows),
  fallback: (entry) => diceLog.log.toastRoll(entry),
});
const sheets = new SheetView({
  panel: element('sheet-panel'), body: element('sheet-body'), tabs: element('sheet-tabs'),
  closeButton: element('sheet-close'), toggleButton: element('sheet-button'),
  onRoll: (tokenId, roll) => session?.sendSheetRoll(tokenId, roll) ?? false,
});
const diceLog = new DiceLogView({
  panel: element('dice-log'), list: element('dice-log-list'), empty: element('dice-log-empty'),
  closeButton: element('dice-log-close'), toggleButton: element('dice-log-button'), toast: element('dice-toast'),
  onOwnRoll: (entry) => ownRolls.handle(entry),
});
const toolbar = new PageToolbar({
  root: element('toolbar'),
  onTool: (tool) => map?.selectTool(tool),
  onShape: (shape) => map?.selectShape(shape),
  onTemplateShape: (shape) => map?.selectTemplateShape(shape),
  onClearTemplates: () => map?.clearOwnTemplates(),
  onLaserColor: (color) => {
    map?.selectLaserColor(color);
    saveLaserColor(color, () => localStorage);
    session?.sendColor(color);
  },
  onLaserSize: (size) => map?.selectLaserSize(size),
  onDice: () => setDiceOpen(!diceTray.isOpen),
});
// The board's own buttons (2D/3D, Eyes, AR) at the toolbar's end.
toolbar.addGroup(element('board-buttons'));
let assetsFrame: number | null = null;
/** The page's images, each with a URL of its bytes too (Tabletop's board loads textures by URL). */
async function decodeWithUrl(bytes: ArrayBuffer, mime: AssetMime): Promise<DecodedImage | null> {
  const decoded = await decodeImage(bytes, mime);
  if (!decoded) return null;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  return { ...decoded, url, release: () => { decoded.release?.(); URL.revokeObjectURL(url); } } as DecodedImage;
}
const loader: AssetLoader = new AssetLoader({
  cache,
  decode: decodeWithUrl,
  // Minis' and props' models only while Tabletop's board draws them.
  models: () => map?.showsBoard === true,
  // This page plays an animated map's video.
  video: () => true,
  // Chunks arrive many times a second: the bar and the map update at most once per frame.
  onChange: () => {
    if (assetsFrame !== null) return;
    assetsFrame = window.requestAnimationFrame(() => {
      assetsFrame = null;
      panel.showProgress(loader.progress());
      map?.refresh();
    });
  },
});
let sessionState: PlayerSessionState | null = null;
let scene: PlayerScene | null = null;
let started = false;

/** Diagnostics: run `localStorage.setItem('atlas-vtt-connect:log', 'on')` in this page's console; the switch is read on every event, so no reload is needed. */
const log = createOnlineLog(() => {
  try {
    return readKept(localStorage, 'log') === 'on';
  } catch {
    return false;
  }
});
// An open tray takes Escape first, before the map returns to Move.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !diceTray.isOpen) return;
  event.stopImmediatePropagation();
  setDiceOpen(false);
}, { capture: true });
let tableShown = false;
let shownScene: PlayerScene | null = null;

/** The dice tray hangs from the toolbar's Dice button. */
function setDiceOpen(open: boolean): void {
  diceTray.setOpen(open);
  syncToolbar();
}

/** The toolbar shows the map's tool and shape, and whether the tray is open. */
function syncToolbar(): void {
  toolbar.update({ ...(map?.toolState() ?? {}), diceOpen: diceTray.isOpen });
}

/** localStorage can throw in private windows; the page still works without it. */
function stored(name: string, fallback: () => string): string {
  try {
    const value = readKept(localStorage, name) ?? fallback();
    localStorage.setItem(pageKey(name), value);
    return value;
  } catch {
    return fallback();
  }
}

/** This GM session's player key; only the newest sessions keep theirs (`keptPlayerKey`). */
function playerKeyFor(hostId: string): string {
  try {
    return keptPlayerKey(localStorage, hostId, randomId);
  } catch {
    return randomId();
  }
}

function show(view: PageScreen): void {
  screen.hidden = view.kind === 'table';
  table.hidden = view.kind !== 'table';
  form.hidden = view.kind !== 'form' || started;
  if (view.kind === 'message') status.textContent = view.text;
  // A spinner while the page waits on the GM or the connection, so it does not look stuck.
  waitingLoader.hidden = !(view.kind === 'message' && view.loading === true);
  if (view.kind === 'table') {
    sessionName.textContent = view.title;
    connection.textContent = view.connection;
    connection.dataset.state = view.connection === 'Connected' ? 'ok' : 'wait';
    // The canvas and the toolbar have their sizes only once the table is shown; after that they follow resizes.
    if (!tableShown) {
      map?.measure();
      toolbar.fit();
      // Measured again once the page has laid the table out: a browser that was not painting while the GM answered must
      // still show the table by itself, with no click needed to wake it.
      for (const wait of [150, 600, 1500]) window.setTimeout(() => { map?.measure(); toolbar.fit(); }, wait);
    }
  }
  tableShown = view.kind === 'table';
}

function render(state: PlayerSessionState): void {
  log.event('status', { status: state.status, reason: state.reason, players: state.players.length });
  sessionState = state;
  // Only an admitted player drags tokens and uses the tools: reconnecting or ended cancels a gesture.
  map?.setConnected(state.status === 'admitted');
  // The session's order of players decides whose laser has which colour.
  map?.setPlayers(state.players.map((player) => player.playerId), state.playerId);
  let ended = false;
  if (state.status === 'denied' || state.status === 'lost') {
    // The session is over for good: free the decoded images and hide the loading bar.
    loader.dispose();
    panel.showProgress(loader.progress());
    setDiceOpen(false);
    diceLog.setOpen(false);
    diceLog.dispose();
    ended = true;
  }
  fillList(playerList, playerLines(state.players));
  renderScene();
  // The scene is cleared from the view first; then it stops drawing and frees the fog image.
  if (ended) map?.dispose();
}

/** The map, and the widget and initiative lists, shown only on the table screen. */
function renderScene(): void {
  const view = pageScreen(sessionState, scene !== null);
  show(view);
  const shown = view.kind === 'table' ? scene : null;
  // Presence updates arrive often; the view only hears of a scene that changed.
  if (shown !== shownScene) {
    shownScene = shown;
    map?.setScene(shown);
  }
  fillList(widgetList, shown ? widgetLines(shown.widgets) : []);
  // Read-only, for checking in the developer tools what this page received.
  (window as unknown as { atlasScene: PlayerScene | null }).atlasScene = shown;
}

// Back in front after being behind another window: draw what arrived meanwhile.
window.addEventListener('focus', () => { map?.measure(); });
window.addEventListener('pageshow', () => { map?.measure(); });

const target = parseJoinFragment(location.hash);
if (!target) {
  status.textContent = INCOMPLETE_LINK_TEXT;
} else if (!map) {
  status.textContent = NO_CANVAS_TEXT;
} else {
  form.hidden = false;
  // "Remember this name" is on unless it was turned off; off, no name is kept or offered.
  rememberName.checked = stored('remember-name', () => 'on') !== 'off';
  nameInput.value = rememberName.checked ? stored('name', () => '') : '';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (started) return;
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = NAME_PROBLEM_TEXT;
      return;
    }
    try {
      localStorage.setItem(pageKey('remember-name'), rememberName.checked ? 'on' : 'off');
      if (rememberName.checked) localStorage.setItem(pageKey('name'), name);
      else localStorage.removeItem(pageKey('name'));
    } catch { /* private window */ }
    started = true;
    form.hidden = true;
    session = createJoinSession({
      loader,
      // The colour the player picked last time goes to the GM on each admission.
      color: () => loadLaserColor(() => localStorage),
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: playerKeyFor(target.hostId),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
      onScene: (next) => {
        log.event('scene', { sceneId: next?.sceneId ?? null, tokens: next ? Object.keys(next.tokens).length : 0 });
        scene = next;
        renderScene();
      },
      onCamera: (camera) => {
        log.event('camera', { sceneId: camera.sceneId, centerX: camera.centerX, centerY: camera.centerY });
        map.setGmCamera(camera);
      },
      onControl: (tokenIds) => {
        log.event('control', { tokens: tokenIds.length });
        map.setControlled(tokenIds);
      },
      onMoveRefused: (tokenId) => {
        log.event('move refused', { tokenId });
        map.moveRefused(tokenId);
      },
      onSceneState: (paused) => {
        log.event('scene state', { paused });
        map.setPaused(paused);
      },
      onDiceLog: (entries, replay) => {
        log.event('dice log', { entries: entries.length, replay });
        diceLog.receive(entries, replay);
      },
      // Not logged: lasers arrive up to twenty times a second per person.
      onLaser: (laser) => map.receiveLaser(laser),
      onPing: (ping) => map.receivePing(ping),
      onTemplates: (sceneId, templates) => map.receiveTemplates(sceneId, templates),
      onSpells: (sceneId, spells) => map.receiveSpells(sceneId, spells),
      onSheets: (entries) => {
        sheets.receive(entries);
        map.setSheets(entries);
      },
      onPinNote: (answer) => map.receiveNote(answer),
      onBoardOffer: (available) => {
        log.event('board offer', { available });
        map.boardOffer(available);
      },
      onBoardExtras: (extras) => {
        loader.setBoard(extras);
        map.boardExtras(extras);
      },
      onBoardCamera: (camera) => map.setBoardCamera(camera),
    });
    session.start();
  });
}
