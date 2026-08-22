# ADR-0001: Durable Object と SQLite を正本にする

- 状態: 採用
- 日付: 2026-08-11
- 対象: Room、Match Pool、Rate Limit

## 背景

Durable Object は休眠やインスタンス再生成が発生します。参加者、チケット、冪等性
結果をメモリだけへ置くと、再生成後に定員超過、二重処理、状態の巻き戻りが起きます。
一方で全 Room/Pool を一つのグローバルオブジェクトへ集約すると、並列性と障害分離を
失います。

## 決定

Room は `roomId`、Match Pool は `gameId:seasonId:mode:region` を Durable Object の
識別単位とし、重要状態を SQLite へ保存します。メモリは短時間の in-flight 処理と
表示キャッシュだけに使います。状態変更には単調な `revision`、クライアント操作には
`requestId` を付け、入力ゲート内で原子的に検証・更新・結果保存を行います。

## 代替案

- Worker のグローバルメモリへ保存する: 再生成で失われるため不採用。
- D1 だけへ全 Room 状態を保存する: Room ごとの強整合と低遅延 WebSocket 処理を損なうため不採用。
- 全体を一つの Durable Object へ集約する: ホットスポットと障害半径が大きくなるため不採用。

## 結果

Room/Pool ごとに直列化された整合性を得られ、Alarm と SQLite から処理を再開できます。
その代わり、複数 Room をまたぐトランザクションは提供しません。共有検索情報と
レーティング履歴は D1 へ置き、Room の最終判定と分離します。
