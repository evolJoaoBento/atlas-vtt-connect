import { defineConfig } from 'vite';
import { atlasAliases } from './vite/atlasAliases.mts';

/** The web page players open to join an online session; deployed to GitHub Pages (pages.yml). */
export default defineConfig({
  root: 'online-client',
  base: './',
  resolve: { alias: atlasAliases },
  build: {
    outDir: '../dist-page',
    emptyOutDir: true,
    // The 3D dice chunk (three.js and Atlas's dice) loads only with the player's first thrown roll.
    chunkSizeWarningLimit: 700,
  },
});
