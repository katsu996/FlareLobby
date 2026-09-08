---
"@flarelobby/cloudflare": patch
---

必須 Binding と Secret の設定検証を完全にしました。

- `FLARE_LOBBY_BINDINGS` へ `rateLimits: "FLARE_LOBBY_RATE_LIMITS"` を追加し、設定エラーコードへ `RATE_LIMIT_DURABLE_OBJECT_BINDING_MISSING` を追加しました。既存の不足コードは維持します。
- 必須 Binding は `undefined`/`null` を不備とし、Secret は `undefined`/`null`・非文字列・空文字・空白だけを `TOKEN_SECRET_MISSING` で報告します。値の強制変換や署名への `trim` 利用はしません。
- 不足時は認証不要の `GET /` を含む全要求を処理開始前に `500` で拒否します。`GET /` の `ready` は必須設定検証の結果であり、DB 疎通・Migration 適用済み・外部認証サービスの正常性の保証ではありません。新たな `/health` は追加しません。エラー本文とログに Secret や Binding 実体は出力しません。
