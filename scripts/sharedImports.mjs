// Shared by sync-atlas-shared.mjs and check-shared.mjs: how the imports of a copied Atlas file are read.
export const IMPORT = /(^|\n)(\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"]*?\sfrom\s+)?)(['"])([^'"]+)\3/g;

/** `import type { A }`, `export type { A }`, or `import { type A, type B }`: types only, nothing at run time. */
export function isTypeOnly(head) {
  if (/^\s*(?:import|export)\s+type\s/.test(head)) return true;
  const names = /\{([^}]*)\}/.exec(head)?.[1];
  if (!names || /^\s*(?:import|export)\s+[\w$]+\s*,/.test(head)) return false;
  const parts = names.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part.startsWith('type '));
}

/** The names a type-only import brings in (`A`, and `B` of `B as C`). */
export const typeNamesOf = (head) => (/\{([^}]*)\}/.exec(head)?.[1] ?? '').split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean);

/** Whether a stub holds only comments, blank lines and one-line type aliases (`export type Name = any;`, or a shape from `STUB_TYPES`): no code, no object bodies. */
export function stubIsClean(text) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return body.split(/\r?\n/).every((line) => /^\s*(\/\/.*)?$/.test(line) || /^export type [\w$]+ = [^;{}]+;\s*$/.test(line));
}
