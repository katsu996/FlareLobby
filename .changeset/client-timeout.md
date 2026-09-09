---
"@flarelobby/core": patch
"@flarelobby/client": minor
---

Client SDK に HTTP・WebSocket 接続・コマンドのタイムアウトを追加しました。`FlareLobbyClientOptions` へ `requestTimeoutMs`・`connectionTimeoutMs`・`commandTimeoutMs`、`ClientRequestOptions`・`ClientWebSocketOptions`・`ClientCommandOptions` へ `timeoutMs` を追加し、操作値が Client 既定値を上書きします。`undefined` は継承、`null` は明示的な無期限で、正の有限数（上限 2,147,483,647）のみ有効です。期限切れは新しい安定エラー `TIMEOUT`（`requestId` 保持）で通知し、自動再送しません。`AbortSignal` や `dispose()` による中止は従来どおり `CANCELLED` です。
