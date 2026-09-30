'use strict';
/**
 * フライトシム オンライン対戦サーバー
 *  - 静的配信 (client/, shared/, three.js) + WebSocket (/ws)
 *  - 環境変数: PORT, HOST, MAX_PLAYERS, ALLOWED_ORIGINS, PUBLIC_WS_URL, TLS_CERT, TLS_KEY
 */
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const Proto = require('./network/protocol.js');
const Room = require('./game/Room.js');

const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 16;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

function findThree() {
  for (const p of ['three/build/three.min.js']) { try { return require.resolve(p); } catch (e) { } }
  return null;
}
const THREE_FILE = findThree();

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}
function handler(req, res) {
  let url; try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.list.length, 0) })); }
  if (url === '/config.js') { // クライアント設定(本番で wss:// URL を上書き可能)
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end('window.GAME_CONFIG=' + JSON.stringify({ ws: process.env.PUBLIC_WS_URL || '' }) + ';');
  }
  if (url === '/vendor/three.min.js') return THREE_FILE ? serveFile(res, THREE_FILE) : (res.writeHead(404), res.end('three not installed: run npm install'));
  if (url === '/') url = '/client/index.html';
  if (!(url.startsWith('/client/') || url.startsWith('/shared/'))) { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
}

const useTLS = process.env.TLS_CERT && process.env.TLS_KEY;
const server = useTLS ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler) : http.createServer(handler);

// ---- ルーム管理(将来の複数ルーム対応: room ID → Room) ----
const rooms = new Map();
function getRoom(id) {
  id = String(id || 'main').replace(/[^\w-]/g, '').slice(0, 24) || 'main';
  let r = rooms.get(id);
  if (!r) { if (rooms.size >= 8) return null; r = new Room(id, { maxPlayers: MAX_PLAYERS }); rooms.set(id, r); }
  return r;
}
getRoom('main');

const wss = new WebSocketServer({ noServer: true, maxPayload: Proto.LIMITS.maxPayload, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const u = (req.url || '').split('?')[0];
  const origin = req.headers.origin;
  if (u !== '/ws' || (ORIGINS.length && origin && !ORIGINS.includes(origin))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  ws.player = null; ws.isAlive = true; ws.room = null;
  const q = new URL(req.url, 'http://x').searchParams;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      const s = data.toString();
      // join 時にルームを確定(以降は同じルームで処理)
      if (!ws.room) {
        let m; try { m = JSON.parse(s); } catch (e) { return; }
        if (!m || m.t !== Proto.T.JOIN) { ws.send(JSON.stringify({ t: 'error', code: 'not_joined', msg: '先に join してください' })); return; }
        const r = getRoom(m.room || q.get('room')); if (!r) { ws.send(JSON.stringify({ t: 'error', code: 'invalid_room', msg: '無効なルームです' })); return; }
        ws.room = r;
      }
      ws.room.onMessage(ws, s);
    } catch (e) { console.error('message error', e); try { ws.send(JSON.stringify({ t: 'error', code: 'server_error', msg: 'サーバーエラー' })); } catch (_) { } }
  });
  ws.on('close', () => { if (ws.room) ws.room.onClose(ws); });
  ws.on('error', () => { });
});
// WebSocket レベルの生存確認(プロキシ越しの死活監視)
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) { } } }, 10000);

process.on('uncaughtException', e => console.error('uncaught', e));
server.listen(PORT, HOST, () => console.log(`Flight-sim online server: ${useTLS ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (ws path /ws)${THREE_FILE ? '' : '  [WARN] three が未インストール: npm install を実行'}`));
module.exports = { server, rooms };
