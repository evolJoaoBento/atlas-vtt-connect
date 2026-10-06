import type { Plugin } from 'vite';

/**
 * Atlas's 3D dice (API 1.16) create their canvases through a `DomHost` that Atlas installs at start (`installDomHost`).
 * The vendored `@atlas-vtt/shared/dice3d` is bundled without that module's setter, so its `getDomHost` always throws
 * outside Atlas. This gives it the plain browser's host, at build time, without touching the vendored file (`check:vendor`).
 * It fails the build when the vendored code no longer has that function, so an Atlas that ships a way to install a host
 * (or drops the need) makes this plugin go.
 */
const THROWING_HOST = /function getDomHost\(\) \{\s*throw new Error\("DOM host has not been installed"\);\s*\}/;

const BROWSER_HOST = `function getDomHost() {
  return {
    createCanvas(doc = document, size) {
      const canvas = doc.createElement('canvas');
      if (size) { canvas.width = size.width; canvas.height = size.height; }
      return canvas;
    },
    createDiv(parent, cls) {
      const div = parent.ownerDocument.createElement('div');
      div.className = cls;
      parent.appendChild(div);
      return div;
    },
    ownerWindow: (node) => node.ownerDocument?.defaultView ?? window,
    activeDocument: () => document,
  };
}`;

export const atlasDomHost: Plugin = {
  name: 'atlas-dom-host',
  enforce: 'pre',
  transform(code, id) {
    if (!/vendor[\/]atlas[\/]shared[\/]dice3d\.js$/.test(id.split('?')[0] ?? '')) return null;
    if (!THROWING_HOST.test(code)) this.error('vendor/atlas/shared/dice3d.js has no throwing getDomHost to replace: remove vite/atlasDomHost.mts, or update it.');
    return { code: code.replace(THROWING_HOST, BROWSER_HOST), map: null };
  },
};
