export const isTurnName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 120 && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
export const isTurnValue = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= -1000 && value <= 1000;
export const isManualTurn = (id: string): boolean => /^rpg-turn-[0-9a-f-]{36}$/.test(id);
