'use strict';
/**
 * サーバー側のゲーム世界。元ゲームの combatStep / enemyStep / allyStep / missileStep /
 * bulletStep / lockStep / hitBase などを、チーム対称(BLUE=元の味方側 / RED=元の敵側)に一般化して移植。
 *  - RED AI  = 元の「敵機」ロジック(ミサイル・回避機動あり)
 *  - BLUE AI = 元の「味方機」ロジック(機銃のみ)
 */
const T = require('three');
const V3 = T.Vector3, Q = T.Quaternion, M4 = T.Matrix4;
const World = require('../../shared/world.js');
const Flight = require('../../shared/flight.js');
const WeaponSystem = require('./WeaponSystem.js');
const { Hg, EB, H, WATER } = World;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const UP = new V3(0, 1, 0);
const LOCK_RANGE = 1500, LOCK_TIME = 2;
const ENEMY_AIM_SPREAD = .15, ENEMY_LEAD = .55;
const ALLY_MAX = 15;
const AI_HP = 60;       // AI機体HP(人間は100)。機銃ダメージは人間/AI共通の3
const AI_CEIL = 1500;   // AIが飛ぶ高度の上限(海抜m)。超えると降下に転じる
const AI_CRUISE = 70;   // AIの巡航速度目標(m/s)。この機体の推力で出せる実質上限に近い
// 基地の対空砲(命中率は低め): 射程・上限高度・発射間隔・弾速・照準誤差(σ=sigma0+距離*sigmaK)・炸裂半径・ダメージ
const AA = { range: 1800, maxAlt: 2400, interval: 2.6, shellV: 520, sigma0: 12, sigmaK: .04, burstR: 22, dmg: 9 };
const AA_POS = [[-75, 70], [85, -45], [5, 100]]; // 基地中心からの砲の位置(x,z)
const _gp = new V3();
/** AI機。人間と同じ飛行状態 S を共有物理で更新し、操縦入力 inp (el/ai/thr...) だけで飛ぶ。 */
class AIPilot {
  constructor(o) { Object.assign(this, o); }
  get p() { return this.S.pos; }
  get f() { return new V3(0, 0, -1).applyQuaternion(this.S.q); }
  get q() { return this.S.q; }
  get spd() { return this.S.V; }
  get alive() { return !this.dead; }
}
const rtac = () => { const r = Math.random(); return r < .1 ? 3 : r < .55 ? 1 : 2; };
const foeOf = t => t === 'red' ? 'blue' : 'red';

class GameSimulation {
  constructor(room) {
    this.room = room; this.weapons = new WeaponSystem(this);
    this.events = []; this.tick = 0; this.time = 0;
    this.reset();
  }
  reset() {
    this.ai = []; this.targets = []; this.cr = { blue: [], red: [] };
    this.weapons.reset(); this.events.length = 0; this.flak = [];
    const mk = (team, pos) => ({ isBase: true, team, p: new V3(pos.x, pos.y, pos.z), f: new V3(), spd: 0, r: World.BASE_R, hp: World.BASE_HP, max: World.BASE_HP, aa: AA_POS.map(() => ({ cd: 2 + Math.random() * 2 })) });
    this.teams = {
      blue: { tac: rtac(), base: mk('blue', World.BLUE_BASE), re: [], spawnT: 0, name: 'BLUE' },
      red: { tac: rtac(), base: mk('red', World.RED_BASE), re: [], spawnT: 1.5, name: 'RED' }
    };
    this.wave = 1; this.killsTotal = 0; this.ended = false; this.winner = null; this.tgtClear = 0; this.lastTk = null;
  }
  event(e) { if (this.events.length < 500) this.events.push(e); }
  boom(p, s) { this.event([6, r1(p.x), r1(p.y), r1(p.z), s]); }

  // ---------- 共通ヘルパ ----------
  alive(c) { return c.isBase ? c.hp > 0 : c.human ? c.alive : !c.dead; }
  vel(c, out) { return c.S ? out.copy(c.S.vel) : out.copy(c.f).multiplyScalar(c.spd); }
  humans(team) { return this.room.playerList().filter(p => p.inGame && (!team || p.team === team)); }
  nearest(list, pt) { let b = null, bd = 1e15; for (const x of list) { const d = x.p.distanceToSquared(pt); if (d < bd) { bd = d; b = x; } } return b; }
  aiTargetCount(team) {
    const total = team === 'blue' ? Math.min(2 + this.wave, ALLY_MAX) + 1 : Math.min(3 + this.wave, 7);
    return Math.max(0, total - this.humans(team).length);
  }
  rebuildLists() {
    for (const t of ['blue', 'red']) {
      const l = this.cr[t]; l.length = 0;
      for (const p of this.room.playerList()) if (p.team === t && p.alive) l.push(p);
      for (const a of this.ai) if (a.team === t && !a.dead) l.push(a);
    }
  }

  // ---------- 開始・スポーン ----------
  startMatch() {
    this.reset();
    this.spawnTargets();
    for (const p of this.room.playerList()) if (p.connected || true) this.spawnPlayer(p);
    for (let i = 0; i < Math.min(3, this.aiTargetCount('blue')); i++) this.spawnAI('blue');
  }
  spawnPlayer(p) {
    const same = this.room.playerList().filter(x => x.team === p.team);
    p.S = Flight.newState(p.team, Math.max(0, same.indexOf(p)));
    p.resetWeapons(); p.inGame = true; p.lastHit = null;
    p.inp = { el: 0, ai: 0, ru: 0, thr: 0, trim: .03, brake: false, flaps: 0, gear: 1, fire: false };
  }
  spawnAI(team) {
    const red = team === 'red', slots = red ? 7 : ALLY_MAX;
    const mine = this.ai.filter(a => a.team === team);
    const slot = Array.from({ length: slots }, (_, i) => i).find(i => !mine.some(x => x.slot === i)) ?? 0;
    // 自軍滑走路の上空から離陸済みの状態で出撃(人間の空中スタートと同じ)
    const S = Flight.newState(team, 0);
    S.pos.set(((slot % 5) - 2) * 70 + (Math.random() - .5) * 20, 330 + (slot % 3) * 35 + Math.random() * 20,
      red ? EB.z - 650 + Math.floor(slot / 5) * 120 : 150 - Math.floor(slot / 5) * 120);
    S.onGround = false; S.gearS = 0; S.gearT = 0; S.thr = .7; S.V = 72;
    S.vel.set(0, 0, -72).applyQuaternion(S.q);
    const a = new AIPilot({
      id: this.room.nextId(), human: false, team, S, slot,
      inp: { el: 0, ai: 0, ru: 0, thr: .7, trim: .03, brake: false, flaps: 0, gear: 0, fire: false },
      hp: AI_HP + (red ? Math.min(this.wave, 8) * 2 : 0), ammo: 800, fireT: 0, gunSide: 1, aimT: 0,
      margin: .015 + Math.random() * .05, bank: 0, bt: 0, sh: 0, rest: 1 + Math.random() * 2, age: 0, seed: Math.random() * 9, dead: false, avoid: 0,
      name: red ? 'RED-AI' : 'BLUE-AI'
    });
    this.ai.push(a); return a;
  }
  spawnTargets() {
    this.targets.length = 0;
    for (let i = 0; i < 12; i++) {
      let x, z, h, n = 0;
      do { x = (Math.random() - .5) * 1400; z = -300 - Math.random() * 2200; h = H(x, z); n++; } while ((h < -3 || Math.abs(x) < 40 && z > -1450) && n < 60);
      h = Math.max(h, WATER);
      const tank = i % 3 !== 2;
      this.targets.push({ x: r1(x), y: r1(h), z: r1(z), ry: r3(Math.random() * 6.28), tank, p: new V3(x, h + (tank ? 1.5 : 4.5), z), r: tank ? 4.2 : 5.5, hp: tank ? 8 : 14, alive: true, big: !tank });
    }
  }
  targetList() { return this.targets.map(t => [t.x, t.y, t.z, t.ry, t.tank ? 1 : 0, t.alive ? 1 : 0]); }
  dmgTarget(t, owner) {
    this.event([5, r1(t.p.x), r1(t.p.y), r1(t.p.z)]);
    if (--t.hp > 0) return;
    t.alive = false; this.boom(t.p, t.big ? 24 : 14); this.event([7, this.targets.indexOf(t)]);
    if (owner.human) { owner.score += t.big ? 150 : 100; owner.tk++; this.lastTk = owner; }
  }

  // ---------- ダメージ・撃墜 ----------
  damage(c, dmg, owner, weapon) {
    if (!this.alive(c)) return;
    c.hp -= dmg;
    if (c.human) {
      c.lastHit = { by: owner, t: this.time }; this.room.send(c, { t: 'hit', dmg });
      if (c.hp <= 0) { c.hp = 0; this.killHuman(c, weapon === 'flak' ? '敵基地の対空砲火に撃墜されました' : '敵機に撃墜されました', owner, weapon); }
    } else if (c.hp <= 0) this.killAI(c, owner, weapon);
  }
  credit(owner, victim, weapon) {
    this.killsTotal++;
    if (owner && owner.human) { owner.score += 500; owner.kills++; }
    if (owner) this.room.broadcast({ t: 'kill_feed', k: owner.name, kt: owner.team, v: victim.name, vt: victim.team, w: weapon || 'gun' });
    else if (weapon === 'flak') this.room.broadcast({ t: 'kill_feed', k: '対空砲', kt: foeOf(victim.team), v: victim.name, vt: victim.team, w: 'flak' });
  }
  killAI(a, owner, weapon, noCredit) {
    if (a.dead) return;
    a.dead = true; this.boom(a.p, a.team === 'red' ? 26 : 22);
    this.teams[a.team].re.push(10);
    if (!noCredit) this.credit(owner, a, weapon);
    else this.killsTotal++;
    const i = this.ai.indexOf(a); if (i >= 0) this.ai.splice(i, 1);
  }
  killHuman(p, msg, owner, weapon) {
    if (!p.alive) return;
    const S = p.S; S.crashed = true; this.boom(S.pos, 18); S.vel.set(0, 0, 0); S.w.set(0, 0, 0); S.thr = 0;
    p.respawn = 10; p.cmsg = msg; p.deaths++; p.lock.t = null; p.lock.time = 0; p.lock.ok = false;
    if (!owner && p.lastHit && this.time - p.lastHit.t < 6) owner = p.lastHit.by;
    if (owner === p) owner = null;
    this.credit(owner, p, weapon || (msg.includes('衝突') ? 'crash' : 'gun'));
    this.room.send(p, { t: 'death', msg, by: owner ? owner.name : null });
  }
  hitBase(b, d, owner) {
    if (b.hp <= 0 || this.ended) return;
    b.hp -= d; this.event([8, b.team === 'red' ? 1 : 0]);
    if (b.hp <= 0) {
      b.hp = 0; for (let i = 0; i < 5; i++) this.boom(b.p.clone().add(new V3((Math.random() - .5) * 70, 0, (Math.random() - .5) * 70)), 30);
      this.ended = true; this.winner = foeOf(b.team);
    }
  }

  // ---------- 人間: 入力→物理(固定 dt、通常 1/120) ----------
  stepPhysics(dt) {
    for (const p of this.room.playerList()) {
      if (!p.alive) continue;
      Flight.applyInput(p.S, p.inp, dt);
      const msg = Flight.physics(p.S, dt);
      if (msg) this.killHuman(p, msg, null, 'crash');
    }
    for (const a of this.ai.slice()) {
      if (a.dead) continue;
      Flight.applyInput(a.S, a.inp, dt);
      a.S.fuel = 1; // AIは燃料切れなし
      const msg = Flight.physics(a.S, dt);
      if (msg) {
        const fb = this.teams[foeOf(a.team)].base;
        if (a.kam && a.S.pos.distanceTo(fb.p) < fb.r * 1.3) { this.boom(a.S.pos, 22); this.hitBase(fb, 60, a); }
        this.killAI(a, null, null, true);
      }
    }
  }

  // ---------- 戦闘ステップ(元 combatStep) ----------
  combatStep(dt) {
    this.time += dt;
    if (this.ended) return;
    this.rebuildLists();
    for (const p of this.room.playerList()) if (p.inGame) { this.fire(p, dt); this.respawnStep(p, dt); this.lockStep(p, dt); this.baseHeal(p, dt); }
    this.weapons.step(dt);
    this.baseAA(dt);
    // AI 補充
    for (const team of ['blue', 'red']) {
      const tm = this.teams[team]; tm.spawnT -= dt;
      const n = this.ai.filter(a => a.team === team).length + tm.re.length;
      if (n < this.aiTargetCount(team) && tm.spawnT <= 0) { this.spawnAI(team); tm.spawnT = 2; }
      for (let i = tm.re.length - 1; i >= 0; i--) { tm.re[i] -= dt; if (tm.re[i] <= 0) { tm.re.splice(i, 1); if (this.ai.filter(a => a.team === team).length < this.aiTargetCount(team)) this.spawnAI(team); } }
    }
    for (const a of this.ai.slice()) if (!a.dead) (a.team === 'red' ? this.stepE(a, dt) : this.stepA(a, dt));
    this.collisions();
    if (this.targets.every(t => !t.alive)) {
      this.tgtClear += dt;
      if (this.tgtClear > 5) { if (this.lastTk) this.lastTk.score += 300; this.tgtClear = 0; this.spawnTargets(); this.room.broadcast({ t: 'target_state', targets: this.targetList() }); }
    }
    this.wave = 1 + Math.floor(this.killsTotal / 3);
  }
  fire(p, dt) {
    p.fireT = Math.max(p.fireT - dt, -.05);
    if (!p.inp.fire || !p.alive || p.ammo <= 0) return;
    const S = p.S;
    while (p.fireT <= 0 && p.ammo > 0) {
      p.fireT += 1 / 22; p.ammo--; p.gunSide = -p.gunSide;
      const mz = new V3(p.gunSide * 1.45, -.12, -1.9).applyQuaternion(S.q).add(S.pos), d = new V3(0, 0, -1).applyQuaternion(S.q);
      d.x += (Math.random() - .5) * .004; d.y += (Math.random() - .5) * .004; d.normalize();
      this.weapons.spawnBullet(p, mz, d.multiplyScalar(560).add(S.vel));
    }
  }
  respawnStep(p, dt) {
    p.mslCd -= dt; p.chaffCd -= dt;
    if (!p.S.crashed) return;
    p.respawn -= dt;
    if (p.respawn <= 0) { this.spawnPlayer(p); this.room.send(p, { t: 'respawn' }); }
  }
  baseHeal(p, dt) {
    const S = p.S, base = this.teams[p.team].base;
    if (p.alive && S.onGround && S.V < 15 && base.hp > 0 && World.onRunway(p.team, S.pos.x, S.pos.z)) {
      p.ammo = Math.min(800, p.ammo + 250 * dt); p.msl = Math.min(6, p.msl + .5 * dt); p.chaff = Math.min(5, p.chaff + .3 * dt);
      p.hp = Math.min(100, p.hp + 8 * dt); S.fuel = Math.min(1, S.fuel + .1 * dt);
    }
  }
  lockStep(p, dt) {
    const lock = p.lock;
    if (!p.alive) { lock.t = null; lock.time = 0; lock.ok = false; return; }
    const S = p.S, pf = new V3(0, 0, -1).applyQuaternion(S.q), foes = this.cr[foeOf(p.team)];
    const cosTo = e => { const to = e.p.clone().sub(S.pos), d = to.length(); return d > 150 && d < LOCK_RANGE ? pf.dot(to.divideScalar(d)) : -1; };
    if (lock.t && (!this.alive(lock.t) || cosTo(lock.t) < (lock.ok ? .9 : .965))) { lock.t = null; lock.time = 0; lock.ok = false; }
    if (!lock.t) { let best = null, bc = .965; for (const e of foes) { if (!this.alive(e)) continue; const c = cosTo(e); if (c > bc) { bc = c; best = e; } } if (best) { lock.t = best; lock.time = 0; } }
    else if (!lock.ok) { lock.time += dt; if (lock.time >= LOCK_TIME) lock.ok = true; }
    if (lock.t && lock.time > .3 && lock.t.human) lock.t.lkdT = this.time;
  }
  // メッセージ経由の武器操作(サーバーが可否を検証)
  requestMissile(p) {
    if (!p.alive || p.mslCd > 0 || p.msl < 1 || this.ended) return false;
    this.weapons.launchHuman(p); return true;
  }
  requestChaff(p) {
    if (!p.alive || p.chaffCd > 0 || p.chaff < 1 || this.ended) return false;
    this.weapons.dropChaff(p); return true;
  }
  collisions() {
    for (const p of this.room.playerList()) {
      if (!p.alive) continue;
      for (const c of this.cr[foeOf(p.team)]) {
        if (!this.alive(c) || c.p.distanceToSquared(p.p) > 49) continue;
        this.boom(c.p, 20);
        if (c.human) this.killHuman(c, '敵機と空中衝突しました', p, 'crash'); else this.killAI(c, p, 'crash');
        this.killHuman(p, '敵機と空中衝突しました', c.human ? c : null, 'crash'); break;
      }
    }
  }

  // ---------- AI 共通 ----------
  // 「進みたい方向 d」を人間と同じ操縦入力(エレベーター/エルロン/スロットル)に変換する。
  // 機体は共有物理(失速・エネルギー損失・推力限界)で飛ぶので、人間と同条件。
  pilot(a, d, dt) {
    const S = a.S, inp = a.inp, kam = !!a.kam, f = a.f, V = Math.max(S.V, 1);
    const agl = S.pos.y - Hg(S.pos.x, S.pos.z), dd = d.clone();
    let low = false;
    if (!kam) {
      if (S.pos.y > AI_CEIL - 300) dd.y = Math.min(dd.y, -clamp((S.pos.y - (AI_CEIL - 300)) / 600, 0, 1) * .25); // 高度上限
      dd.y += clamp((420 - S.pos.y) / 1500, -.05, .08);                     // 巡航高度(約420m)へ緩やかに戻る
      if (!a.avoid) dd.y = Math.min(dd.y, clamp((V - 52) / 80, 0, .2));   // 上昇は余剰速度の範囲内だけ
      if (V < 48) dd.y = Math.min(dd.y, -.08);                              // 速度が落ちたら機首を下げて加速
      if (V > 125) dd.y = Math.max(dd.y, 0);
      dd.y = Math.max(dd.y, -.55);
      const ahead = agl + dd.y * V * 2.5;
      if (a.avoid) { dd.y = Math.max(dd.y, .28); low = true; }
      else if (ahead < 110) { dd.y = Math.max(dd.y, clamp((110 - agl) / (V * 2.5), 0, .3)); low = agl < 160; }
    }
    dd.normalize();
    // --- ロール(バンク)制御: 水平方向の偏差に応じてバンクを取る ---
    const theta = Math.asin(clamp(f.y, -1, 1)), fh = Math.hypot(f.x, f.z), dh = Math.hypot(dd.x, dd.z);
    let psi = 0;
    if (fh > .2 && dh > .05) psi = Math.atan2(-(f.z * dd.x - f.x * dd.z) / (fh * dh), (f.x * dd.x + f.z * dd.z) / (fh * dh));
    let lim = clamp(.5 + (V - 45) * .04, .5, 1.25); if (low) lim = Math.min(lim, .45);
    const aiming = a.aiming; a.aiming = false; // 射撃照準中は機首そのものを追い込む(人間が照準器を合わせる操作)
    const phiT = clamp(psi * (aiming ? 3 : 1.5), -lim, lim);
    const r = new V3(1, 0, 0).applyQuaternion(S.q), u = new V3(0, 1, 0).applyQuaternion(S.q), phi = Math.atan2(-r.y, u.y);
    inp.ai = clamp((phiT - phi) * 2.2, -1, 1);
    // --- ピッチ制御: 必要荷重倍数 → 迎角 → エレベーター。迎角は失速手前で頭打ち ---
    const gam = Math.asin(clamp(dd.y, -1, 1));
    const fp = Math.asin(clamp(S.vel.y / V, -1, 1)); // 実際の飛行経路角(機首角ではなく経路で高度を保つ)
    let n = Math.cos(fp) / Math.max(.45, Math.cos(phi)) + (aiming ? 6 * (gam - theta) - 1.6 * S.w.x : 3.5 * (gam - fp) - 1.2 * S.w.x);
    if (Math.abs(phi) > 1.45) n = Math.min(n, .8);
    n = clamp(n, -1, 4);
    const rho = 1.225 * Math.exp(-Math.max(0, S.pos.y) / 8500), qd = .5 * rho * V * V;
    const aS = Flight.STALL_A0 + .02 * S.flaps;
    const alpha = clamp((n * 1100 * 9.81 / (qd * 16) - .25 - .5 * S.flaps) / 5.2, -.2, aS - a.margin);
    inp.el = clamp(alpha / .714 - inp.trim, -1, 1);
    // 照準中は小さな横ずれをラダーで微調整
    let ru = 0;
    if (aiming) { const dl = dd.clone().applyQuaternion(S.q.clone().invert()); ru = clamp(Math.atan2(dl.x, -dl.z) * 4, -1, 1); }
    inp.ru = ru;
    inp.thr = kam || V < 60 || a.avoid ? 1 : clamp(.6 + (AI_CRUISE + 2 - V) * .08, .45, 1);
    inp.gear = 0; inp.flaps = 0; inp.brake = false;
  }
  terrainAvoid(a, d) {
    const ah = a.p.clone().addScaledVector(a.f, a.spd * 4);
    a.avoid = 0;
    if (!a.kam && (a.p.y < Hg(a.p.x, a.p.z) + 120 || ah.y < Hg(ah.x, ah.z) + 80)) { d.set(a.f.x, .7, a.f.z).normalize(); a.avoid = 1; }
  }
  // 機銃の偏差射撃方向(弾は自機速度を引き継ぎ、重力で落ちる = 人間の機銃と同じ弾道)
  aimDir(a, tg) {
    const vrel = this.vel(tg, new V3()).sub(a.S.vel); let dist = tg.p.distanceTo(a.p), aim = new V3();
    for (let k = 0; k < 2; k++) { const t = dist / 560; aim.copy(tg.p).addScaledVector(vrel, t); aim.y += .5 * 9.81 * t * t; aim.sub(a.p); dist = aim.length(); }
    return aim.normalize();
  }
  // 近距離では偏差射撃点へ機首を向ける。人間同様の照準ブレを加える
  leadDir(a, tg, d, dist) {
    if (a.kam || dist < 140 || dist > 650) return d;
    a.aiming = true;
    const aim = this.aimDir(a, tg), j = .025;
    aim.x += Math.sin(a.age * 1.3 + a.seed) * j; aim.y += Math.sin(a.age * 1.9 + a.seed * 2) * j; aim.z += Math.sin(a.age * 1.1 + a.seed * 3) * j;
    return aim.normalize();
  }
  // 引き金: 機首が射撃点に十分合ってから(反応遅れ .25s)バーストで撃つ。機銃自体は人間と同じ fire()
  aiTrigger(a, tg, dt) {
    const inp = a.inp; inp.fire = false;
    if (tg && !a.kam) {
      a.rest -= dt;
      const dist = tg.p.distanceTo(a.p);
      if (a.rest <= 0 && dist > 50 && dist < 650) {
        const err = Math.acos(clamp(a.f.dot(this.aimDir(a, tg)), -1, 1));
        a.aimT = err < .022 ? a.aimT + dt : 0;
        if (a.aimT > .25) { inp.fire = true; a.bt += dt; if (a.bt > .9) { a.bt = 0; a.aimT = 0; a.rest = 1 + Math.random() * 1.5; } }
      } else a.aimT = 0;
    }
    if (a.ammo < 100) a.ammo = 800;
    this.fire(a, dt);
  }
  // 基地の対空砲: 低命中率の炸裂弾(照準誤差大・撃つ間隔長め)。基地が生きている間だけ作動
  baseAA(dt) {
    for (const team of ['blue', 'red']) {
      const base = this.teams[team].base; if (base.hp <= 0) continue;
      const foes = this.cr[foeOf(team)];
      base.aa.forEach((g, i) => {
        g.cd -= dt; if (g.cd > 0) return;
        const gp = _gp.set(base.p.x + AA_POS[i][0], base.p.y + 4, base.p.z + AA_POS[i][1]);
        let best = null, bd = AA.range * AA.range;
        for (const c of foes) { if (!this.alive(c)) continue; const d2 = c.p.distanceToSquared(gp); if (d2 < bd && c.p.y < AA.maxAlt && c.p.y - Hg(c.p.x, c.p.z) > 25) { bd = d2; best = c; } }
        if (!best) { g.cd = .25; return; }
        g.cd = AA.interval * (.8 + Math.random() * .4);
        const dist = Math.sqrt(bd), t = dist / AA.shellV, sg = AA.sigma0 + dist * AA.sigmaK;
        const nz = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sg;
        const bp = best.p.clone().addScaledVector(this.vel(best, new V3()), t); bp.x += nz(); bp.y += nz(); bp.z += nz();
        this.flak.push({ t, p: bp, team });
        this.event([5, r1(gp.x), r1(gp.y + 2), r1(gp.z)]);
      });
    }
    for (let i = this.flak.length - 1; i >= 0; i--) {
      const sh = this.flak[i]; sh.t -= dt; if (sh.t > 0) continue;
      this.flak.splice(i, 1); this.boom(sh.p, 8);
      for (const c of this.cr[foeOf(sh.team)]) if (this.alive(c) && c.p.distanceToSquared(sh.p) < AA.burstR * AA.burstR) this.damage(c, AA.dmg, null, 'flak');
    }
  }

  // ---- BLUE AI(元 allyStep / allyPick) ----
  // 基地攻撃に回すか判定: 近くに敵機がいれば迎撃優先、敵がいなければ基地、数的有利/敵基地が弱いほど攻撃役が増える
  baseRaid(team, a, fs, foeB) {
    if (foeB.hp <= 0) return false;
    if (!fs.length) return true;
    for (const c of fs) if (c.p.distanceToSquared(a.p) < 400 * 400) return false;
    const own = this.cr[team].filter(c => this.alive(c)).length, myB = this.teams[team].base;
    let share = own > fs.length ? .5 : own === fs.length ? .34 : .2;
    if (foeB.hp / foeB.max < .4) share += .25;
    if (myB.hp / myB.max < .35) share -= .15;
    return ((a.slot * .618) % 1) < clamp(share, 0, .9);
  }
  pickA(a) {
    const tac = this.teams.blue.tac, foeB = this.teams.red.base, fs = this.cr.red.filter(c => this.alive(c));
    if (a.kam) return foeB;
    if (this.baseRaid('blue', a, fs, foeB)) return foeB;
    if (tac === 1) { if (fs.length <= 1 && foeB.hp > 0) return foeB; return (a.tk && this.alive(a.tk)) ? a.tk : (a.tk = this.nearest(fs, a.p)); }
    if (tac === 2) { const b = this.ai.find(x => x.team === 'blue' && x !== a && x.slot === (a.slot ^ 1)); if (!b) return foeB.hp > 0 ? foeB : null; return this.nearest(fs, a.p.clone().add(b.p).multiplyScalar(.5)); }
    const c = new V3(), mine = this.ai.filter(x => x.team === 'blue'); for (const x of mine) c.add(x.p); c.divideScalar(mine.length || 1);
    return this.nearest(fs, c);
  }
  stepA(a, dt) {
    a.age += dt; const tac = this.teams.blue.tac, foeB = this.teams.red.base;
    if (!a.kam && tac === 3 && a.hp < 15) a.kam = true;
    const tg = this.pickA(a); let d;
    if (tg) {
      d = tg.p.clone().sub(a.p); const dist = Math.max(d.length(), 1); d.divideScalar(dist);
      if (tac === 1) { a.ex = (a.ex || 0) - dt; if (tg !== foeB && dist < 150) a.ex = 2.5; }
      if (!a.kam && (dist < 120 || (tac === 1 && a.ex > 0 && tg !== foeB))) d = a.f.clone().add(new V3(0, .25, 0)).normalize();
      else {
        if (tac === 2 && tg !== foeB && dist > 200) d.add(new V3().crossVectors(UP, d).normalize().multiplyScalar(((a.slot & 1) ? 1 : -1) * .3)).normalize();
        if (!a.kam) d = this.leadDir(a, tg, d, dist);
      }
    } else {
      const lead = this.humans('blue').filter(p => p.alive)[0];
      let tp;
      if (lead) tp = lead.S.pos.clone().add(new V3(((a.slot % 3) - 1) * 90, 25, 90 + Math.floor(a.slot / 3) * 60).applyQuaternion(lead.S.q));
      else tp = new V3(this.teams.blue.base.p.x + ((a.slot % 3) - 1) * 90, 0, this.teams.blue.base.p.z - 200 - Math.floor(a.slot / 3) * 60);
      tp.y = Math.max(tp.y, Hg(tp.x, tp.z) + 300); d = tp.sub(a.p); d = d.length() > 80 ? d.normalize() : a.f.clone();
    }
    this.terrainAvoid(a, d);
    this.pilot(a, d, dt);
    if (a.kam && (a.p.distanceTo(foeB.p) < 45 || a.p.y < Hg(a.p.x, a.p.z) + 3)) {
      this.boom(a.p, 22); if (a.p.distanceTo(foeB.p) < foeB.r * 1.3) this.hitBase(foeB, 60, a); this.killAI(a, null, null, true); return;
    }
    this.aiTrigger(a, tg, dt);
  }

  // ---- RED AI(元 enemyStep / pickTgt / enemyMissile) ----
  pickE(e) {
    const tac = this.teams.red.tac, blueB = this.teams.blue.base, fs = this.cr.blue.filter(c => this.alive(c));
    let best = null; e.tt = tac === 1 ? 2 : 1;
    if (this.baseRaid('red', e, fs, blueB)) { e.tg = blueB; return; }
    if (tac === 1) { if (fs.length <= 1) best = blueB; else best = (e.tk && this.alive(e.tk)) ? e.tk : (e.tk = this.nearest(fs, e.p)); }
    else if (tac === 2) { const b = this.ai.find(x => x.team === 'red' && x !== e && x.slot === (e.slot ^ 1)); best = b ? this.nearest(fs, e.p.clone().add(b.p).multiplyScalar(.5)) : blueB; }
    else { const c = new V3(), mine = this.ai.filter(x => x.team === 'red'); for (const x of mine) c.add(x.p); c.divideScalar(mine.length || 1); best = this.nearest(fs, c); }
    e.tg = best || blueB;
  }
  stepE(e, dt) {
    e.age += dt; e.tt = (e.tt || 0) - dt;
    const tac = this.teams.red.tac, blueB = this.teams.blue.base;
    if (!e.kam && e.hp < 15 && tac === 3) { e.kam = true; e.tg = blueB; }
    if (!e.kam && (!e.tg || e.tt <= 0 || (!e.tg.isBase && !this.alive(e.tg)))) this.pickE(e);
    const tg = e.tg, tv = this.vel(tg, new V3()), pf = tg.human ? tg.f : tg.f;
    const toP = tg.p.clone().sub(e.p), dist = Math.max(toP.length(), 1), dirP = toP.clone().divideScalar(dist);
    e.brk -= dt; if (dist < 800 && pf.dot(dirP) < -.85 && e.brk < -3) { e.brk = 2.2; e.bs = Math.random() < .5 ? 1 : -1; }
    if (tac === 1) { e.ex = (e.ex || 0) - dt; if (dist < 150 && tg !== blueB) e.ex = 2.5; }
    let d = dirP.clone();
    if (tac === 2 && tg !== blueB && dist > 200) d.add(new V3().crossVectors(UP, dirP).normalize().multiplyScalar(((e.slot & 1) ? 1 : -1) * .3)).normalize();
    if (e.brk > 0) d = new V3().crossVectors(e.f, UP).multiplyScalar(e.bs).add(new V3(0, -.35, 0)).normalize();
    else if (!e.kam && (dist < 140 || (tac === 1 && e.ex > 0 && tg !== blueB))) d = e.f.clone().add(new V3(0, .25, 0)).normalize();
    else { d.y += Math.sin(e.age * .5 + e.seed) * .08; d.normalize(); if (!e.kam) d = this.leadDir(e, tg, d, dist); }
    this.terrainAvoid(e, d);
    this.pilot(e, d, dt);
    if (e.kam && (dist < 45 || e.p.y < Hg(e.p.x, e.p.z) + 3)) {
      this.boom(e.p, 22); if (e.p.distanceTo(blueB.p) < blueB.r * 1.3) this.hitBase(blueB, 60, e); this.killAI(e, null, null, true); return;
    }
    if (dist < 7 && !tg.isBase) {
      this.boom(e.p, 20); this.killAI(e, null, null, true);
      if (tg.human) this.killHuman(tg, '敵機と空中衝突しました', null, 'crash'); else this.killAI(tg, null, null, true);
      return;
    }
    if (!e.kam) this.enemyMissile(e, dist, dirP, dt);
    this.aiTrigger(e, tg, dt);
  }
  enemyMissile(e, dist, dirP, dt) {
    e.mc = (e.mc === undefined ? 8 + Math.random() * 10 : e.mc) - dt;
    if (e.tg.isBase || dist > 1400 || dist < 250 || e.f.dot(dirP) < .96) { e.lk = 0; return; }
    e.lk = (e.lk || 0) + dt;
    if (e.lk > .3 && e.tg.human) e.tg.lkdT = this.time;
    if (e.lk >= LOCK_TIME + .5 && e.mc <= 0) { e.mc = 18 + Math.random() * 12; e.lk = 0; this.weapons.launchAI(e); }
  }

  // ---------- スナップショット ----------
  craftEntries() {
    const out = [];
    const push = (c, human) => {
      const q = c.S ? c.S.q : c.q, p = c.p;
      out.push([c.id, c.team === 'red' ? 1 : 0, human ? 1 : 0, r1(p.x), r1(p.y), r1(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w), Math.round(c.hp), human ? Math.round(c.S.thr * 100) : 0, human ? Math.round(c.S.gearT * 100) : 0, c.kam ? 1 : 0]);
    };
    for (const p of this.room.playerList()) if (p.alive) push(p, true);
    for (const a of this.ai) if (!a.dead) push(a, false);
    return out;
  }
  missileEntries() {
    return this.weapons.missiles.map(m => [m.id, r1(m.p.x), r1(m.p.y), r1(m.p.z), r3(m.f.x), r3(m.f.y), r3(m.f.z), m.o.team === 'red' ? 1 : 0, m.t && !m.t.isBase ? m.t.id : 0, m.dc ? 1 : 0, m.human ? 1 : 0]);
  }
  meState(p) {
    const S = p.S, lk = p.lock, v3 = v => [r3(v.x), r3(v.y), r3(v.z)];
    return {
      p: v3(S.pos), q: [r4(S.q.x), r4(S.q.y), r4(S.q.z), r4(S.q.w)], v: v3(S.vel), w: v3(S.w),
      thr: r3(S.thr), fuel: r4(S.fuel), flapT: S.flapT, flaps: r3(S.flaps), gearS: S.gearS, gearT: r3(S.gearT), brake: r3(S.brake),
      el: r3(S.el), ai: r3(S.ai), ru: r3(S.ru), trim: r3(S.trim), g: r3(S.g), t: r3(S.t), gr: S.onGround ? 1 : 0, cr: S.crashed ? 1 : 0,
      hp: Math.round(p.hp * 10) / 10, ammo: Math.floor(p.ammo), msl: r3(p.msl), chaff: r3(p.chaff), rs: Math.max(0, Math.ceil(p.respawn)),
      sc: p.score, k: p.kills, d: p.deaths, tk: p.tk, cmsg: p.cmsg,
      lk: [lk.t ? lk.t.id : 0, r3(lk.time), lk.ok ? 1 : 0], lkd: this.time - p.lkdT < .3 ? 1 : 0
    };
  }
  takeEvents() { const e = this.events; this.events = []; return e; }
}
module.exports = GameSimulation;
