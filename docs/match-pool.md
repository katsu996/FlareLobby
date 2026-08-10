# マッチングプールとチケット

`MatchPoolDurableObject` は、1 つのマッチングプールを 1 個の Durable Object として管理します。プールの Durable Object 名は `gameId:seasonId:mode:region` から決定的に作られます。各要素は URI エンコードするため、異なるプールの状態が同じ名前へ混ざりません。

## チケット状態

```text
作成中 → 待機中 → 候補確保中 → 成立済み
              ├────────→ キャンセル済み
              └────────→ 期限切れ
```

重要な状態は SQLite を正本とし、次の情報をチケットごとに保存します。

- 認証済み主体から決定したプレイヤー
- レーティング、参加時刻、プールのリージョン
- 入力方式と候補探索用の検索属性
- 期限、候補、成立結果、終端状態へ遷移した時刻

`creating`、`waiting`、`reserved` のチケットだけが有効チケットです。同じプールで同じプレイヤーの有効チケットは部分一意 index で 1 件に制限します。キャンセル済みまたは期限切れになった後は、別の作成要求で新しいチケットを作れます。

## 冪等性と競合

`createTicket()` は `requestId`、認証済みプレイヤー、作成条件を SQLite に保存します。同じ要求を再送すると最初のチケットを返し、同じ `requestId` に異なる条件を指定すると `CONFLICT` です。

候補探索は本クラスの責務ではありません。探索側は `reserveCandidate()` で 2 件の待機チケットを同一入力ゲート内に確保し、ルーム生成後に `matchCandidate()` で成立結果を適用します。予約後のキャンセルは `CONFLICT` とし、キャンセルと候補確保が競合した場合は先に SQLite へ確定した遷移だけが成功します。

## 期限と通知

Pool ごとに Alarm は 1 個だけ使い、最も近い待機チケットの期限へ設定します。期限処理は `waiting` または `creating` の行だけを `expired` へ遷移させるため、Alarm の再試行で同じイベントを重複生成しません。

`getTicketEvents()` はチケット状態と待機数・有効数の永続イベントを返します。Durable Object の `fetch()` へ `/v1/matchmaking/tickets/{ticketId}/events` または `/ws` で WebSocket 接続すると、同じイベントを JSON プロトコル v1 の `matchmaking.ticket` イベントとして受信できます。接続には Gateway の署名済み主体トークンが必要です。
