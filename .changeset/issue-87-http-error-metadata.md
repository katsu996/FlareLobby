---
"@flarelobby/core": patch
"@flarelobby/client": minor
"@flarelobby/cloudflare": patch
---

SDK の HTTP エラーに `httpStatus` と `Retry-After` 由来の `retryAfterSeconds` を保持しました。`FlareLobbyErrorOptions` と `FlareLobbyError` へ任意情報を追加し、`client.request` の非成功 HTTP 応答は本文形式にかかわらずステータスを保持します。`code` の意味は維持し、レート制限の `CONFLICT` を変更しません。`toJSON()` と通信 Envelope の wire 形式、WebSocket エラーは変更しません。
