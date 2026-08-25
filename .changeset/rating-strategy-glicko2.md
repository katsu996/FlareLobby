---
"@flarelobby/core": minor
---

レーティング計算を Strategy として差し替え可能にし、Glicko-2 を追加しました(ADR-0006)。

- `glicko2()`: RD とボラティリティを持つ Glicko-2 エンジンを追加しました。`calculate()` の入力へ `deviationA` / `deviationB` を渡せ、結果には両側の更新後 RD・ボラティリティが含まれます。既知の参照実装値で単体テストしています。
- `RatingCalculation.deltaB` は「B 側の整数差分」という契約になり、`deltaA + deltaB = 0` は ELO 固有の性質として文書化しました。Glicko-2 では各側の不確実性に応じて独立に決まります。
- `@flarelobby/cloudflare`: Pool 設定の `rating.algorithm: "glicko-2"` で Glicko-2 を選択できます(省略時は `"elo"` で後方互換)。D1 へ RD・ボラティリティと Season の方式を保存し、1 対 1・チーム対応どちらの結果登録も冪等なまま Glicko-2 で機能します。
- D1 migration `0005_rating_algorithm.sql`(列追加)を追加しました。既存環境の行はすべて ELO として扱われます。
