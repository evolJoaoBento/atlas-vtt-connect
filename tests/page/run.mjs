// The join page's 3D board on phones: builds tests/page/boardPage.mts, serves it, and runs it on an Android phone
// (Chromium, Pixel 7) and an iPhone (WebKit, iPhone 14), checking the board loads and draws, the 2D/3D and Eyes buttons,
// a two-finger pinch zoom, and the gyroscope and a drag turning the view through a token's eyes.
// Usage: node tests/page/run.mjs [out dir for screenshots]   (needs `npx playwright install chromium webkit`)
/* global process, console, document, window, DeviceOrientationEvent, PointerEvent, Event -- runs under Node; the page parts in the browser */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const out = resolve('.page-test');
const shots = resolve(process.argv[2] ?? join(out, 'shots'));
rmSync(out, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
await build({
  entryPoints: { boardPage: 'tests/page/boardPage.mts', trackerWorker: 'online-client/ar/trackerWorker.mts' },
  bundle: true, splitting: true, format: 'esm', platform: 'browser', outdir: out,
  target: ['es2020', 'safari15'], loader: { '.css': 'css', '.webp': 'file', '.png': 'file', '.woff2': 'file' },
  alias: Object.fromEntries(['grid', 'draw', 'rules', 'dice3d', 'diceDisplay'].map((entry) => [`@atlas-vtt/shared/${entry}`, resolve(`vendor/atlas/shared/${entry}.js`)])),
  logLevel: 'warning',
});
copyFileSync('tests/page/boardPage.html', join(out, 'index.html'));
// The AR worker, where the page's chunk asks for it (vite names it so in the real build).
copyFileSync(join(out, 'trackerWorker.js'), join(out, 'trackerWorker.mts'));
copyFileSync('online-client/style.css', join(out, 'style.css'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mts': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((request, response) => {
  const path = join(out, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  try {
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? `file://${resolve(process.env.PLAYWRIGHT_MODULE, 'index.mjs')}` : 'playwright');
const { chromium, webkit, devices } = playwright.default ?? playwright;
let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function run(engine, label, device) {
  const browser = await engine.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  // A screenshot in WebKit adds a style of Playwright's own, which the page's policy refuses: not the page's error.
  let shooting = false;
  const shoot = async (name) => {
    shooting = true;
    const image = await page.screenshot({ path: join(shots, `${label}-${name}.png`), caret: 'initial' });
    await wait(300);
    shooting = false;
    return image;
  };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error' && !shooting) errors.push(message.text()); });
  // The page's Content-Security-Policy is the join page's: anything it refuses is an error.
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (event) => console.error(`CSP refused ${event.violatedDirective}: ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} sample ${event.sample}`)));
  await page.goto(url);
  await page.waitForFunction(() => window.pageTest?.ready || window.boardError, null, { timeout: 30000 });
  const tag = (name) => `${label}: ${name}`;
  check(tag('before the GM offers the board, the 2D map shows and no 3D button'), await page.evaluate(() => !document.getElementById('map').hidden && document.getElementById('board-3d').hidden && document.getElementById('dimension-button').hidden));
  await page.evaluate(() => window.pageTest.offer());
  await page.waitForFunction(() => !document.getElementById('board-3d').hidden || window.boardError, null, { timeout: 60000 });
  check(tag('offered, the board loads and shows where the map was'), await page.evaluate(() => !window.boardError && document.querySelector('#board-3d canvas') !== null && document.getElementById('map').hidden), await page.evaluate(() => window.boardError ?? ''));
  check(tag('the board is asked of the GM'), await page.evaluate(() => window.pageTest.record.requests.includes(true)));
  await page.evaluate(() => window.pageTest.extrasNow());
  await wait(2500);
  // The floor stacked above shows (as on the GM's board), with its painted water; the scene's own water too.
  const stacked = await page.evaluate(() => {
    const board = window.pageTest.inner();
    const layer = board.layerViews?.get('layer-1');
    const shown = (object) => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
    return { layer: !!layer && shown(layer.object3d), layerWater: !!layer?.water && shown(layer.water.object3d), water: !!board.water && shown(board.water.object3d) };
  });
  check(tag('the scene stacked above shows on the board'), stacked.layer, JSON.stringify(stacked));
  check(tag('the floors above are drawn as the GM draws them (faded here)'), await page.evaluate(() => window.pageTest.inner().quality.layerLook === 'faded'));
  check(tag('the painted water shows, the scene\'s and the stacked one\'s'), stacked.water && stacked.layerWater, JSON.stringify(stacked));
  const shot = await shoot('board');
  // Something is drawn: the middle of the screen is not one flat colour.
  const drawn = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(image.width / 4, image.height / 4, image.width / 2, image.height / 2).data;
    const seen = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 97) seen.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    return seen.size;
  }, shot.toString('base64'));
  // Read straight from WebGL right after a drawing (a headless browser's screenshot of WebGL can come out blank).
  const read = await page.evaluate(() => {
    const board = window.pageTest.inner();
    board.redraw();
    const gl = board.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const seen = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 211) seen.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    return seen.size;
  });
  console.log(`      ${label} drawn: screenshot ${drawn} colours, webgl ${read}`);
  check(tag('the board draws the scene (many colours, not a blank canvas)'), drawn > 8 || read > 8, JSON.stringify({ screenshot: drawn, webgl: read }));
  check(tag('the 2D/3D button shows'), await page.evaluate(() => !document.getElementById('dimension-button').hidden));
  // Two fingers apart: the camera comes closer.
  const before = await page.evaluate(() => window.pageTest.inner()?.camera.pose.distance ?? null);
  await page.evaluate(async () => {
    const canvas = window.pageTest.inner().canvas;
    canvas.setPointerCapture = () => undefined;
    const box = canvas.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    fire('pointerdown', 1, cx - 20, cy);
    fire('pointerdown', 2, cx + 20, cy);
    for (let step = 1; step <= 10; step++) {
      fire('pointermove', 1, cx - 20 - step * 10, cy);
      fire('pointermove', 2, cx + 20 + step * 10, cy);
      await new Promise((done) => requestAnimationFrame(done));
    }
    fire('pointerup', 1, cx - 120, cy);
    fire('pointerup', 2, cx + 120, cy);
  });
  await wait(300);
  const after = await page.evaluate(() => window.pageTest.inner()?.camera.pose.distance ?? null);
  check(tag('two fingers spread apart zoom in'), before !== null && after !== null && after < before * 0.8, JSON.stringify({ before, after }));
  // Eyes: the player's one token; the gyroscope (iOS asks first: the test answers yes) turns the view.
  check(tag('the Eyes button shows on the board with a token of the player\'s'), await page.evaluate(() => !document.getElementById('eye-button').hidden));
  await page.evaluate(() => {
    if (typeof window.DeviceOrientationEvent === 'undefined') window.DeviceOrientationEvent = function DeviceOrientationEvent() {};
    window.permissionAsked = 0;
    window.DeviceOrientationEvent.requestPermission = () => { window.permissionAsked++; return Promise.resolve('granted'); };
  });
  await page.click('#eye-button');
  await wait(400);
  check(tag('Eyes asks for the gyroscope (as iOS needs) and sees through the token'), await page.evaluate(() => window.permissionAsked === 1 && window.pageTest.inner() !== null && document.getElementById('eye-button').getAttribute('aria-pressed') === 'true'));
  const tilt = async (alpha, beta, gamma) => {
    await page.evaluate(([a, b, g]) => {
      const event = new Event('deviceorientation');
      Object.assign(event, { alpha: a, beta: b, gamma: g });
      window.dispatchEvent(event);
    }, [alpha, beta, gamma]);
    await wait(700);
    return page.evaluate(() => {
      const view = window.pageTest.inner().view;
      const forward = { x: 0, y: 0, z: -1 };
      const q = view.quaternion;
      // The forward direction the camera looks along.
      const ix = q.w * forward.x + q.y * forward.z - q.z * forward.y;
      const iy = q.w * forward.y + q.z * forward.x - q.x * forward.z;
      const iz = q.w * forward.z + q.x * forward.y - q.y * forward.x;
      const iw = -q.x * forward.x - q.y * forward.y - q.z * forward.z;
      const fx = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
      const fy = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
      const fz = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
      return { heading: Math.atan2(-fx, -fz), up: fy, eyeY: view.position.y };
    });
  };
  const upright = await tilt(0, 90, 0);
  const turned = await tilt(90, 90, 0);
  const turn = Math.abs(((turned.heading - upright.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  check(tag('the phone held upright looks level, at the token\'s eye height'), Math.abs(upright.up) < 0.2 && upright.eyeY > 10, JSON.stringify(upright));
  check(tag('turning the phone a quarter turns the view a quarter'), Math.abs(turn - Math.PI / 2) < 0.25, JSON.stringify({ upright, turned, turn }));
  const tiltedDown = await tilt(90, 45, 0);
  check(tag('tipping the phone forward looks down'), tiltedDown.up < -0.4, JSON.stringify(tiltedDown));
  await shoot('eyes');
  await page.click('#eye-button');
  await wait(300);
  check(tag('Leave eyes goes back to the usual camera'), await page.evaluate(() => document.getElementById('eye-button').getAttribute('aria-pressed') === 'false'));
  // AR: the camera films the marker sheet; the board stands on it, seen from straight above, see-through round the map.
  check(tag('the AR button shows on the board'), await page.evaluate(() => !document.getElementById('ar-button').hidden));
  await page.evaluate(() => window.pageTest.fakeCamera());
  await page.click('#ar-button');
  const found = await page.waitForFunction(() => {
    const el = document.getElementById('board-3d');
    return el.classList.contains('is-ar') && !el.classList.contains('is-ar-searching');
  }, null, { timeout: 20000 }).then(() => true, () => false);
  check(tag('AR starts the camera and finds the marker sheet'), found, await page.evaluate(() => document.querySelector('.ar-status')?.textContent ?? ''));
  await wait(800);
  const arView = await page.evaluate(() => {
    const board = window.pageTest.inner();
    const forward = board.view.getWorldDirection(board.view.position.clone());
    return { augmented: board.isAugmented, classes: document.getElementById('board-3d').className, down: forward.y, height: board.view.position.y, video: !document.getElementById('ar-video').hidden, eyes: document.getElementById('eye-button').hidden };
  });
  check(tag('in AR the board is drawn from above the sheet, looking down, over the camera'), arView.augmented && arView.down < -0.9 && arView.height > 0 && arView.video, JSON.stringify(arView));
  check(tag('in AR the Eyes button steps aside'), arView.eyes);
  const synced = await page.evaluate(() => ({ behind: document.getElementById('ar-video').classList.contains('is-behind'), texture: window.pageTest.inner().scene.background?.isTexture === true, debug: document.querySelector('.ar-debug')?.textContent ?? '' }));
  check(tag('in AR the camera picture is drawn behind the board with its own pose (the live video steps back)'), synced.behind && synced.texture, JSON.stringify(synced));
  check(tag('in AR the tracking numbers show when asked'), /tracking gyroscope/.test(synced.debug) && /markers \d/.test(synced.debug), synced.debug);
  check(tag('in AR the gyroscope turns the board, the markers place it'), await page.evaluate(() => document.getElementById('board-3d').dataset.arSteadiedBy === 'gyroscope'), await page.evaluate(() => document.getElementById('board-3d').dataset.arSteadiedBy ?? 'none'));
  const clear = await page.evaluate(() => {
    const board = window.pageTest.inner();
    board.redraw();
    const gl = board.renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const background = board.scene.background;
    return { background: background === null || background === board.arTexture, floor: board.surface?.floor?.visible ?? null, alpha: board.renderer.getClearAlpha(), corner: pixel[3], synced: background !== null };
  });
    check(tag('in AR the board is see-through round the map (no sky, no floor: the camera shows there)'), clear.background && clear.floor === false && clear.alpha === 0 && (clear.synced || clear.corner === 0), JSON.stringify(clear));
  await shoot('ar');
  // Leaning in too close: no marker in sight. The board holds, and the camera picture does not dim.
  await page.evaluate(() => { window.sheetHidden = true; });
  await wait(1500);
  const lost = await page.evaluate(() => {
    const canvas = document.querySelector('#board-3d canvas');
    return { opacity: getComputedStyle(canvas).opacity, behind: document.getElementById('ar-video').classList.contains('is-behind'), augmented: window.pageTest.inner().isAugmented };
  });
  check(tag('with the markers out of sight the board holds and the camera picture does not dim'), lost.opacity === '1' && lost.behind && lost.augmented, JSON.stringify(lost));
  await page.evaluate(() => { window.sheetHidden = false; });
  await wait(800);
  await page.click('#ar-button');
  await wait(300);
  check(tag('Leave AR stops the camera and gives the board its usual camera'), await page.evaluate(() => !window.pageTest.inner().isAugmented && document.getElementById('ar-video').hidden && document.getElementById('ar-panel').hidden && !document.getElementById('board-3d').classList.contains('is-ar')));
  // 2D again.
  await page.click('#dimension-button');
  await wait(300);
  check(tag('the 2D/3D button goes back to the map and stops asking for the board'), await page.evaluate(() => !document.getElementById('map').hidden && document.getElementById('board-3d').hidden && window.pageTest.record.requests.at(-1) === false));
  check(tag('no errors on the page'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

try {
  await run(chromium, 'android', devices['Pixel 7']);
  await run(webkit, 'iphone', devices['iPhone 14']);
} finally {
  server.close();
}
console.log(`${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
