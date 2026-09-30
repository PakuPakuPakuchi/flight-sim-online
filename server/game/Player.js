'use strict';
const T = require('three');
const V3 = T.Vector3;
const Flight = require('../../shared/flight.js');

/** 人間プレイヤー。飛行状態 S は元ゲームの S オブジェクトと同一構造(共有物理で更新)。 */
class Player {
  constructor(id, name, team, token) {
    this.id = id; this.name = name; this.team = team; this.token = token;
    this.human = true;
    this.ws = null; this.connected = true; this.discAt = 0; this.lastMsg = Date.now();
    this.ready = false; this.inGame = false;
    this.S = Flight.newState(team, 0);
    this.inp = { el: 0, ai: 0, ru: 0, thr: 0, trim: 0.03, brake: false, flaps: 0, gear: 1, fire: false };
    this.lastSeq = 0;
    this.score = 0; this.kills = 0; this.deaths = 0; this.tk = 0;
    this.lkdT = -9; this.lastHit = null;
    this.tok = 60; this.tokT = Date.now(); this.bad = 0; // レート制限
    this.resetWeapons();
  }
  resetWeapons() {
    this.hp = 100; this.ammo = 800; this.msl = 6; this.chaff = 5;
    this.fireT = 0; this.gunSide = 1; this.mslCd = 0; this.chaffCd = 0; this.msLR = 1;
    this.lock = { t: null, time: 0, ok: false };
    this.respawn = 0; this.cmsg = '';
  }
  get p() { return this.S.pos; }
  get f() { return new V3(0, 0, -1).applyQuaternion(this.S.q); }
  get alive() { return this.inGame && !this.S.crashed; }
  get spd() { return this.S.V; }
}
module.exports = Player;
