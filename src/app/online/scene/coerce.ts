/**
 * Wire values from GM records. Older or hand-edited map files may hold any
 * shape (a string HP, a missing font size, NaN), and one bad value would make
 * a whole snapshot invalid for players, so the projection reads values through these.
 */
import { SCENE_LIMITS, SCENE_RANGES } from './sceneLimits';

/** Inclusive bounds; pass one of `SCENE_RANGES` so GM output always passes the player validator. */
export type NumberRange = readonly [min: number, max: number];

function clamped(value: number, range: NumberRange | undefined): number {
  if (!range) return value;
  return Number.isNaN(value) ? range[0] : Math.min(range[1], Math.max(range[0], value));
}

/**
 * A finite number, from a number or a numeric string; else `fallback`. With a
 * `range` the result (fallback included) is clamped into it; a NaN fallback
 * becomes the range's minimum.
 */
export function finiteOr(value: unknown, fallback: number, range?: NumberRange): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return clamped(typeof number === 'number' && Number.isFinite(number) ? number : fallback, range);
}

export function finiteOrNull(value: unknown, range?: NumberRange): number | null {
  const number = finiteOr(value, Number.NaN);
  return Number.isFinite(number) ? clamped(number, range) : null;
}

export function positiveOr(value: unknown, fallback: number, range?: NumberRange): number {
  const number = finiteOr(value, Number.NaN);
  return clamped(number > 0 ? number : fallback, range);
}

export function positiveOrNull(value: unknown, range?: NumberRange): number | null {
  const number = finiteOr(value, Number.NaN);
  return number > 0 ? clamped(number, range) : null;
}

/** A number from 0 to 1, such as an opacity. */
export function unitOr(value: unknown, fallback: number): number {
  return finiteOr(value, fallback, SCENE_RANGES.opacity);
}

export function textOr(value: unknown, fallback: string, max: number = SCENE_LIMITS.stringLength): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

/** A non-empty string, clipped; else null. */
export function textOrNull(value: unknown, max: number = SCENE_LIMITS.stringLength): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

export function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}
