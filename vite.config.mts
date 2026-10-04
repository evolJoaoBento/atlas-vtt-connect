import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import module from 'node:module';
import { atlasAliases } from './vite/atlasAliases.mts';

const isProduction = process.env.NODE_ENV === 'production';

/** The Obsidian plugin bundle. It writes dist/ and nothing else: never a vault (README, "Developing"). */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: atlasAliases },
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: isProduction ? false : 'inline',
    minify: isProduction,
    lib: { entry: 'main.ts', formats: ['cjs'], fileName: () => 'main.js' },
    rollupOptions: {
      external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view', ...module.builtinModules],
      output: {
        banner: `/*! Atlas VTT Connect — SPDX-License-Identifier: AGPL-3.0-only
 * Source code and licence: https://github.com/evolJoaoBento/atlas-vtt-connect
 * Contains code from Atlas VTT (AGPL-3.0-only, https://github.com/ByteMirror/atlas-vtt); third-party notices:
 * https://github.com/evolJoaoBento/atlas-vtt-connect/blob/main/THIRD_PARTY_NOTICES.md
 */`,
        exports: 'named',
        inlineDynamicImports: true,
        entryFileNames: 'main.js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'styles.css' : asset.name ?? '[name][extname]'),
      },
    },
  },
});
