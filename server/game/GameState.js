'use strict';
const { PHASE } = require('../../shared/protocol.js');

/** マッチ進行状態(ロビー → カウントダウン → 戦闘 → 結果)。 */
class GameState {
  constructor() { this.reset(); }
  reset() { this.phase = PHASE.LOBBY; this.countdown = 0; this.resultT = 0; this.winner = null; this.emptyT = 0; }
}
module.exports = GameState;
