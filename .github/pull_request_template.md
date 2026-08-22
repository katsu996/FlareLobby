## 概要

<!-- 何を変更し、利用者や運用へどのような影響があるかを日本語で記載してください。 -->

## 対応 Issue

Closes #

## 変更内容

-

## 設計・公開契約への影響

- [ ] 設計の正本 #1 を確認した
- [ ] 公開型、引数、戻り値、イベント、エラーコードに変更はない
- [ ] 変更がある場合、APIリファレンスと移行方法を更新した
- [ ] 未実装機能を利用可能と誤認させる記載がない

## 検証

```text
pnpm lint
pnpm format:check
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm check:docs
```

実行結果:

## 完了条件

- [ ] Issue 本文の完了条件を一つずつ確認した
- [ ] 文書コード例を型検査または自動テストした
- [ ] 破壊的変更、Migration、Secret、デプロイ手順を必要に応じて記載した
