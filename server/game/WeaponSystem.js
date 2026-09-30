'use strict';
const T = require('three');
const V3 = T.Vector3;
const { Hg } = require('../../shared/world.js');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;

const tmpA = new V3(), tmpB = new V3(), tmpO = new V3(), tmpV = new V3();
// 元ゲームの hitSeg(線分-球の交差判定)
function hitSeg(a, b, c, r) {
  const ab = tmpA.subVectors(b, a), t = clamp(tmpB.subVectors(c, a).dot(ab) / (ab.lengthSq() || 1e-6), 0, 1);
  return tmpB.copy(a).addScaledVector(ab, t).distanceToSquared(c) < r * r;
}

const MAX_BULLETS = 700;
const LOCK_TIME = 2;

/** 機銃・ミサイル・チャフを管理。命中/ダメージ判定はすべてここ(サーバー)で行う。 */
class WeaponSystem {
  constructor(sim) { this.sim = sim; this.reset(); }
  reset() {
    this.bullets = []; this.free = []; this.missiles = []; this.chaffs = [];
    this.nextB = 1; this.nextM = 1;
  }
  ownerCode(o) { return (o.team === 'red' ? 1 : 0) + (o.human ? 0 : 2); }

  spawnBullet(owner, p, v) {
    if (this.bullets.length >= MAX_BULLETS) return;
    const b = this.free.pop() || { p: new V3(), v: new V3() };
    b.id = this.nextB++; b.p.copy(p); b.v.copy(v); b.life = 2.4; b.o = owner;
    this.bullets.push(b);
    this.sim.event([0, b.id, r1(p.x), r1(p.y), r1(p.z), r1(v.x), r1(v.y), r1(v.z), this.ownerCode(owner)]);
  }
  // 弾のダメージ(元ゲーム準拠: 対人機/赤AI→3、味方AI→敵AIは1)
  bulletDmg(target, owner) { return (target.human || (!owner.human && owner.team === 'red')) ? 3 : 1; }

  stepBullets(dt) {
    const sim = this.sim, bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i], old = tmpO.copy(b.p);
      b.v.y -= 9.81 * dt; b.p.addScaledVector(b.v, dt); b.life -= dt;
      const o = b.o, foe = o.team === 'red' ? 'blue' : 'red';
      let hit = -1;
      if (o.human) for (const t of sim.targets) if (t.alive && hitSeg(old, b.p, t.p, t.r)) { sim.dmgTarget(t, o); hit = 0; break; }
      if (hit < 0) for (const c of sim.cr[foe]) {
        if (!sim.alive(c)) continue;
        if (hitSeg(old, b.p, c.p, c.human ? 4.5 : 5)) { sim.damage(c, this.bulletDmg(c, o), o, 'gun'); hit = 0; break; }
      }
      if (hit < 0) { const base = sim.teams[foe].base; if (base.hp > 0 && hitSeg(old, b.p, base.p, base.r)) { sim.hitBase(base, 1, o); hit = 2; } }
      if (hit < 0 && b.p.y < Hg(b.p.x, b.p.z)) hit = 1;
      if (hit >= 0 || b.life <= 0) {
        if (hit >= 0) sim.event([1, b.id, r1(b.p.x), r1(b.p.y), r1(b.p.z), hit]);
        this.free.push(b); bs[i] = bs[bs.length - 1]; bs.pop();
      }
    }
  }

  // 人間のミサイル発射(元 launchMsl)
  launchHuman(p) {
    p.msl--; p.mslCd = 1; p.msLR = -p.msLR;
    const S = p.S, f = new V3(0, 0, -1).applyQuaternion(S.q), pos = new V3(p.msLR * 2.4, -.55, -1).applyQuaternion(S.q).add(S.pos);
    const m = { id: this.nextM++, o: p, human: true, p: pos, f, sp: Math.max(S.V, 50) + 20, life: 8, t: p.lock.ok ? p.lock.t : null, dc: null };
    this.missiles.push(m);
    this.sim.event([2, m.id, r1(pos.x), r1(pos.y), r1(pos.z)]);
    if (p.lock.ok) { p.lock.ok = false; p.lock.time = 0; }
  }
  // AIのミサイル発射(元 launchEM)
  launchAI(e) {
    const m = { id: this.nextM++, o: e, human: false, p: e.p.clone().addScaledVector(e.f, 5), f: e.f.clone(), sp: e.spd + 30, life: 10, t: e.tg, dc: null };
    this.missiles.push(m);
    this.sim.event([2, m.id, r1(m.p.x), r1(m.p.y), r1(m.p.z)]);
  }
  stepMissile(m, dt) {
    const sim = this.sim, hu = m.human, o = m.o, foe = o.team === 'red' ? 'blue' : 'red';
    m.life -= dt; m.sp = Math.min(hu ? 300 : 260, m.sp + (hu ? 150 : 120) * dt);
    let tp = null, tv = null;
    if (m.dc) { if (m.dc.life > 0) { tp = m.dc.p; tv = m.dc.v; } }
    else if (m.t && !m.t.isBase && sim.alive(m.t)) { tp = m.t.p; tv = sim.vel(m.t, tmpV); }
    if (tp) {
      const dist = tp.distanceTo(m.p), aim = tp.clone().addScaledVector(tv, dist / m.sp * (hu ? 1 : .7)).sub(m.p).normalize(), ang = Math.acos(clamp(m.f.dot(aim), -1, 1));
      if (ang > 1e-4) m.f.applyAxisAngle(new V3().crossVectors(m.f, aim).normalize(), Math.min(ang, (hu ? 2.4 : 1.6) * dt));
    }
    const old = tmpO.copy(m.p); m.p.addScaledVector(m.f, m.sp * dt);
    let end = m.life <= 0 || m.p.y < Hg(m.p.x, m.p.z);
    if (!end && m.dc && m.dc.life > 0 && hitSeg(old, m.p, m.dc.p, 30)) end = true;
    else if (!end) {
      for (const c of sim.cr[foe]) if (sim.alive(c) && hitSeg(old, m.p, c.p, c.human ? 11 : 12)) { sim.damage(c, 40, o, 'missile'); end = true; break; }
      if (!end && hu) for (const t of sim.targets) if (t.alive && hitSeg(old, m.p, t.p, 12)) { t.hp = 1; sim.dmgTarget(t, o); end = true; break; }
      if (!end) { const base = sim.teams[foe].base; if (base.hp > 0 && hitSeg(old, m.p, base.p, base.r)) { sim.hitBase(base, 60, o); end = true; } }
    }
    if (end) sim.event([3, r1(m.p.x), r1(m.p.y), r1(m.p.z), hu ? 16 : 14, m.id]);
    return end;
  }
  step(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) if (this.stepMissile(this.missiles[i], dt)) this.missiles.splice(i, 1);
    this.stepBullets(dt);
    for (let i = this.chaffs.length - 1; i >= 0; i--) {
      const c = this.chaffs[i]; c.life -= dt; c.p.addScaledVector(c.v, dt); c.v.multiplyScalar(1 - .6 * dt); c.v.y -= 3 * dt;
      if (c.life <= 0) this.chaffs.splice(i, 1);
    }
  }
  dropChaff(p) {
    p.chaff--; p.chaffCd = .6;
    const c = { p: p.S.pos.clone(), v: p.S.vel.clone().multiplyScalar(.35), life: 6 };
    this.chaffs.push(c);
    for (const m of this.missiles) if (m.t === p && !m.dc && m.p.distanceTo(p.S.pos) < 2500 && Math.random() < .85) m.dc = c;
    this.sim.event([4, r1(c.p.x), r1(c.p.y), r1(c.p.z), r1(c.v.x), r1(c.v.y), r1(c.v.z)]);
  }
}
WeaponSystem.LOCK_TIME = LOCK_TIME;
WeaponSystem.hitSeg = hitSeg;
module.exports = WeaponSystem;
