---
"@flarelobby/cloudflare": patch
---

MatchPool と Party のチケット/パーティーイベント WebSocket の 101 応答に `Sec-WebSocket-Protocol: flarelobby.v1` を付与し、Room と同じサブプロトコル交渉にしました。サブプロトコルを要求するクライアントで `wrangler dev` ローカルの WebSocket が 1006 で切断される問題を修正します。
