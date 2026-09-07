---
"@flarelobby/client": patch
---

`client.dispose()` と `destroy()` がマッチメイキングの Ticket、待機 Promise、再接続処理をローカルで確実に終了するようにしました。サーバー側の Ticket を自動でキャンセルせず、待機は `CANCELLED` で終了します。
