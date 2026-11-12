// online-client/tabletopBoard.mts
/** Tabletop's player board, with its styles: one chunk the page loads with the GM's first offer of the 3D board. */
import '../vendor/tabletop/tabletop-player-board.css';
// The Roll dice tray of a cutscene is built of Atlas's classes, which the page has no styles for.
import './atlas-dice-tray.css';

export { webPlayerBoard } from '../vendor/tabletop/tabletop-player-board.js';
