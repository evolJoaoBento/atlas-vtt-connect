import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_RELAY_FRAME_BYTES, decodeRelay, encodeRelay, validRelayUrl } from '../src/app/online/transport/relayWire.ts';

const fresh = () => randomBytes(24).toString('hex');
const same = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

/** Only the compiled player page is public. The vault and configuration are never served. */
export function createRelayServer({ adminKey, webDir, publicUrl = () => '', port = 8787 }) {
  if (typeof adminKey !== 'string' || adminKey.length < 32) throw new Error('A private administrator key is required');
  const root = path.resolve(webDir);
  const rooms = new Map();
  const send = (ws, packet) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 8 * 1024 * 1024) { ws.close(1013, 'Receiver too slow'); return; }
    ws.send(encodeRelay(packet));
  };
  const end = (id) => {
    const room = rooms.get(id); if (!room) return;
    rooms.delete(id); clearTimeout(room.timer);
    for (const peer of room.clients.values()) peer.close(1000, 'Session ended');
    room.host?.close(1000, 'Session ended');
  };
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/health' && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!same(req.headers.authorization, `Bearer ${adminKey}`)) { res.writeHead(401); res.end(); return; }
      if (rooms.size >= 8) { res.writeHead(429); res.end(); return; }
      const roomId = randomBytes(16).toString('hex'); const hostKey = fresh(); const joinKey = fresh();
      const room = { hostKey, joinKey, host: null, clients: new Map(), timer: setTimeout(() => end(roomId), 60000) };
      rooms.set(roomId, room);
      const announced = publicUrl();
      const base = validRelayUrl(announced) ? announced : `http://127.0.0.1:${server.address()?.port ?? port}`;
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ roomId, hostKey, joinKey, publicUrl: base })); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { res.writeHead(400); res.end(); return; }
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      if (!statSync(filename).isFile()) throw new Error('Not a file');
      res.setHeader('Content-Type', MIME[path.extname(filename)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', path.extname(filename) === '.html' ? 'no-store' : 'public, max-age=3600');
      if (req.method === 'HEAD') res.end(); else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_RELAY_FRAME_BYTES, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let url; try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { socket.destroy(); return; }
    const id = url.searchParams.get('room'); const role = url.searchParams.get('role'); const key = url.searchParams.get('key');
    const room = rooms.get(id);
    const host = role === 'host';
    if (url.pathname !== '/socket' || !room || (host ? !same(key, room.hostKey) || room.host : role !== 'player' || !same(key, room.joinKey) || !room.host || room.clients.size >= 32)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const peerId = randomBytes(16).toString('hex');
      ws.isAlive = true;
      ws.on('error', () => {}); // A single failed player must not terminate the server.
      ws.on('pong', () => { ws.isAlive = true; });
      if (host) { clearTimeout(room.timer); room.host = ws; send(ws, { kind: 'ready' }); }
      else { room.clients.set(peerId, ws); send(room.host, { kind: 'open', peerId }); send(ws, { kind: 'ready', peerId }); }
      let windowStart = Date.now(); let messages = 0;
      ws.on('message', (data, binary) => {
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messages = 0; }
        if (++messages > 1000) { ws.close(1008, 'Too many messages'); return; }
        const packet = decodeRelay(binary ? data : data.toString('utf8'));
        if (!packet) { ws.close(1008, 'Invalid message'); return; }
        if (host) {
          if (packet.kind === 'end') { end(id); return; }
          const recipient = room.clients.get(packet.peerId);
          if (packet.kind === 'data') send(recipient, packet);
          else if (packet.kind === 'close') recipient?.close(1000, 'Disconnected by host');
        } else if (packet.kind === 'data') {
          // The sender id comes from the authenticated socket, never from a player-supplied packet.
          send(room.host, { ...packet, peerId });
        }
      });
      ws.on('close', () => {
        if (!rooms.has(id)) return;
        if (host && room.host === ws) {
          room.host = null;
          for (const client of room.clients.values()) client.close(1012, 'Host reconnecting');
          room.clients.clear(); room.timer = setTimeout(() => end(id), 60000);
        } else if (!host) { room.clients.delete(peerId); send(room.host, { kind: 'close', peerId }); }
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping(); } }
  }, 20000);
  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }),
    close: () => new Promise((resolve) => { clearInterval(heartbeat); for (const id of [...rooms.keys()]) end(id); for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.close(resolve); }),
  };
}

if (process.env.ATLAS_RELAY_CONFIG) {
  const configPath = path.resolve(process.env.ATLAS_RELAY_CONFIG);
  const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  const relay = createRelayServer({ ...config, publicUrl: () => JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')).publicUrl ?? '' });
  void relay.listen().then(() => console.log('Atlas local relay ready on loopback. Only the compiled player page is public.')).catch(() => { console.error('Could not start Atlas local relay.'); process.exit(1); });
  process.on('SIGINT', () => { void relay.close().then(() => process.exit()); });
  process.on('SIGTERM', () => { void relay.close().then(() => process.exit()); });
}
