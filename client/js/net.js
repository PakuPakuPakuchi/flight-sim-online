/* WebSocket 接続管理
 *  - 状態: CONNECTING / CONNECTED / RECONNECTING / DISCONNECTED
 *  - 自動再接続(指数バックオフ)。session token で同一プレイヤーとして復帰
 *  - ping/pong による RTT とサーバー時計オフセットの推定(スナップショット補間・予測に使用)
 */
const Net = {
  status: 'DISCONNECTED', ws: null, wanted: false, joined: false, everJoined: false,
  tries: 0, info: null, onMsg: null, onStatus: null,
  ping: 0, rtt: 0.1, off: 0, synced: false, samples: [], pingTimer: 0, retryTimer: 0, nextRetry: 0,
  url() {
    const cfg = window.GAME_CONFIG && window.GAME_CONFIG.ws;
    if (cfg) return cfg;
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  },
  token() { try { return sessionStorage.getItem('fs_token') || ''; } catch (e) { return ''; } },
  saveToken(t) { try { sessionStorage.setItem('fs_token', t); } catch (e) { } },
  setStatus(s) { if (this.status !== s) { this.status = s; if (this.onStatus) this.onStatus(s); } },
  connect(info) { this.info = info; this.wanted = true; this.tries = 0; this.open(); },
  open() {
    clearTimeout(this.retryTimer);
    this.setStatus(this.everJoined ? 'RECONNECTING' : 'CONNECTING');
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { return this.scheduleRetry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      const i = this.info || {};
      this.send({ t: 'join', name: i.name, team: i.team || 'auto', room: i.room, token: this.token() });
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'pong') return this.onPong(m);
      if (m.t === 'join_ok') { this.joined = true; this.everJoined = true; this.saveToken(m.token); this.setStatus('CONNECTED'); this.startPing(); }
      if (m.t === 'error' && (m.code === 'room_full' || m.code === 'invalid_room')) this.wanted = false;
      try { if (this.onMsg) this.onMsg(m); } catch (e) { console.error('handler error', e); }
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.joined = false; clearInterval(this.pingTimer); this.scheduleRetry(); };
    ws.onerror = () => { };
  },
  scheduleRetry() {
    if (!this.wanted) { this.setStatus('DISCONNECTED'); return; }
    this.setStatus(this.everJoined ? 'RECONNECTING' : (this.tries ? 'DISCONNECTED' : 'CONNECTING'));
    const d = Math.min(5000, 500 * Math.pow(2, this.tries++));
    this.nextRetry = Date.now() + d;
    this.retryTimer = setTimeout(() => this.open(), d);
  },
  send(o) { const ws = this.ws; if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); return true; } catch (e) { } } return false; },
  startPing() { clearInterval(this.pingTimer); const p = () => this.send({ t: 'ping', c: Date.now() }); p(); this.pingTimer = setInterval(p, 1000); },
  onPong(m) {
    const now = Date.now(), rtt = Math.max(1, now - m.c);
    this.samples.push({ rtt, off: m.s + rtt / 2 - now }); if (this.samples.length > 8) this.samples.shift();
    let best = this.samples[0]; for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.off = best.off; this.rtt = best.rtt / 1000; this.ping = Math.round(this.samples.reduce((a, s) => a + s.rtt, 0) / this.samples.length); this.synced = true;
  },
  serverNow() { return Date.now() + this.off; },
  close() { this.wanted = false; if (this.ws) this.ws.close(); }
};
