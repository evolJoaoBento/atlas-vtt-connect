import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** `@atlas-vtt/shared/<entry>` → the vendored ES module (decision D1). `@atlas-vtt/api-types` is types only. */
export const atlasAliases = [
  { find: /^@atlas-vtt\/shared\/(grid|draw|rules|dice3d|diceDisplay)$/, replacement: path.join(root, 'vendor/atlas/shared/$1.js') },
];
