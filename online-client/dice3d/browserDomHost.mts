/**
 * The DOM host Atlas's 3D dice make their canvases through (`installDomHost`, Atlas API 1.17.0): Atlas installs its own
 * inside Obsidian, and the join page (and the tests) install this one, a plain browser's, before the dice draw.
 */
import type { DomHost } from '@atlas-vtt/shared/dice3d';

export function browserDomHost(): DomHost {
  return {
    createCanvas(doc = document, size): HTMLCanvasElement {
      const canvas = doc.createElement('canvas');
      if (size) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      return canvas;
    },
    createDiv(parent, cls): HTMLDivElement {
      const div = parent.ownerDocument.createElement('div');
      div.className = cls;
      parent.appendChild(div);
      return div;
    },
    ownerWindow: (node): Window => node.ownerDocument?.defaultView ?? window,
    activeDocument: (): Document => document,
  };
}
