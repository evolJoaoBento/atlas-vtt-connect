import type { PlayerBoardFactory } from '../../src/app/online/obsidian/playerBoardContract';

/** Tabletop's player board for the browser, made for this device (low quality on a phone unless one is given). */
export function webPlayerBoard(quality?: 'low' | 'medium' | 'high'): PlayerBoardFactory;

/** Whether the board died in this browser even drawn its leanest (a phone out of memory): the page opens on the 2D map. */
export function boardDiedLeanest(): boolean;
