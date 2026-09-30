/* WebSocket プロトコル定義(クライアント/サーバー共通の唯一の定義元)。
   すべてのメッセージは JSON: { t: <type>, ... } */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.Proto = factory(); })(typeof self !== "undefined" ? self : this, function () {
  const T = {
    // client -> server
    JOIN: "join",               // {name, team:"auto|red|blue", token?}
    SET_TEAM: "set_team",       // {team}
    READY: "ready",             // {ready:bool}
    INPUT: "input",             // {seq, i:{el,ai,ru,thr,trim,brake,flaps,gear,fire}}
    LAUNCH_MISSILE: "launch_missile",
    USE_CHAFF: "use_chaff",
    PING: "ping",               // {c}
    // server -> client
    JOIN_OK: "join_ok",         // {id, token, team, name, tickRate, snapRate, resumed}
    ROOM_STATE: "room_state",   // {phase, players, countdown, tac, winner}
    PLAYER_JOINED: "player_joined",
    PLAYER_LEFT: "player_left",
    GAME_START: "game_start",   // {targets, tac}
    SNAPSHOT: "snapshot",
    DEATH: "death",             // {msg, by}
    RESPAWN: "respawn",
    HIT: "hit",                 // 自機被弾 {dmg}
    KILL_FEED: "kill_feed",     // {k, v, w}
    TARGET_STATE: "target_state", // 地上目標の再生成 {targets}
    GAME_END: "game_end",       // {winner, players}
    ERROR: "error",             // {code, msg}
    PONG: "pong"                // {c, s}
  };
  const PHASE = { LOBBY: "lobby", COUNTDOWN: "countdown", BATTLE: "battle", RESULT: "result" };
  const LIMITS = { maxPayload: 2048, maxMsgPerSec: 120, nameLen: 16 };
  function num(v, a, b, d) { v = +v; return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; }
  // 入力検証: 範囲外は丸め、非数は既定値
  function sanitizeInput(i) {
    if (!i || typeof i !== "object") return null;
    return {
      el: num(i.el, -1, 1, 0), ai: num(i.ai, -1, 1, 0), ru: num(i.ru, -1, 1, 0),
      thr: num(i.thr, 0, 1, 0), trim: num(i.trim, -0.3, 0.3, 0.03),
      brake: !!i.brake, flaps: Math.round(num(i.flaps, 0, 3, 0)), gear: i.gear ? 1 : 0, fire: !!i.fire
    };
  }
  function sanitizeName(n) {
    n = String(n == null ? "" : n).replace(/[\u0000-\u001f<>&"'\\]/g, "").trim().slice(0, LIMITS.nameLen);
    return n || "Pilot";
  }
  return { T, PHASE, LIMITS, sanitizeInput, sanitizeName, num };
});
