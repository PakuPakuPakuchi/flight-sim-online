'use strict';
/* 戦闘ロジック検証(ネットワーク無し): 被弾→HP減少→撃墜→キル帰属→リスポーン→基地破壊→勝敗、AI稼働 */
const T = require('three'); const V3 = T.Vector3;
const Room = require('../game/Room.js'); const Player = require('../game/Player.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const room = new Room('t'); clearInterval(room.timer);
const A = new Player(room.nextId(), 'A', 'blue', 'a'), B = new Player(room.nextId(), 'B', 'red', 'b');
room.list.push(A, B); room.gs.phase = 'battle'; room.sim.startMatch(); const sim = room.sim;
const step = n => { for (let i = 0; i < n; i++) { sim.stepPhysics(1 / 120); if (i % 2) sim.combatStep(1 / 60); } };
step(10);
ok(sim.ai.some(a => a.team === 'blue') && sim.humans().length === 2, 'AI spawned, both humans in game');
// 空中に上げて A の正面 200m に B を置く → A が射撃
for (const p of [A, B]) { p.S.onGround = false; p.S.pos.y = 900; p.S.vel.set(0, 0, 0); }
A.S.pos.set(0, 900, -2000); B.S.pos.set(0, 900, -2200); A.S.q.set(0, 0, 0, 1); B.S.q.set(0, 0, 0, 1);
sim.ai.length = 0; sim.teams.red.spawnT = sim.teams.blue.spawnT = 1e9;
sim.weapons.bullets.length = 0;
const hp0 = B.hp; let pos = A.S.pos.clone();
for (let n = 0; n < 6; n++) { sim.weapons.spawnBullet(A, new V3(0, 900, -2003), new V3(0, 0, -560)); }
for (let i = 0; i < 90; i++) { A.S.pos.set(0, 900, -2000); B.S.pos.set(0, 900, -2200); A.S.vel.set(0, 0, 0); B.S.vel.set(0, 0, 0); sim.combatStep(1 / 60); }
ok(B.hp < hp0 && B.hp === hp0 - 18, 'server bullet hits reduce HP (' + B.hp + ')');
// 撃墜: HP を弾で削り切る → キル帰属・スコア・リスポーン
B.hp = 2; B.S.pos.set(0, 900, -2200);
sim.weapons.spawnBullet(A, new V3(0, 900, -2003), new V3(0, 0, -560)); for (let i = 0; i < 60; i++) { B.S.pos.set(0, 900, -2200); sim.combatStep(1 / 60); }
ok(!B.alive && B.deaths === 1 && A.kills === 1 && A.score === 500, 'B shot down, kill/death/score attributed on server');
for (let i = 0; i < 60 * 11; i++) sim.combatStep(1 / 60);
ok(B.alive && B.hp === 100 && B.S.onGround, 'B respawned at base after 10 s');
// 基地攻撃
const rb = sim.teams.red.base; for (let i = 0; i < 600; i++) sim.hitBase(rb, 1, A);
ok(rb.hp === 0 && sim.ended && sim.winner === 'blue', 'base destroyed -> BLUE wins (server decides)');
// 入力検証
const P = require('../../shared/protocol.js'); const i = P.sanitizeInput({ el: 5, thr: -3, flaps: 99, gear: 'x', fire: 1 });
ok(i.el === 1 && i.thr === 0 && i.flaps === 3 && i.gear === 1 && i.fire === true, 'input sanitised to valid ranges');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
