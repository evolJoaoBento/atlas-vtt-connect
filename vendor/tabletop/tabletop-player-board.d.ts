import type { PlayerBoardFactory } from '../../src/app/online/obsidian/playerBoardContract';

/** Tabletop's player board for the browser, made for this device (low quality on a phone unless one is given). */
export function webPlayerBoard(quality?: 'low' | 'medium' | 'high'): PlayerBoardFactory;
