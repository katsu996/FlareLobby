---
"@flarelobby/cloudflare": minor
---

custom-room の joinToken TTL を設定化し、Worker 共存フォールバックを追加しました（#125 #127）。

- `customRooms.joinTokenTtlMs` を追加しました。既定は 10 分のまま維持し、短縮はオプションです。対象は custom-room のみで、matchmaking 経由の TTL は変更しません。TTL 切れ後の WS 接続中セッションは維持され、発行時 TTL は入室用途のみです。厳密な 30 秒使い切りはゲーム側 ticket が担います。
- `createGatewayWorker(configuration, { onUnhandledRequest })` と `defineFlareLobby(...).createGatewayWorker({ onUnhandledRequest })` を追加しました。`/` と `/v1/*` 以外は必須 Binding の検証より前に `Request + Env` で委譲されるため、FlareLobby 設定不備時も既存 API（例: `/api/v2/*`）は動作します。FlareLobby 経路で `404` になった要求も同ハンドラへ委譲します。委譲は `fetch` のみ（scheduled/queue なし）で、CORS は各側に任せます。
