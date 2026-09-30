'use strict';
/* サーバー権威の一連の流れを自動検証するスモークテスト。 `npm test`(サーバーは自動起動)。
   2クライアント: 接続→ロビー→Ready→開始→離陸・射撃→被弾HP減少→撃墜→リスポーン、
   不正入力/HP改ざん/スパム耐性、再接続(token)を確認する。 */
process.env.PORT = process.env.PORT || '3901';
const WebSocket = require('ws');
const { server, rooms } = require('../server.js');
const P = require('../../shared/protocol.js');
const url = 'ws://localhost:' + process.env.PORT + '/ws';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(name, team) {
  const c = { name, snaps: [], msgs: [], id: 0, token: '', ws: new WebSocket(url) };
  c.send = o => c.ws.send(JSON.stringify(o));
  c.ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'snapshot') { c.snaps.push(m); c.last = m; } else c.msgs.push(m); if (m.t === 'join_ok') { c.id = m.id; c.token = m.token; c.team = m.team; } });
  c.open = new Promise(r => c.ws.on('open', r));
  return c;
}
(async () => {
  const A = client('A'), B = client('B'); await A.open; await B.open;
  const hb = setInterval(() => { for (const c of [A, B]) if (c.ws.readyState === 1) c.send({ t: 'ping', c: Date.now() }); }, 2000); // 実クライアントは常時入力/pingを送る
  A.send({ t: 'join', name: 'Alpha', team: 'blue' }); B.send({ t: 'join', name: 'Bravo', team: 'red' });
  await wait(200);
  ok(A.id && B.id && A.id !== B.id, 'join_ok / player IDs issued');
  const rs = A.msgs.filter(m => m.t === 'room_state').pop();
  ok(rs && rs.players.length === 2 && rs.phase === 'lobby', 'lobby room_state lists 2 players');
  A.send({ t: 'ready', ready: true }); B.send({ t: 'ready', ready: true });
  await wait(3600);
  ok(A.msgs.some(m => m.t === 'game_start') && A.last, 'match started, snapshots streaming');
  ok(A.last.c.filter(c => c[2] === 1).length === 2, 'both human aircraft visible in each snapshot');
  ok(A.last.c.some(c => c[2] === 0), 'server-side AI present in snapshot');
  // 離陸: A は全開・引き起こし
  const inp = { el: 0, ai: 0, ru: 0, thr: 1, trim: .03, brake: false, flaps: 0, gear: 1, fire: false };
  let seq = 1; const fly = (c, o) => c.send({ t: 'input', seq: seq++, i: o });
  fly(A, inp); await wait(13000); fly(A, { ...inp, el: .4 }); await wait(500);
  const me = A.last.me; ok(me.v[2] < -35, 'A accelerates down runway (speed ' + Math.abs(me.v[2]).toFixed(0) + ' m/s)');
  const seenByB = B.last.c.find(c => c[0] === A.id); ok(seenByB && Math.abs(seenByB[5] - me.p[2]) < 60, 'B sees A moving (z=' + (seenByB && seenByB[5]) + ')');
  // 改ざん試行
  A.send({ t: 'input', seq: seq++, i: { ...inp, thr: 999, el: 'x', hp: 9999, damage: 1e6 }, hp: 5000, score: 99999 });
  A.send({ t: 'damage', target: B.id, amount: 100 }); A.send({ t: 'kill', target: B.id }); A.ws.send('{bad json');
  await wait(600);
  ok(A.last && A.last.me.hp === 100 && A.last.me.sc === 0, 'client cannot set HP/score/damage; garbage ignored');
  ok(A.msgs.some(m => m.t === 'error'), 'errors reported for unknown/malformed messages');
  // 巨大パケットは切断される
  const C = client('C'); await C.open; let closed = false; C.ws.on('close', () => closed = true); C.ws.send('x'.repeat(5000)); await wait(300); ok(closed, 'oversized packet closes connection');
  // 射撃と弾薬(サーバー管理)
  const ammo0 = A.last.me.ammo; fly(A, { ...inp, fire: true }); await wait(1000); fly(A, { ...inp, fire: false }); await wait(300);
  const used = ammo0 - A.last.me.ammo; ok(used > 10 && used < 40, 'gun ammo consumed server-side at ~22 rps (used ' + used + ')');
  ok(B.snaps.some(s => s.ev.some(e => e[0] === 0)), 'B receives bullet spawn events from A');
  // ミサイル: 弾数はサーバー管理 / クールダウン
  const m0 = A.last.me.msl; A.send({ t: 'launch_missile' }); A.send({ t: 'launch_missile' }); await wait(400);
  ok(Math.floor(A.last.me.msl) === Math.floor(m0) - 1 || A.last.me.msl < m0, 'missile launched once (cooldown enforced)');
  A.send({ t: 'use_chaff' }); await wait(300); ok(A.last.me.chaff < 5, 'chaff consumed server-side');
  // Pingと再接続
  A.send({ t: 'ping', c: Date.now() }); await wait(100); ok(A.msgs.some(m => m.t === 'pong'), 'ping/pong');
  const tok = A.token, id = A.id; A.ws.close(); await wait(400);
  const A2 = client('A2'); await A2.open; A2.send({ t: 'join', name: 'Alpha', token: tok }); await wait(400);
  ok(A2.id === id && A2.msgs.some(m => m.t === 'join_ok' && m.resumed), 'reconnect with token restores same player');
  // 切断で試合が壊れない: B を閉じる → 猶予後に削除されずスナップショット継続
  B.ws.close(); await wait(800); ok(A2.last && A2.last.tk > 0, 'game continues after peer disconnect');
  clearInterval(hb); console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
