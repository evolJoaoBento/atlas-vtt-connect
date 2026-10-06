/**
 * A die's tag as Atlas 1.16 carries it (`RolledDie.color`, `RolledDie.colorName`): a `#rrggbb` colour and a
 * plain-text name. Validated the way Atlas validates it, so a roll shows the same tags in both: a tag that is
 * not well-formed is dropped, never the roll. Shared with the web page, so this file imports nothing.
 */

export const DIE_TAG_NAME_MAX = 32;

const DIE_COLOUR = /^#[0-9a-f]{6}$/i;
/** Markup and link characters, controls (newlines and tabs too) and invisible formatting characters (bidi overrides, zero width). */
const FORBIDDEN_IN_NAME = /[<>[\]`\p{Cc}\p{Cf}]/u;

/** A `#rrggbb` colour. */
export function isDieColour(value: unknown): value is string {
  return typeof value === 'string' && DIE_COLOUR.test(value);
}

/** The name trimmed when it is plain text of 1 to 32 code points; undefined otherwise. */
export function cleanDieTagName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (name.length === 0 || name.length > DIE_TAG_NAME_MAX * 2 || FORBIDDEN_IN_NAME.test(name)) return undefined;
  return Array.from(name).length <= DIE_TAG_NAME_MAX ? name : undefined;
}

export interface DieTag {
  color?: string;
  colorName?: string;
}

/** The die's well-formed tag fields only; empty when it has none. */
export function dieTagOf(die: { color?: unknown; colorName?: unknown }): DieTag {
  const colorName = cleanDieTagName(die.colorName);
  return { ...(isDieColour(die.color) && { color: die.color }), ...(colorName !== undefined && { colorName }) };
}

/** What a tagged die shows beside its value: its name, else its colour code; null for an untagged die. */
export function dieTagText(tag: DieTag): string | null {
  return tag.colorName ?? tag.color ?? null;
}
