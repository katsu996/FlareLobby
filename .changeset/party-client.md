---
"@flarelobby/client": minor
---

パーティー操作の Client SDK API を追加しました。

- `createParty()` / `getParty()` / `joinParty()`: パーティーの作成、状態取得、単一用途トークンによる参加を接続済みの `Party` ハンドルとして提供します。
- `Party` ハンドルに `invite()`、`leave()`、`transferLeadership()`、`dissolve()` を追加しました。
- `joinRankedQueue()` / `cancelQueue()` でパーティー単位のランクキュー参加とキャンセルができます。`joinMatchmaking()` のオプションにも `partyId` を追加しました。
- イベント接続はメンバー全員が利用でき、切断時は最後に適用したイベント番号から履歴を再取得して Party 状態を復元します。
