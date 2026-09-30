'use strict';
const crypto = require('crypto');
const Proto = require('../network/protocol.js');
const { T, PHASE, LIMITS } = Proto;
const Player = require('./Player.js');
const GameState = require('./GameState.js');
const GameSimulation = require('./GameSimulation.js');

const TICK_RATE = 120;          // 物理は元ゲームと同じ 1/120 s 固定(飛行特性を維持)
const SNAP_EVERY = 6;           // 120/6 = 20Hz でスナップショット送信
const GRACE_MS = 30000;         // 切断後の再接続猶予
const IDLE_MS = 15000;          // 無通信タイムアウト(クライアントは常時 input/ping を送る)
const COUNTDOWN = 3, RESULT_TIME = 15;

class Room {
  constructor(id, opts = {}) {
    this.id = id; this.maxPlayers = opts.maxPlayers || 16;
    this.list = []; this.byId = new Map(); this._id = 1;
    this.gs = new GameState(); this.sim = new GameSimulation(this);
    this.tickN = 0; this.acc = 0; this.last = Date.now(); this.sec = 0; this.lobbyT = 0;
    this.timer = setInterval(() => { try { this.loop(); } catch (e) { const n = Date.now(); if (n - (this._errT || 0) > 2000) { this._errT = n; console.error('room loop error', e); } } }, 5);
  }
  destroy() { clearInterval(this.timer); }
  nextId() { return this._id++; }
  playerList() { return this.list; }
  send(p, o) { const ws = p.ws; if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  broadcast(o) { const s = JSON.stringify(o); for (const p of this.list) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }

  // ---------- 接続 ----------
  chooseTeam(pref) {
    if (pref === 'red' || pref === 'blue') return pref;
    const n = t => this.list.filter(p => p.team === t).length, b = n('blue'), r = n('red');
    return b < r ? 'blue' : r < b ? 'red' : (Math.random() < .5 ? 'blue' : 'red');
  }
  join(ws, msg) {
    if (ws.player) return this.err(ws, 'already_joined', '既に参加済みです');
    const token = typeof msg.token === 'string' ? msg.token : '';
    let p = token ? this.list.find(x => x.token === token) : null, resumed = false;
    if (p) {
      if (p.ws && p.ws !== ws) { p.ws.player = null; try { p.ws.close(4000, 'replaced'); } catch (e) { } }
      p.ws = ws; p.connected = true; p.discAt = 0; resumed = true;
    } else {
      if (this.list.length >= this.maxPlayers) return this.err(ws, 'room_full', 'ルームが満員です');
      const name = Proto.sanitizeName(msg.name);
      p = new Player(this.nextId(), name, this.chooseTeam(msg.team), crypto.randomBytes(16).toString('hex'));
      p.ws = ws; this.list.push(p); this.byId.set(p.id, p);
      if (this.gs.phase === PHASE.BATTLE) this.sim.spawnPlayer(p); // 途中参加
    }
    ws.player = p; p.lastMsg = Date.now();
    this.send(p, { t: T.JOIN_OK, id: p.id, token: p.token, team: p.team, name: p.name, room: this.id, tickRate: TICK_RATE, snapRate: TICK_RATE / SNAP_EVERY, resumed });
    this.send(p, this.roomState());
    if (this.gs.phase === PHASE.BATTLE || this.gs.phase === PHASE.RESULT) this.send(p, { t: T.GAME_START, targets: this.sim.targetList(), tac: this.tac(), resume: true });
    if (!resumed) this.broadcast({ t: T.PLAYER_JOINED, id: p.id, name: p.name, team: p.team });
    this.broadcastState();
  }
  err(ws, code, msg) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: T.ERROR, code, msg })); }
  onClose(ws) {
    const p = ws.player; if (!p || p.ws !== ws) return;
    p.ws = null; p.connected = false; p.discAt = Date.now(); p.inp.fire = false; p.ready = false;
    this.broadcastState(); this.checkStart();
  }
  removePlayer(p, reason) {
    const i = this.list.indexOf(p); if (i < 0) return;
    this.list.splice(i, 1); this.byId.delete(p.id); p.inGame = false;
    if (p.ws) { p.ws.player = null; try { p.ws.close(4001, reason || 'removed'); } catch (e) { } }
    this.broadcast({ t: T.PLAYER_LEFT, id: p.id, name: p.name, reason: reason || 'left' });
    // 空きは AI が自動補充(GameSimulation.aiTargetCount が人数に応じて増える = AI テイクオーバー)
    if (!this.list.length && this.gs.phase !== PHASE.LOBBY) this.toLobby();
    this.broadcastState(); this.checkStart();
  }

  // ---------- 受信 ----------
  onMessage(ws, raw) {
    const now = Date.now(), p = ws.player;
    // レート制限(トークンバケット)
    const src = p || ws;
    src.tok = Math.min(LIMITS.maxMsgPerSec, (src.tok === undefined ? LIMITS.maxMsgPerSec : src.tok) + (now - (src.tokT || now)) / 1000 * LIMITS.maxMsgPerSec);
    src.tokT = now;
    if (src.tok < 1) { src.bad = (src.bad || 0) + 1; if (src.bad > 400) ws.close(1008, 'spam'); return; }
    src.tok -= 1;
    let msg; try { msg = JSON.parse(raw); } catch (e) { return this.err(ws, 'malformed', '不正なメッセージ'); }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.err(ws, 'malformed', '不正なメッセージ');
    if (msg.t === T.PING) { if (p) p.lastMsg = now; return ws.send(JSON.stringify({ t: T.PONG, c: Proto.num(msg.c, 0, 1e15, 0), s: now })); }
    if (msg.t === T.JOIN) return this.join(ws, msg);
    if (!p) return this.err(ws, 'not_joined', '先に join してください');
    p.lastMsg = now;
    switch (msg.t) {
      case T.INPUT: {
        const seq = +msg.seq; if (!Number.isFinite(seq) || seq <= p.lastSeq) return; // 古い/重複/異常な入力は無視
        const i = Proto.sanitizeInput(msg.i); if (!i) return;
        p.lastSeq = seq; p.inp = i; break;
      }
      case T.LAUNCH_MISSILE: if (this.gs.phase === PHASE.BATTLE && p.inGame) this.sim.requestMissile(p); break;
      case T.USE_CHAFF: if (this.gs.phase === PHASE.BATTLE && p.inGame) this.sim.requestChaff(p); break;
      case T.SET_TEAM:
        if (this.gs.phase !== PHASE.LOBBY) return this.err(ws, 'bad_phase', '試合中はチームを変更できません');
        if (msg.team === 'red' || msg.team === 'blue') { p.team = msg.team; p.ready = false; this.broadcastState(); } break;
      case T.READY:
        if (this.gs.phase !== PHASE.LOBBY && this.gs.phase !== PHASE.COUNTDOWN) return;
        p.ready = !!msg.ready; this.broadcastState(); this.checkStart(); break;
      default: this.err(ws, 'unknown_type', '未知のメッセージ種別');
    }
  }

  // ---------- 進行 ----------
  tac() { return { blue: this.sim.teams.blue.tac, red: this.sim.teams.red.tac }; }
  roomState() {
    return {
      t: T.ROOM_STATE, phase: this.gs.phase, countdown: Math.ceil(this.gs.countdown), winner: this.gs.winner, room: this.id, max: this.maxPlayers,
      players: this.list.map(p => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, conn: p.connected ? 1 : 0, score: p.score, kills: p.kills, deaths: p.deaths, tk: p.tk }))
    };
  }
  broadcastState() { this.broadcast(this.roomState()); }
  checkStart() {
    const conn = this.list.filter(p => p.connected), all = conn.length > 0 && conn.every(p => p.ready);
    if (this.gs.phase === PHASE.LOBBY && all) { this.gs.phase = PHASE.COUNTDOWN; this.gs.countdown = COUNTDOWN; this.broadcastState(); }
    else if (this.gs.phase === PHASE.COUNTDOWN && !all) { this.gs.phase = PHASE.LOBBY; this.broadcastState(); }
  }
  startBattle() {
    for (const p of this.list) { p.score = p.kills = p.deaths = p.tk = 0; p.lastSeq = 0; }
    this.gs.phase = PHASE.BATTLE; this.gs.winner = null; this.sim.startMatch(); this.tickN = 0; this.acc = 0;
    this.broadcast({ t: T.GAME_START, targets: this.sim.targetList(), tac: this.tac() }); this.broadcastState();
  }
  endMatch() {
    this.sendSnapshots();
    this.gs.phase = PHASE.RESULT; this.gs.winner = this.sim.winner; this.gs.resultT = RESULT_TIME;
    const players = this.list.map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, kills: p.kills, deaths: p.deaths, tk: p.tk })).sort((a, b) => b.score - a.score);
    this.broadcast({ t: T.GAME_END, winner: this.sim.winner, players }); this.broadcastState();
  }
  toLobby() {
    this.gs.reset(); this.sim.reset();
    for (const p of this.list) { p.ready = false; p.inGame = false; }
    this.broadcastState();
  }
  loop() {
    const now = Date.now(); let dt = Math.min(.25, (now - this.last) / 1000); this.last = now;
    const ph = this.gs.phase;
    this.sec += dt;
    if (this.sec >= 1) { this.sec = 0; this.housekeeping(now); }
    if (ph === PHASE.COUNTDOWN) { const c = Math.ceil(this.gs.countdown); this.gs.countdown -= dt; if (this.gs.countdown <= 0) this.startBattle(); else if (Math.ceil(this.gs.countdown) !== c) this.broadcastState(); }
    else if (ph === PHASE.RESULT) { this.gs.resultT -= dt; if (this.gs.resultT <= 0) this.toLobby(); }
    else if (ph === PHASE.BATTLE) {
      const TICK = 1 / TICK_RATE; this.acc += dt;
      while (this.acc >= TICK && this.gs.phase === PHASE.BATTLE) {
        this.acc -= TICK; this.tickN++;
        this.sim.stepPhysics(TICK);
        if (this.tickN % 2 === 0) this.sim.combatStep(1 / 60);
        if (this.tickN % SNAP_EVERY === 0) this.sendSnapshots();
        if (this.sim.ended) { this.endMatch(); break; }
      }
    }
  }
  housekeeping(now) {
    for (const p of this.list.slice()) {
      if (!p.connected && now - p.discAt > GRACE_MS) this.removePlayer(p, 'timeout');
      else if (p.ws && now - p.lastMsg > IDLE_MS) { try { p.ws.terminate(); } catch (e) { } }
    }
    if (this.gs.phase === PHASE.LOBBY || this.gs.phase === PHASE.BATTLE) this.broadcastState();
  }
  sendSnapshots() {
    const sim = this.sim, tk = this.tickN, st = Date.now();
    const body = JSON.stringify({ c: sim.craftEntries(), m: sim.missileEntries(), b: [sim.teams.blue.base.hp, sim.teams.red.base.hp], ev: sim.takeEvents(), w: sim.wave });
    const inner = body.slice(1, -1);
    for (const p of this.list) {
      const ws = p.ws; if (!ws || ws.readyState !== 1) continue;
      if (ws.bufferedAmount > 1 << 20) continue; // 遅いクライアントには送らない
      const me = p.inGame ? JSON.stringify(sim.meState(p)) : 'null';
      ws.send('{"t":"snapshot","tk":' + tk + ',"st":' + st + ',"ack":' + p.lastSeq + ',"me":' + me + ',' + inner + '}');
    }
  }
}
module.exports = Room;
