# マッチングプール、候補探索、チケット

`MatchPoolDurableObject` は、1 つのマッチングプールを 1 個の Durable Object として管理します。プールの Durable Object 名は `gameId:seasonId:mode:region` から決定的に作られます。各要素は URI エンコードするため、異なるプールの状態が同じ名前へ混ざりません。

## チケット状態

```text
作成中 → 待機中 → 候補確保中 → 成立済み
              ├────────→ キャンセル済み
              └────────→ 期限切れ
```

候補を確保すると、Match Pool は候補ごとに 1 件の成立意図を永続化し、対戦
Room の初期化とチケットの `matched` 遷移を続けて処理します。通常はチケット
追加時、候補探索時、または Alarm で自動的に進みます。

重要な状態は SQLite を正本とし、次の情報をチケットごとに保存します。

- 認証済み主体から決定したプレイヤー
- レーティング、参加時刻、プールのリージョン
- 入力方式と候補探索用の検索属性
- 期限、候補、成立結果、終端状態へ遷移した時刻

`creating`、`waiting`、`reserved` のチケットだけが有効チケットです。同じプールで同じプレイヤーの有効チケットは部分一意 index で 1 件に制限します。キャンセル済みまたは期限切れになった後は、別の作成要求で新しいチケットを作れます。

## 候補探索

候補評価は `@flarelobby/core` の純粋関数として実装しています。既定の検索幅は、待機開始時のレート差 `75`、20 秒後の `150`、60 秒後の `400` です。2 チケットのレート差が、両方の待機時間に対応する検索幅以下で、同じ Pool・リージョンかつ別プレイヤーの場合だけ成立可能と判定します。入力方式の違いは成立不可条件ではなく品質説明へ含めます。

候補品質には次の情報を含めます。

- レート差と比較用の品質値
- チケットごとの待機時間と検索幅
- リージョン一致
- 入力方式一致

同じ品質の候補は待機時間が長いチケットを優先し、待機時間も同じ場合は候補 ID（チケット ID の安定した組み合わせ）で順序を固定します。1 回の探索で読むチケット数、評価する候補組数、確保する候補数には設定上限があります。

Pool の初期化時または `configureSearchPolicy()` で設定を変更できます。

```ts
await pool.initialize({
  pool,
  searchPolicy: {
    stages: [
      { afterMs: 0, maxRatingDifference: 50 },
      { afterMs: 15_000, maxRatingDifference: 100 },
      { afterMs: 45_000, maxRatingDifference: 250 },
    ],
    maxRatingDifference: 250,
    maxTicketsPerSearch: 256,
    maxCandidatesPerSearch: 8_192,
    maxMatchesPerSearch: 32,
  },
});
```

`searchCandidates()` は品質説明を返すだけで状態を変更せず、`searchAndReserveCandidates()` は選択した候補を同じ SQLite 整合性境界で `reserved` へ進めます。チケット追加時と検索幅の切替時には後者を自動的に起動し、続けて成立処理も起動します。

## 成立処理と対戦 Room

成立意図の `matchId` は候補 ID から決定的に作られ、対戦 Room の ID も
`matchId` から決定的に作られます。そのため、同じ候補の成立処理を再実行しても
別の Room や別の成立結果は作成されません。

```ts
await pool.initialize({
  pool,
  matchRoom: {
    settings: { map: "forest" },
    metadata: { playlist: "ranked" },
    teamIds: ["blue", "red"],
    maxPlayers: 2,
    minimumPlayers: 2,
    requireAllPlayersReady: false,
  },
});
```

`MatchmakingMatchIntent` は `pending`、`initializing`、`matched`、`failed` の
状態を SQLite に保持します。`processPendingMatches()`、`settleMatches()`、
`processMatchmaking()` で未完了の成立処理を明示的に再開できます。成立意図を
取得するには `getMatchIntent(matchId)` または候補 ID を指定します。

処理順序は、(1) 成立意図の確保、(2) 対戦 Room の冪等な初期化、(3) Room の
スナップショットと `matchId` の検証、(4) 2 チケットの `matched` 遷移、(5)
永続イベントの追加です。Room の初期化が成功するまで `matched` 通知は生成
されません。WebSocket への送信に失敗しても永続イベントは残るため、再接続後に
`getTicketEvents()` で両チケットの成立結果を再取得できます。

一時的な Room RPC・ストレージ障害は指数バックオフで自動再試行し、Alarm も
次回試行時刻へ更新します。Durable Object のインスタンスが再生成されても、
`pending` または期限切れの `initializing` 成立意図を SQLite から読み直して
処理を再開します。最大試行回数を超えた成立意図は `failed` になり、まだ
`reserved` のチケットは `cancelled` へ解放されます。

## 冪等性と競合

`createTicket()` は `requestId`、認証済みプレイヤー、作成条件を SQLite に保存します。同じ要求を再送すると最初のチケットを返し、同じ `requestId` に異なる条件を指定すると `CONFLICT` です。

探索側は `reserveCandidate()` で 2 件の待機チケットを同一入力ゲート内に確保し、成立意図に従って Room 初期化後に `matchCandidate()` で成立結果を適用します。予約後のキャンセルは `CONFLICT` とし、キャンセルと候補確保が競合した場合は先に SQLite へ確定した遷移だけが成功します。自動探索も同じ確保処理を通るため、選択済みチケットを別候補へ重複確保しません。

## 期限と通知

Pool ごとに Alarm は 1 個だけ使い、最も近いチケット期限または次の検索幅切替時刻へ設定します。待機チケットがなく、期限処理も検索幅切替も不要になった場合は Alarm を削除します。期限処理は `waiting` または `creating` の行だけを `expired` へ遷移させるため、Alarm の再試行で同じイベントを重複生成しません。

`getTicketEvents()` はチケット状態、待機数・有効数、イベント発生時点の検索幅を含む永続イベントを返します。Durable Object の `fetch()` へ `/v1/matchmaking/tickets/{ticketId}/events` または `/ws` で WebSocket 接続すると、同じイベントを JSON プロトコル v1 の `matchmaking.ticket` イベントとして受信できます。イベントの `sequence` は Pool 全体で採番されるため、特定チケットの履歴には数値の飛びが含まれることがあります。接続には Gateway の署名済み主体トークンが必要です。
