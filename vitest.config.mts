import { defineConfig } from 'vitest/config';
import { atlasAliases } from './vite/atlasAliases.mts';
import { atlasDomHost } from './vite/atlasDomHost.mts';

export default defineConfig({
  plugins: [atlasDomHost],
  resolve: { alias: [...atlasAliases, { find: /^obsidian$/, replacement: '/tests/mocks/obsidian.ts' }] },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup/obsidianDom.ts'] },
});
