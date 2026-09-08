---
"@flarelobby/cloudflare": minor
---

Gateway に許可 Origin 設定と CORS プリフライト処理を追加しました。

- `defineFlareLobby()` に任意の `cors: { allowedOrigins }` を追加しました。正規の http/https Origin 文字列だけを受け付け、完全一致で照合します。不正値は `INVALID_CORS_CONFIGURATION` で拒否します。
- 有効なプリフライトは認証と DO/D1 アクセスより先に `204` で応答します。対象は既存 HTTP API の `GET`/`POST` と `Authorization`/`Content-Type`/`Idempotency-Key`/`Accept` です。
- 許可 Origin の通常応答（成功・`401`/`403`/`429`/`500` を含む）に `Access-Control-Allow-Origin` と `Vary: Origin`、`Access-Control-Expose-Headers: Retry-After` を付けます。CORS はサーバー側認可の代替ではありません。
