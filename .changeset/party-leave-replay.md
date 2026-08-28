---
"@flarelobby/cloudflare": patch
---

`leaveParty()` の同じ `requestId` 再送時の応答を修正しました。これまでは記録された結果が `{ dissolved: false }` というスナップショットとは異なる形式で返っていました。初回呼び出しと同じ `PartySnapshot` を再送でも返すように冪等性を統一します（解散時は従来どおり `null`）。
