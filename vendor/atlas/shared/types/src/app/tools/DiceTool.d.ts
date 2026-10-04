import { EventEmitter } from 'events';
import type { DiceRules } from '../types/diceRulesTypes';
import { type DiceRollResult } from './diceRolling';
export type { DiceRollResult } from './diceRolling';
export interface DiceToolState {
    isTrayOpen: boolean;
    rollHistory: DiceRollResult[];
    activeFormula: string;
    quickDice: string[];
}
export declare class DiceTool {
    state: DiceToolState;
    private eventBus;
    private readonly getDiceRules;
    constructor(eventBus: EventEmitter, getDiceRules?: () => DiceRules);
    toggleTray(): void;
    rollDice(formula: string, source?: DiceRollResult['source']): DiceRollResult;
    /** Rolls the formula; one without dice (`+3`) is added to the collection's default roll. */
    private parseAndRoll;
    clearHistory(): void;
    setActiveFormula(formula: string): void;
    getQuickDice(): string[];
    addQuickDie(die: string): void;
    removeQuickDie(die: string): void;
    getState(): DiceToolState;
}
