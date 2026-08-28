---
"@flarelobby/cloudflare": patch
---

Party Gateway の不具合を修正しました。

- `POST /v1/parties` が空文字の DO 名に紐づくパーティーを作成し、応答の `partyId` が空になる問題を修正しました。Gateway が作成時に新しい Party ID を発行します。
- `GET /v1/parties/{partyId}/events/ws`（WebSocket アップグレード）が認証フックで再署名せず生トークンを転送していたため、常に 401 になっていた問題を修正しました。Matchmaking WebSocket と同じく、サブプロトコルのアクセストークンを検証して Gateway Token へ変換して転送します。
