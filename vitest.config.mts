import { defineConfig } from 'vitest/config';
import { atlasAliases } from './vite/atlasAliases.mts';

export default defineConfig({
  resolve: { alias: [...atlasAliases, { find: /^obsidian$/, replacement: '/tests/mocks/obsidian.ts' }] },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/atlasDomHost.ts'] },
});
