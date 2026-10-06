import type { Message, MessageKey, MessageValues, Translation } from './types';
export type { MessageKey } from './types';
/** Languages Atlas speaks, keyed by Obsidian's language codes (`getLanguage()`: `ru`, `pt-BR`, `zh-TW`, …). */
export declare const TRANSLATIONS: Readonly<Record<string, Translation>>;
/** Picks the supported language for `language`: the exact code, else its base language (`pt` for `pt-BR`), else English. */
export declare function resolveLocale(language: string): string;
/** Sets the language of every later `t` call. The plugin selects it during bootstrap. */
export declare function setLocale(language: string): void;
/** The active language code, for `Intl` formatters that should match Atlas' texts. */
export declare function getLocale(): string;
/**
 * Renders `message` in the language of `rules`: a `count` value picks the plural form,
 * and `{name}` placeholders take `values.name` (numbers formatted for that language).
 */
export declare function formatMessage(message: Message, rules: Intl.PluralRules, values?: MessageValues): string;
/** The text for `key` in the active language, falling back to English; see `formatMessage` for `values`. */
export declare function t(key: MessageKey, values?: MessageValues): string;
/** Joins `items` as the active language does: "a, b and c". */
export declare function formatList(items: readonly string[]): string;
