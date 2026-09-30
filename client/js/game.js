/* オンラインクライアント: 元のオーディオ/警報音をそのまま使用 */
function audio(){if(AC)return;AC=new (window.AudioContext||window.webkitAudioContext)();eng=AC.createOscillator();eng.type='sawtooth';const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=420;engG=AC.createGain();engG.gain.value=0;eng.connect(f);f.connect(engG);engG.connect(AC.destination);eng.start();
 const b=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;const ns=AC.createBufferSource();ns.buffer=b;ns.loop=true;const bf=AC.createBiquadFilter();bf.type='bandpass';bf.frequency.value=650;windG=AC.createGain();windG.gain.value=0;ns.connect(bf);bf.connect(windG);windG.connect(AC.destination);ns.start()}
function beep(f,d,v){const o=AC.createOscillator(),g=AC.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(v,AC.currentTime);g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+d);o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+d)}

/* ============ オンライン クライアント本体 ============
 * 役割: 入力 / 描画 / カメラ / HUD / サウンド / 補間 / 自機予測。ゲーム状態の決定は一切行わない(サーバー権威)。 */
const Proto = window.Proto, Fl = window.Flight, X = new V3(1, 0, 0), UP = new V3(0, 1, 0);
const S = Fl.newState('blue', 0), PS = Fl.newState('blue', 0);
const cq = new Q().copy(S.q), look = { y: 0, p: 0, cy: 0, cp: 0 };
let camMode = 0, paused = false, started = false, AC, eng, engG, windG, muted = false, mouseDown = false;
const K = {};
const INTERP = 110; // ms: リモート機の補間遅延(20Hz スナップショット 2 個分)
const TN = ['', '一撃離脱型', '集団行動型', '大日本帝国軍'];
let myId = 0, myTeam = 'blue', myName = '', phase = 'lobby', roster = [], tacs = { blue: 1, red: 1 }, me = null, lastSnap = null, tOff = null, ended = false, frameNo = 0, dispInit = false;
const snaps = [], ents = new Map(), mslMesh = new Map(), bmap = new Map(), chaffs = [], tgtMeshes = [], cnt = { f: 1, e: 0 };
const ctl = { el: 0, ai: 0, ru: 0, thr: 0, trim: .03, brake: false, flaps: 0, gear: 1, fire: false };
const teamIdx = t => t === 'red' ? 1 : 0, mineIdx = () => teamIdx(myTeam);
S.hp = 100; S.ammo = 800; S.msl = 6; S.chaff = 5; S.score = 0; S.kills = 0; S.tk = 0; S.end = null;

// ---------- 機体の色(チーム識別) ----------
const BLUEM = mat(0x2f7fd6);
function tint(g, team) { g.traverse(o => { if (o.isMesh && (o.material === RD || o.material === BLUEM)) o.material = team === 'blue' ? BLUEM : RD; }); }

// ---------- 弾・ミサイル・チャフ(見た目のみ。命中判定はサーバー) ----------
const bGeo = new T.BoxGeometry(.07, .07, 5), bMat = [new T.MeshBasicMaterial({ color: 0xffe27a }), new T.MeshBasicMaterial({ color: 0xff5a4d }), new T.MeshBasicMaterial({ color: 0x7dffb0 })];
const bullets = [], mGeo = new T.CylinderGeometry(.13, .13, 2.4, 6).rotateX(Math.PI / 2), mMat = new T.MeshBasicMaterial({ color: 0xf2f2f2 });
for (let i = 0; i < 700; i++) { const m = new T.Mesh(bGeo, bMat[0]); m.visible = false; scene.add(m); bullets.push({ m, on: false, p: new V3(), v: new V3(), life: 0, id: 0 }); }
const tmpV = new V3();
function shoot(p, v, code, id) {
  const b = bullets.find(b => !b.on); if (!b) return; const red = code & 1, ai = code & 2, mineT = (red ? 1 : 0) === mineIdx();
  b.on = true; b.p.copy(p); b.v.copy(v); b.life = 2.4; b.id = id; b.m.material = bMat[mineT ? (ai ? 2 : 0) : 1]; b.m.visible = true; bmap.set(id, b);
}
function bulletStep(dt) {
  for (const b of bullets) {
    if (!b.on) continue; b.v.y -= 9.81 * dt; b.p.addScaledVector(b.v, dt); b.life -= dt;
    if (b.life <= 0 || b.p.y < Hg(b.p.x, b.p.z)) { killBullet(b); continue; }
    b.m.position.copy(b.p); b.m.lookAt(tmpV.copy(b.p).add(b.v));
  }
}
function killBullet(b) { b.on = false; b.m.visible = false; if (bmap.get(b.id) === b) bmap.delete(b.id); }
function chaffStep(dt) {
  for (let i = chaffs.length - 1; i >= 0; i--) {
    const c = chaffs[i]; c.life -= dt; c.p.addScaledVector(c.v, dt); c.v.multiplyScalar(1 - .6 * dt); c.v.y -= 3 * dt; c.tk -= dt;
    if (c.tk <= 0) { c.tk = .08; puff(c.p.clone().add(new V3((Math.random() - .5) * 30, (Math.random() - .5) * 30, (Math.random() - .5) * 30)), 5, 1, 0xe8f4ff, new V3()); }
    if (c.life <= 0) chaffs.splice(i, 1);
  }
}
const att = p => clamp(1 - p.distanceTo(cam.position) / 2500, .05, 1);
let lastGunSfx = 0;
function handleEvent(e) {
  const P3 = (i) => new V3(e[i], e[i + 1], e[i + 2]);
  switch (e[0]) {
    case 0: { const p = P3(2); shoot(p, P3(5), e[8], e[1]); const t = performance.now(); if (t - lastGunSfx > 45) { lastGunSfx = t; sfx(600, .06, .25 * att(p)); } break; }
    case 1: { const b = bmap.get(e[1]); if (b) killBullet(b); const p = P3(2); if (e[5] === 1) puff(p, 2, .3, 0x8a7a5a, new V3(0, 2, 0)); else puff(p, e[5] === 2 ? 4 : 3, e[5] === 2 ? .4 : .25, 0xffcc55, new V3(0, e[5] === 2 ? 3 : 0, 0)); break; }
    case 2: sfx(300, .4, .35 * att(P3(2))); break;
    case 3: { const p = P3(1); sfxK = att(p); boom(p, e[4]); sfxK = 1; break; }
    case 4: { const p = P3(1); chaffs.push({ p, v: P3(4), life: 6, tk: 0 }); sfx(1200, .3, .3 * att(p)); break; }
    case 5: puff(P3(1), 3, .25, 0xffcc55, new V3()); break;
    case 6: { const p = P3(1); sfxK = att(p); boom(p, e[4]); sfxK = 1; break; }
    case 7: { const t = tgtMeshes[e[1]]; if (t) { t.children.forEach(c => c.material.color.set(0x1a1a1a)); t.scale.y = .5; } break; }
    case 8: { const b = e[1] ? bRed : bBlue; puff(b.p.clone().add(new V3((Math.random() - .5) * 60, Math.random() * 15, (Math.random() - .5) * 60)), 4, .4, 0xffb84a, new V3(0, 3, 0)); break; }
  }
}

// ---------- 地上目標(サーバーが位置・生死を決定。見た目だけ生成) ----------
function buildTargets(list) {
  for (const g of tgtMeshes) scene.remove(g); tgtMeshes.length = 0; tgts.length = 0;
  list.forEach(([x, y, z, ry, tank, alive]) => {
    const g = new T.Group(), ad = (m, yy, zz = 0) => { m.position.set(0, yy, zz); g.add(m); };
    if (tank) { ad(new T.Mesh(new T.BoxGeometry(5, 1.4, 8), tmat(0x4f5d3a)), 1); ad(new T.Mesh(new T.BoxGeometry(2.6, 1, 3), tmat(0x5c6b45)), 2.1); ad(new T.Mesh(new T.CylinderGeometry(.14, .14, 4.5, 6).rotateX(Math.PI / 2), tmat(0x30362a)), 2.2, -3); }
    else { ad(new T.Mesh(new T.CylinderGeometry(4, 4, 9, 12), tmat(0xc9c3b4)), 4.5); ad(new T.Mesh(new T.CylinderGeometry(.2, .2, 3, 5), tmat(0xd6402f)), 10.5); }
    g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); tgtMeshes.push(g);
    if (!alive) { g.children.forEach(c => c.material.color.set(0x1a1a1a)); g.scale.y = .5; }
    tgts.push({ p: new V3(x, y + (tank ? 1.5 : 4.5), z), big: !tank, g });
  });
}
const tgts = [];

// ---------- ベース表示 ----------
for (const b of [bBlue, bRed]) b.g.children.forEach(c => { if (c.material && c.material.color) c.userData.c = c.material.color.getHex(); });
function resetBases() { for (const b of [bBlue, bRed]) { b.hp = b.max; b.dead = false; b.g.scale.y = 1; b.g.children.forEach(c => c.material.color.set(c.userData.c)); } }
function updBases(hp) {
  [bBlue, bRed].forEach((b, i) => {
    b.hp = hp[i];
    if (b.hp <= 0 && !b.dead) { b.dead = true; for (let k = 0; k < 5; k++) boom(b.p.clone().add(new V3((Math.random() - .5) * 70, 0, (Math.random() - .5) * 70)), 30); b.g.children.forEach(c => c.material.color.set(0x1a1a1a)); b.g.scale.y = .4; }
  });
}

// ---------- スナップショット受信 ----------
function onSnap(m) {
  const d = Date.now() - m.st; tOff = tOff === null ? d : tOff + (d - tOff) * (d < tOff ? .3 : .02);
  snaps.push(m); if (snaps.length > 30) snaps.shift(); lastSnap = m;
  for (const e of m.ev) handleEvent(e);
  updBases(m.b);
  if (m.me) { const wasDead = me && me.cr; me = m.me; if (wasDead && !me.cr) dispInit = false; }
  let f = 0, en = 0; for (const c of m.c) (c[1] === mineIdx() ? f++ : en++); cnt.f = f; cnt.e = en;
}
const mapOf = s => s._m || (s._m = new Map(s.c.map(e => [e[0], e])));
const mapM = s => s._mm || (s._mm = new Map(s.m.map(e => [e[0], e])));
const qa = new Q(), qb = new Q();
function makeEnt(eb) {
  const human = !!eb[2], team = eb[1] ? 'red' : 'blue';
  const tac = tacs[team]; let mesh;
  if (human) { mesh = plane.clone(true); mesh.name = ''; tint(mesh, team); }
  else mesh = mkJet(tac === 3 ? jpM : team === 'red' ? eM : aM, tac === 3);
  scene.add(mesh); return { mesh, human, team, id: eb[0], sm: 0, prop: mesh.getObjectByName('prop'), gear: mesh.getObjectByName('gear'), hp: eb[10], seen: 0 };
}
function updateRemotes(dt) {
  const n = snaps.length; if (!n || tOff === null) return;
  const rt = Date.now() - tOff - INTERP; let a = snaps[n - 1], b = a, u = 0;
  if (n > 1 && rt < snaps[n - 1].st) {
    if (rt <= snaps[0].st) a = b = snaps[0];
    else for (let i = n - 2; i >= 0; i--) if (snaps[i].st <= rt) { a = snaps[i]; b = snaps[i + 1]; u = (rt - a.st) / (b.st - a.st); break; }
  }
  frameNo++;
  const ma = mapOf(a);
  for (const eb of b.c) {
    const id = eb[0]; if (id === myId) continue;
    let e = ents.get(id); if (!e) { e = makeEnt(eb); ents.set(id, e); }
    e.seen = frameNo; const ea = ma.get(id) || eb;
    const dx = eb[3] - ea[3], dy = eb[4] - ea[4], dz = eb[5] - ea[5], uu = (dx * dx + dy * dy + dz * dz > 40000) ? 1 : u;
    e.mesh.position.set(ea[3] + dx * uu, ea[4] + dy * uu, ea[5] + dz * uu);
    qa.set(ea[6], ea[7], ea[8], ea[9]); qb.set(eb[6], eb[7], eb[8], eb[9]); e.mesh.quaternion.copy(qa.slerp(qb, uu));
    e.hp = eb[10];
    if (e.human) {
      const thr = eb[11] / 100, gr = eb[12] / 100;
      if (e.prop) { e.prop.rotation.z += (12 + thr * 60) * dt; const bl = e.prop.children[0], dc = e.prop.children[1]; if (bl) bl.visible = thr < .45; if (dc) dc.material = dc.material; }
      if (e.gear) { e.gear.visible = gr > .02; e.gear.scale.set(1, Math.max(.01, gr), 1); }
    }
    if ((e.human ? e.hp < 40 : e.hp < 10) && (e.sm -= dt) <= 0) { e.sm = .12; puff(e.mesh.position.clone(), 2.2, .9, 0x333333, new V3(0, 3, 0)); }
  }
  for (const [id, e] of ents) if (e.seen !== frameNo) { scene.remove(e.mesh); ents.delete(id); }
  // ミサイル
  const mm = mapM(a);
  for (const eb of b.m) {
    const id = eb[0]; let m = mslMesh.get(id);
    if (!m) { m = { g: new T.Mesh(mGeo, eb[10] ? mMat : mMatE), tr: 0 }; scene.add(m.g); mslMesh.set(id, m); }
    m.seen = frameNo; const ea = mm.get(id) || eb, old = m.g.position.clone();
    m.g.position.set(ea[1] + (eb[1] - ea[1]) * u, ea[2] + (eb[2] - ea[2]) * u, ea[3] + (eb[3] - ea[3]) * u);
    m.g.lookAt(tmpV.set(m.g.position.x + eb[4], m.g.position.y + eb[5], m.g.position.z + eb[6]));
    m.tid = eb[8]; m.dc = eb[9]; m.team = eb[7];
    if ((m.tr -= dt) <= 0) { m.tr = .05; puff(old, 1.4, .6, eb[10] ? 0xdddddd : 0xffb070, new V3()); }
  }
  for (const [id, m] of mslMesh) if (m.seen !== frameNo) { scene.remove(m.g); mslMesh.delete(id); }
}
function clearWorld() {
  for (const e of ents.values()) scene.remove(e.mesh); ents.clear();
  for (const m of mslMesh.values()) scene.remove(m.g); mslMesh.clear();
  for (const b of bullets) { b.on = false; b.m.visible = false; } bmap.clear(); chaffs.length = 0;
  for (const f of fx) { scene.remove(f.m); f.m.material.dispose(); } fx.length = 0; snaps.length = 0; lastSnap = null; me = null; cnt.f = 1; cnt.e = 0;
}

// ---------- 自機: サーバー権威状態 + 予測 ----------
function loadMe(d, s) {
  d.pos.set(s.p[0], s.p[1], s.p[2]); d.q.set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize(); d.vel.set(s.v[0], s.v[1], s.v[2]); d.w.set(s.w[0], s.w[1], s.w[2]);
  d.thr = s.thr; d.fuel = s.fuel; d.flapT = s.flapT; d.flaps = s.flaps; d.gearS = s.gearS; d.gearT = s.gearT; d.brake = s.brake; d.el = s.el; d.ai = s.ai; d.ru = s.ru; d.trim = s.trim; d.g = s.g; d.t = s.t; d.onGround = !!s.gr; d.crashed = !!s.cr;
}
function updateSelf(dt) {
  if (!me || !lastSnap || tOff === null) return;
  loadMe(PS, me);
  if (!PS.crashed) {
    // サーバー状態から「現在時刻まで」同じ共有物理を再シミュレーション(入力は現在の操縦入力)
    const age = clamp((Date.now() - tOff - lastSnap.st) / 1000, 0, .25), steps = Math.floor(age * 120);
    for (let i = 0; i < steps; i++) { Fl.applyInput(PS, ctl, 1 / 120); if (Fl.physics(PS, 1 / 120)) break; }
  }
  if (!dispInit || S.pos.distanceToSquared(PS.pos) > 3600) { S.pos.copy(PS.pos); S.q.copy(PS.q); dispInit = true; if (!S.crashed) cq.copy(PS.q); }
  else { S.pos.addScaledVector(PS.vel, dt); const k = 1 - Math.exp(-dt * 12); S.pos.lerp(PS.pos, k); S.q.slerp(PS.q, k); }
  S.vel.copy(PS.vel); S.w.copy(PS.w); for (const k of ['thr', 'fuel', 'flapT', 'flaps', 'gearS', 'gearT', 'brake', 'el', 'ai', 'ru', 'trim', 'g', 'onGround', 'alpha', 'V', 't']) S[k] = PS[k];
  S.crashed = !!me.cr; plane.visible = !S.crashed;
  S.hp = me.hp; S.ammo = me.ammo; S.msl = me.msl; S.chaff = me.chaff; S.score = me.sc; S.kills = me.k; S.tk = me.tk;
}

// ---------- 入力 ----------
function resetCtl() { Object.assign(ctl, { el: 0, ai: 0, ru: 0, thr: 0, trim: .03, brake: false, flaps: 0, gear: 1, fire: false }); dispInit = false; }
function updateCtl(dt) {
  ctl.el = (K.KeyS ? 1 : 0) - (K.KeyW ? 1 : 0); ctl.ai = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0); ctl.ru = ((K.KeyE || K.ArrowRight) ? 1 : 0) - ((K.KeyQ || K.ArrowLeft) ? 1 : 0);
  if (K.ArrowUp || K.ShiftLeft || K.ShiftRight) ctl.thr = Math.min(1, ctl.thr + .4 * dt); if (K.ArrowDown) ctl.thr = Math.max(0, ctl.thr - .4 * dt);
  if (K.BracketRight) ctl.trim = Math.min(.3, ctl.trim + .06 * dt); if (K.BracketLeft) ctl.trim = Math.max(-.3, ctl.trim - .06 * dt);
  ctl.brake = !!(K.Space || K.KeyB); ctl.fire = !!(K.KeyJ || mouseDown) && !S.crashed;
}
let seq = Date.now(), lastSend = 0, nextMsl = 0, nextChf = 0;
const r3 = v => Math.round(v * 1000) / 1000;
function sendInput(now) {
  if (K.KeyK && now > nextMsl && !S.crashed) { nextMsl = now + 300; Net.send({ t: 'launch_missile' }); }
  if (K.KeyL && now > nextChf && !S.crashed) { nextChf = now + 300; Net.send({ t: 'use_chaff' }); }
  if (now - lastSend < 33) return; lastSend = now;
  Net.send({ t: 'input', seq: ++seq, i: { el: ctl.el, ai: ctl.ai, ru: ctl.ru, thr: r3(ctl.thr), trim: r3(ctl.trim), brake: ctl.brake, flaps: ctl.flaps, gear: ctl.gear, fire: ctl.fire } });
}
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const c = e.code; K[c] = 1;
  if (!e.repeat && started) {
    if (c === 'KeyG' && !(ctl.gear && S.onGround)) ctl.gear = 1 - ctl.gear;
    if (c === 'KeyF') ctl.flaps = Math.min(3, ctl.flaps + 1); if (c === 'KeyV') ctl.flaps = Math.max(0, ctl.flaps - 1);
    if (c === 'KeyZ') ctl.thr = 1; if (c === 'KeyX') ctl.thr = 0;
    if (c === 'KeyC') camMode = (camMode + 1) % 3;
    if (c === 'KeyT') { look.y = Math.round(look.cy / 6.2832) * 6.2832; look.p = 0; }
  }
  if (c === 'KeyH') { const h = $('help'); h.style.display = h.style.display === 'none' ? '' : 'none'; }
  if (c === 'KeyM' && AC) { muted = !muted; muted ? AC.suspend() : AC.resume(); }
  if (c === 'Tab') { e.preventDefault(); $('sb').style.display = 'block'; renderScoreboard(); }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c) && started) e.preventDefault();
});
addEventListener('keyup', e => { K[e.code] = 0; if (e.code === 'Tab') $('sb').style.display = 'none'; });
addEventListener('mousedown', e => { if (started && e.button === 2) mouseDown = true; }); addEventListener('mouseup', e => { if (e.button === 2) mouseDown = false; });
addEventListener('contextmenu', e => { if (started) e.preventDefault(); });
addEventListener('blur', () => { for (const k in K) K[k] = 0; mouseDown = false; });
addEventListener('wheel', e => { if (!started) return; e.preventDefault(); const k = (e.deltaMode == 1 ? 33 : 1) * .004, dy = e.deltaY * k, dx = e.deltaX * k; if (e.altKey) look.p = clamp(look.p - (dy || dx), -1.3, 1.3); else { look.y -= dy; look.p = clamp(look.p - dx, -1.3, 1.3); } }, { passive: false });

// ---------- HUD ----------
const onBaseC = () => { const b = myTeam === 'red' ? bRed : bBlue; return World.onRunway(myTeam, S.pos.x, S.pos.z) && b.hp > 0; };
function incoming() { if (S.crashed || !lastSnap) return 0; let b = 1e9; for (const m of lastSnap.m) if (m[8] === myId && !m[9] && m[7] !== mineIdx()) { const dx = m[1] - S.pos.x, dy = m[2] - S.pos.y, dz = m[3] - S.pos.z; b = Math.min(b, Math.hypot(dx, dy, dz)); } return b < 1e9 ? Math.round(b) : 0; }
const myBase = () => myTeam === 'red' ? bRed : bBlue, foeBase = () => myTeam === 'red' ? bBlue : bRed;
function hud() {
  const e = eul(), gy = Hg(S.pos.x, S.pos.z), agl = S.pos.y - gy - 1.2, gs = Math.hypot(S.vel.x, S.vel.z), V = S.V, vs = S.vel.y;
  adi(e.p, e.r); set('hdg', String(Math.round(e.h) % 360).padStart(3, '0')); set('card', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(e.h / 45) % 8]);
  set('ias', Math.round(V * 1.944)); set('gs', Math.round(gs * 1.944)); set('alt', Math.round(S.pos.y * 3.281)); set('vs', (vs > 0 ? '+' : '') + Math.round(vs * 196.85));
  $('thrbar').style.height = S.thr * 100 + '%'; set('thrv', Math.round(S.thr * 100)); $('fuelbar').style.height = S.fuel * 100 + '%'; set('fuelv', Math.round(S.fuel * 100));
  const gl = $('lgear'); gl.className = 'lamp ' + (S.gearT > .98 ? 'on' : S.gearT < .02 ? '' : 'tr'); set('gearv', S.gearT > .98 ? 'DOWN' : S.gearT < .02 ? 'UP' : 'MOVE');
  set('flapv', ['0°', '10°', '20°', '30°'][S.flapT]); $('lbrake').className = 'lamp ' + (S.brake > .5 ? 'br' : ''); set('brakev', S.brake > .5 ? 'ON' : 'OFF');
  set('trimv', (S.trim >= 0 ? '+' : '') + (S.trim * 100).toFixed(1)); set('aoav', (S.alpha * 57.3).toFixed(1) + '°'); set('gv', S.g.toFixed(1) + ' G'); set('ammov', Math.floor(S.ammo));
  $('hpbar').style.height = S.hp + '%'; $('hpbar').style.background = S.hp < 10 ? 'var(--red)' : S.hp < 30 ? 'var(--amber)' : 'var(--ok)'; set('hpv2', Math.round(S.hp));
  $('mybar').style.width = myBase().hp / myBase().max * 100 + '%'; $('enbar').style.width = foeBase().hp / foeBase().max * 100 + '%';
  set('mslv', Math.floor(S.msl)); set('tacv', '味方戦術: ' + TN[tacs[myTeam]]); set('chfv', Math.floor(S.chaff)); set('frv', cnt.f + ' / ' + cnt.e); set('hpv', Math.round(S.hp) + '%'); set('scv', S.score); set('kv', S.tk + ' / ' + S.kills + ' / ' + (me ? me.d : 0));
  set('cam', ['追従カメラ', '遠距離カメラ', '機首カメラ'][camMode]); set('state', S.onGround ? '地上' : 'AGL ' + Math.round(agl * 3.281) + ' ft');
  const w = [], air = agl > 3 && !S.crashed;
  if (air && S.alpha > (Fl.STALL_A0 + .02 * S.flaps) * .9 && V > 8) w.push('<div class="r blink">失速 STALL</div>');
  if (air && vs < -8 && agl < 260) w.push('<div class="r blink">PULL UP</div>');
  else if (air && gs > 25) { const hx = S.pos.x + S.vel.x * 8, hz = S.pos.z + S.vel.z * 8; if (Hg(hx, hz) > S.pos.y + vs * 8 - 30) w.push('<div class="a">地形接近 TERRAIN</div>'); }
  if (air && S.gearT < .5 && agl < 150 && S.thr < .35 && V < 45) w.push('<div class="a blink">ギアを下げてください</div>');
  if (V > 85) w.push('<div class="a">オーバースピード</div>');
  if (S.fuel <= 0) w.push('<div class="r">燃料切れ</div>'); else if (S.fuel < .1) w.push('<div class="a" style="font-size:18px">燃料残量わずか</div>');
  if (S.ammo <= 0 && !S.onGround) w.push('<div class="a" style="font-size:20px">弾切れ 着陸して補給</div>');
  if (S.hp < 30 && !S.crashed) w.push('<div class="r blink" style="font-size:20px">機体損傷</div>');
  if (S.hp < 10 && !S.crashed && !ended) w.push('<div class="r blink" style="font-size:26px">⚠ ALARM 機体HP 10%未満 ⚠</div>');
  if (S.onGround && S.V < 15 && onBaseC() && !S.crashed && (S.hp < 99 || S.ammo < 790)) w.push('<div style="font-size:18px;color:var(--ok)">基地で整備中 …</div>');
  { const im = incoming(); if (im) w.push('<div class="r blink" style="font-size:26px">MISSILE 接近 ' + im + 'm — [L] チャフ</div>'); else if (!S.crashed && me && me.lkd) w.push('<div class="a blink" style="font-size:20px">敵機にロックされています</div>'); }
  if (me && me.lk[2] && S.msl >= 1 && !S.crashed) w.push('<div class="a" style="font-size:20px">LOCK ON  [K] ミサイル発射</div>');
  const s = w.join(''); if ($('warn').dataset.s !== s) { $('warn').dataset.s = s; $('warn').innerHTML = s; }
  netHud();
}
const proj = p => { const v = p.clone().project(cam); return { x: (v.x * .5 + .5) * mk.width, y: (-v.y * .5 + .5) * mk.height, z: v.z }; };
function markers() {
  const W = mk.width, Hh = mk.height; mc.clearRect(0, 0, W, Hh); if (S.crashed || !started) return;
  const g = proj(S.pos.clone().addScaledVector(new V3(0, 0, -1).applyQuaternion(S.q), 600));
  if (g.z < 1) { mc.strokeStyle = 'rgba(255,226,122,.9)'; mc.lineWidth = 1.5; mc.beginPath(); mc.arc(g.x, g.y, 14, 0, 7); mc.moveTo(g.x - 22, g.y); mc.lineTo(g.x - 8, g.y); mc.moveTo(g.x + 8, g.y); mc.lineTo(g.x + 22, g.y); mc.moveTo(g.x, g.y - 22); mc.lineTo(g.x, g.y - 8); mc.stroke(); }
  mc.font = '12px monospace'; mc.textAlign = 'center';
  const mark = (p, col, s, label, arrow) => {
    const q = proj(p), d = Math.round(p.distanceTo(S.pos)), inF = q.z < 1 && q.x > 30 && q.x < W - 30 && q.y > 30 && q.y < Hh - 30; mc.strokeStyle = mc.fillStyle = col; mc.lineWidth = 2;
    if (inF) { mc.strokeRect(q.x - s, q.y - s, s * 2, s * 2); mc.fillText(label + ' ' + d + 'm', q.x, q.y + s + 14); }
    else if (arrow) { let dx = q.x - W / 2, dy = q.y - Hh / 2; if (q.z > 1) { dx = -dx; dy = -dy; } const a = Math.atan2(dy, dx), R = Math.min(W, Hh) / 2 - 50; mc.save(); mc.translate(W / 2 + Math.cos(a) * R, Hh / 2 + Math.sin(a) * R); mc.rotate(a); mc.beginPath(); mc.moveTo(12, 0); mc.lineTo(-8, -8); mc.lineTo(-8, 8); mc.closePath(); mc.fill(); mc.restore(); }
  };
  const nm = id => { const p = roster.find(x => x.id === id); return p ? p.name : ''; };
  for (const e of ents.values()) {
    const foe = e.team !== myTeam;
    if (foe) mark(e.mesh.position, '#ff5a4d', 16, e.human ? nm(e.id) : '敵機', true); else mark(e.mesh.position, e.human ? '#7fd6ff' : '#7dffb0', e.human ? 12 : 10, e.human ? nm(e.id) : '味方', false);
  }
  if (foeBase().hp > 0) mark(foeBase().p, '#ff5a4d', 22, '敵基地', true); if (myBase().hp > 0) mark(myBase().p, '#4db8ff', 22, '自基地', true);
  for (const m of mslMesh.values()) if (m.tid === myId && !m.dc && m.team !== mineIdx()) mark(m.g.position, '#ff3b30', 8, 'MSL', true);
  if (me && me.lk[0]) { const e = ents.get(me.lk[0]); if (e) { const q = proj(e.mesh.position); if (q.z < 1) { const ok = me.lk[2], tm = me.lk[1]; mc.strokeStyle = mc.fillStyle = ok ? '#ff3b30' : '#ffb43b'; mc.lineWidth = ok ? 3 : 2; const r = ok ? 24 : 34 - tm / 2 * 10; mc.beginPath(); mc.moveTo(q.x, q.y - r); mc.lineTo(q.x + r, q.y); mc.lineTo(q.x, q.y + r); mc.lineTo(q.x - r, q.y); mc.closePath(); mc.stroke(); mc.fillText(ok ? 'LOCK' : 'ロック中 ' + Math.round(tm / 2 * 100) + '%', q.x, q.y - r - 8); } } }
  tgts.forEach((t, i) => { if (t.g.scale.y === 1 && t.p.distanceTo(S.pos) < 3000) mark(t.p, '#ffb43b', 9, t.big ? '燃料' : '戦車', false); });
}

// ---------- UI(ロビー/接続状態/結果) ----------
const ui = {};
function showMsg(t, ms) { const m = $('netmsg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; clearTimeout(showMsg.t); if (t && ms) showMsg.t = setTimeout(() => { if (Net.status === 'CONNECTED') m.style.display = 'none'; }, ms); }
Net.onStatus = s => {
  const m = { CONNECTED: '', CONNECTING: 'サーバーに接続中…', RECONNECTING: '接続が切れました。再接続中…', DISCONNECTED: 'サーバーに接続できません。再試行します…' }[s];
  showMsg(m); if (s !== 'CONNECTED' && !started) $('lobbymsg').textContent = m;
};
function netHud() {
  const st = Net.status, col = st === 'CONNECTED' ? 'var(--ok)' : st === 'CONNECTING' || st === 'RECONNECTING' ? 'var(--amber)' : 'var(--red)';
  const t = `<span style="color:${myTeam === 'red' ? '#ff6a5a' : '#5ab8ff'}">${myTeam.toUpperCase()}</span> ${esc(myName)}<br><small>PING</small> <b>${Net.ping}ms</b> <small style="color:${col}">${st}</small><br><small>${phase.toUpperCase()} · WAVE ${lastSnap ? lastSnap.w : 1}</small>`;
  if ($('netbox').dataset.s !== t) { $('netbox').dataset.s = t; $('netbox').innerHTML = t; }
  if (started && me && !ended) {
    if (me.cr) { $('crash').style.display = 'flex'; $('crashh').textContent = '撃墜'; $('crashh').style.color = ''; $('crashmsg').textContent = (me.cmsg || '') + '  再出撃まで ' + me.rs + ' 秒'; $('crashs').textContent = '撃墜されても10秒後に自軍基地から再出撃します(戦闘は継続)'; }
    else if ($('crash').style.display === 'flex') $('crash').style.display = 'none';
  }
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderScoreboard() {
  const rows = roster.slice().sort((a, b) => b.score - a.score).map(p => `<tr class="${p.team}${p.id === myId ? ' me' : ''}"><td>${p.team.toUpperCase()}</td><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
  $('sb').innerHTML = '<table><tr><th>TEAM</th><th>PILOT</th><th>SCORE</th><th>KILL</th><th>DEATH</th></tr>' + rows + '</table>';
}
ui.joined = () => { $('joinbox').style.display = 'none'; $('lobbybox').style.display = 'block'; $('lobbymsg').textContent = ''; };
ui.lobby = m => {
  if (m.phase === 'battle' || (m.phase === 'result' && started)) { if (started) { $('start').style.display = 'none'; } if ($('sb').style.display === 'block') renderScoreboard(); return; }
  if (started && (m.phase === 'lobby' || m.phase === 'countdown')) { started = false; ended = false; clearWorld(); $('crash').style.display = 'none'; }
  $('start').style.display = 'flex';
  const list = m.players.map(p => `<div class="pl ${p.team}"><b>${p.team.toUpperCase()}</b> ${esc(p.name)}${p.id === myId ? ' (あなた)' : ''}<span>${p.conn ? (p.ready ? '✔ READY' : '…') : '切断中'}</span></div>`).join('');
  $('plist').innerHTML = list;
  const mp = m.players.find(p => p.id === myId); $('readyBtn').textContent = mp && mp.ready ? 'READY 解除' : 'READY';
  $('lstate').textContent = m.phase === 'countdown' ? `まもなく出撃 ${m.countdown}` : '全員が READY で出撃します(AI が不足人数を補います)';
  roster = m.players;
};

// ---------- 通信ハンドラ ----------
function startGame(m) {
  clearWorld(); started = true; ended = false; tacs = m.tac || tacs; resetCtl(); resetBases(); buildTargets(m.targets || []); tOff = null;
  $('start').style.display = 'none'; $('crash').style.display = 'none'; plane.visible = true; look.y = look.p = look.cy = look.cp = 0; tx = 1e9;
}
Net.onMsg = m => {
  switch (m.t) {
    case 'join_ok': myId = m.id; myTeam = m.team; myName = m.name; tint(plane, myTeam); ui.joined(); break;
    case 'room_state': phase = m.phase; roster = m.players; { const mp = m.players.find(p => p.id === myId); if (mp) { myTeam = mp.team; tint(plane, myTeam); } } ui.lobby(m); break;
    case 'game_start': startGame(m); break;
    case 'snapshot': if (started) onSnap(m); break;
    case 'respawn': resetCtl(); break;
    case 'hit': $('hit').style.opacity = 1; setTimeout(() => $('hit').style.opacity = 0, 120); sfx(200, .15, .3); break;
    case 'kill_feed': { const d = document.createElement('div'); d.innerHTML = `<span class="${m.kt}">${esc(m.k)}</span> ▸ <span class="${m.vt}">${esc(m.v)}</span>`; $('feed').prepend(d); setTimeout(() => d.remove(), 7000); while ($('feed').children.length > 6) $('feed').lastChild.remove(); break; }
    case 'target_state': buildTargets(m.targets); break;
    case 'player_left': showMsg(esc(m.name) + ' が退出しました', 3000); break;
    case 'game_end': {
      ended = true; const win = m.winner === myTeam; $('crash').style.display = 'flex'; $('crashh').textContent = win ? '勝利' : '敗北'; $('crashh').style.color = win ? 'var(--ok)' : 'var(--red)';
      $('crashmsg').innerHTML = (win ? '敵軍基地を破壊しました' : '自軍基地が破壊されました') + '<div class="res">' + m.players.map(p => `<div class="${p.team}">${esc(p.name)} — ${p.score}点 / 撃墜 ${p.kills} / 被撃墜 ${p.deaths}</div>`).join('') + '</div>';
      $('crashs').textContent = 'まもなくロビーに戻ります'; break;
    }
    case 'error': showMsg(m.msg, 4000); if (!started) $('lobbymsg').textContent = m.msg; if (m.code === 'room_full') { $('joinbox').style.display = 'block'; $('lobbybox').style.display = 'none'; } break;
  }
};
$('joinBtn').onclick = () => {
  const name = $('nameIn').value.trim() || 'Pilot'; try { localStorage.setItem('fs_name', name); } catch (e) { }
  try { audio(); } catch (e) { }
  Net.connect({ name, team: $('teamSel').value, room: 'main' }); $('lobbymsg').textContent = '接続中…';
};
$('readyBtn').onclick = () => { const mp = roster.find(p => p.id === myId); Net.send({ t: 'ready', ready: !(mp && mp.ready) }); try { audio(); } catch (e) { } };
$('btnBlue').onclick = () => Net.send({ t: 'set_team', team: 'blue' }); $('btnRed').onclick = () => Net.send({ t: 'set_team', team: 'red' });
try { $('nameIn').value = localStorage.getItem('fs_name') || ''; } catch (e) { }
$('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });

// ---------- 警報音 ----------
setInterval(() => { if (started && !S.crashed && !ended && AC && !muted && incoming()) beep(1600, .08, .1); }, 250);
setInterval(() => { if (!started || S.crashed || ended || S.hp >= 10) return; $('hit').style.opacity = .55; setTimeout(() => $('hit').style.opacity = 0, 150); if (AC && !muted) beep(S.hp < 5 ? 1400 : 990, .14, .12); }, 450);

// ---------- メインループ ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (started) { updateCtl(dt); sendInput(now); updateSelf(dt); updateRemotes(dt); bulletStep(dt); chaffStep(dt); }
  fxStep(dt); visuals(dt); hud(); renderer.render(scene, cam); markers();
}
requestAnimationFrame(frame);
