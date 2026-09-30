# Flight Sim Online

`flight-sim (9).html` を、サーバー権威型のブラウザ対戦フライトゲームに拡張したものです(BLUE vs RED / AI 併用 / 基地破壊で勝利)。

## 必要環境
- Node.js **18 以上**(`ws` 8, `three` 0.128.0 — 元ゲームと同一バージョン)

## ローカル起動
```bash
npm install
npm start          # http://localhost:3000
npm test           # 戦闘ロジック + WebSocket 統合テスト(サーバー自動起動)
```
同じPCで複数ブラウザ/タブを開けば複数プレイヤーとして遊べます。名前入力 → 「接続して参加」 → 全員 READY で出撃(1人でも可、不足人数はAIが補充)。

## 操作(元ゲームと同じ)
W/S ピッチ, A/D ロール, Q/E ラダー, Shift/↑↓ スロットル(Z=全開, X=0), `[` `]` トリム, Space/B ブレーキ, G ギア, F/V フラップ, J または右クリック 機銃, K ミサイル, L チャフ, C カメラ, Tab スコア, H ヘルプ, M ミュート。
※ オンラインではポーズ(P)と再スタート(R/N)はありません。

## 構成
```
client/index.html, style.css, js/{net.js, render.js, game.js}   描画/HUD/入力/補間/予測/ロビーUI
shared/{world.js, flight.js, protocol.js}                       地形・飛行物理(元コード抽出)・プロトコル(両側共通)
server/server.js                    HTTP静的配信 + WebSocket(/ws) + ルーム管理
server/game/{Room,GameState,Player,GameSimulation,WeaponSystem}.js
server/network/protocol.js          shared/protocol.js の再エクスポート
server/test/{combat.js,smoke.js}
```
- サーバー: 120Hz固定tickで元の `physics()` を実行、60Hzで combatStep(AI・弾・ミサイル・ロック・基地)、20Hzでスナップショット送信。
- クライアント: 入力(30Hz)送信、リモート機は 110ms 遅延の**スナップショット補間**、自機はサーバー状態から共有物理で再シミュレーションする**予測**+スムージング。
- プロトコルは `shared/protocol.js` に一元定義(join / join_ok / room_state / ready / set_team / input / launch_missile / use_chaff / snapshot / hit / death / respawn / kill_feed / game_start / game_end / target_state / error / ping / pong / player_joined / player_left)。

## 環境変数
| 変数 | 既定 | 説明 |
|---|---|---|
| `PORT` | 3000 | 待受ポート |
| `HOST` | 0.0.0.0 | 待受アドレス |
| `MAX_PLAYERS` | 16 | ルーム上限 |
| `ALLOWED_ORIGINS` | (空=制限なし) | WebSocket 許可Origin(カンマ区切り) 例 `https://example.com` |
| `PUBLIC_WS_URL` | (空) | クライアントが使うWS URLを固定 例 `wss://example.com/ws` |
| `TLS_CERT` / `TLS_KEY` | - | 指定すると Node が直接 HTTPS/WSS で待受 |

## 本番デプロイ
- 推奨: Node を HTTP で起動し、nginx / Caddy / クラウドLB で TLS 終端して `https://example.com` → Node、`wss://example.com/ws` → Node へ**WebSocket Upgrade を転送**。クライアントは `location` から自動で `wss://` を選びます。
- nginx 例: `location /ws { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 120s; }`
- ゲーム状態はメモリ上です。**1プロセス運用**(水平スケール不可。複数ルームは `getRoom(id)` で拡張済み、接続時 `room` パラメータ)。ヘルスチェック: `GET /healthz`。
- `?server=wss://host/ws` でクライアントから接続先を上書きできます。

## セキュリティ(サーバー側検証)
HP/スコア/ダメージ/キルはクライアントから指定不可(メッセージ種別にも存在しない)。入力値は範囲丸め、発射レート・ミサイルCD・チャフCD・弾数はサーバー管理、パケット上限 2KB、メッセージレート制限、不正JSON/未知typeは無視またはerror返却、seqの古い入力は破棄。

## 元ゲームからの変更点 / 制限
- 2チーム化: BLUE=元の味方側(南基地)、RED=元の敵側(北基地・南向きに離陸)。RED AI=元の敵AIロジック(ミサイル・回避あり)、BLUE AI=元の味方AIロジック(機銃のみ)。**AI数は各チームの人間人数分だけ減ります**(不足分をAIが補充)。
- 敵AIのミサイルは人間/AIどちらにもロックして発射(元は自機・味方機が対象)。人間同士のロックオン/ミサイル/チャフも有効。
- 弾ダメージ: 対人間機3、対AI機は原則1(赤AIの弾のみ3)。ミサイル40、基地への被弾は弾1/ミサイル60(元仕様どおり)。
- ポーズ・R/Nリスタートは廃止。撃墜後は10秒で自軍滑走路から再出撃。全滅しても試合は継続、基地破壊で試合終了→結果→15秒後にロビー。
- ラグ補償(lag compensation)は未実装。切断後30秒以内なら session token で復帰可能(sessionStorage 保存)。猶予超過で機体削除(AIが補充)。
