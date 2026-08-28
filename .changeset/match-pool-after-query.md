---
"@flarelobby/cloudflare": patch
---

マッチングチケットイベント端点の `after` クエリに不正値を渡すと、400 応答ではなく未捕捉の例外（workerd の uncaught exception）になっていた問題を修正しました。`parseAfterSequence()` の throw をハンドラ側で捕捉し、`INVALID_PAYLOAD` の 400 応答へ正規化します。
