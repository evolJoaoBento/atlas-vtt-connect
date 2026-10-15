import type { Plugin } from 'vite';

/** Any way of naming a `<script>` element to `createElement`, or parsing one from markup (React's rendered `<script>`). */
const SCRIPT_ELEMENT = /\.createElement\(\s*(["'`])script\1\s*\)|(?<=\.innerHTML\s*=\s*)(["'`])<script>(?:\\x3c|<\\?)\/script>\2/g;
const REFUSED = '(()=>{throw new Error("Atlas VTT Connect never creates script elements")})()';

/**
 * Keeps `main.js` free of code that creates `<script>` elements, which Obsidian's review refuses. The only such code
 * is React DOM's: hoisting `<script>` resources (`preinit`, a rendered `<script async>`) and rendering a `<script>`
 * element, neither of which Connect does: those calls become a throw. The finished bundle is checked, so a dependency that adds one fails the build.
 */
export function noScriptElements(): Plugin {
  return {
    name: 'atlas-connect:no-script-elements',
    enforce: 'post',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]react-dom[\\/]/.test(id) || !SCRIPT_ELEMENT.test(code)) return null;
      SCRIPT_ELEMENT.lastIndex = 0;
      return { code: code.replace(SCRIPT_ELEMENT, REFUSED), map: null };
    },
    renderChunk(code, chunk) {
      SCRIPT_ELEMENT.lastIndex = 0;
      if (SCRIPT_ELEMENT.test(code)) this.error(`${chunk.fileName} creates script elements, which Obsidian's review refuses.`);
      return null;
    },
  };
}
