# 観測基盤

FlareLobby の観測は、Gateway Worker から Room Durable Object、Match Pool Durable Object、D1 のレーティング処理までを同じ相関情報で追跡するための最小共通基盤です。管理画面や特定の外部監視サービスはこの Issue の対象外です。

## 構造化ログ

ログは 1 操作 1 JSON レコードで、次の項目を持ちます。

| 項目            | 内容                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion` | 構造化ログの版。現在は `1`                                                                                                           |
| `event`         | `flarelobby.operation` 固定                                                                                                          |
| `timestamp`     | 出力時刻（ISO 8601）                                                                                                                 |
| `level`         | 成功時 `info`、失敗時 `error`                                                                                                        |
| `correlationId` | Gateway の入口で発行する要求追跡 ID                                                                                                  |
| `requestId`     | 冪等性要求と対応する論理要求 ID                                                                                                      |
| `operation`     | `room.create`、`room.join`、`room.connect`、`room.reconnect`、`matchmaking.ticket.create`、`matchmaking.match`、`rating.result` など |
| `durationMs`    | 操作の所要時間                                                                                                                       |
| `result`        | `success` または `failure`                                                                                                           |
| `errorCode`     | 失敗時の安定したエラーコード                                                                                                         |
| `stage`         | 必要な場合の処理段階                                                                                                                 |
| `attributes`    | 許可された低カーディナリティの数値・状態だけ                                                                                         |

`attributes` へ入れられるのは、ルーム種別、役割、再接続かどうか、状態、待機時間、レート差、検索幅、成立/キャンセル、試行回数などです。認証主体、プレイヤー ID、Room ID、トークン、パスワード、Authorization ヘッダー、HTTP 本文、ゲームメッセージ本文、内部例外のスタックは記録しません。

Gateway はクライアントの相関 ID を信頼せず、入口で新しい ID を発行します。次の内部ヘッダーと RPC の `observability` オプションで Durable Object へ渡します。

- `x-flarelobby-correlation-id`
- `x-flarelobby-request-id`

これらはアプリケーションの公開 HTTP 契約ではありません。

## Analytics Engine

`FLARE_LOBBY_ANALYTICS` は任意 Binding です。Binding がない場合、ログだけを出力し、Analytics Engine の書込みは無効になります。Binding があっても `writeDataPoint()` の失敗は主要処理へ伝播しません。

各データ点の `indexes` は次の順序です。

1. `flarelobby.v1`
2. メトリクス名
3. 操作名
4. 操作結果

`doubles[0]` が測定値、`blobs[0]` は相関 ID と安全な属性を含む JSON です。次のメトリクスを記録します。

| メトリクス                | 値                                                     |
| ------------------------- | ------------------------------------------------------ |
| `match_wait_time_ms`      | 成立した 2 チケットのうち長い待機時間                  |
| `match_rating_difference` | 成立時の絶対レート差                                   |
| `match_search_width`      | 成立時に適用された最大検索幅                           |
| `match_succeeded`         | 成立時に `1`                                           |
| `match_cancelled`         | キャンセル時に `1`                                     |
| `match_outcome`           | `status=matched`、`cancelled` などの終端結果ごとに `1` |

成立率とキャンセル率は、同じ期間・プールで `match_outcome` を終端状態別に集計して算出します。たとえば成立率は `status=matched` の件数を終端結果の総件数で割ります。検索幅は候補の待機時間から正規化済み検索ポリシーを使って再計算するため、設定変更後も定義が明確です。

## サンプリング

高頻度の成功操作は次の設定でサンプリングできます。既定値はすべて `1` です。失敗ログは原因追跡のためサンプリング設定に関係なく出力します。

```ts
const flarelobby = defineFlareLobby({
  // ...customRooms, matchmakingPools, authenticate, inputLimits...
  observability: {
    logSampleRate: 0.1,
    analyticsSampleRate: 0.25,
  },
});
```

両方とも `0` 以上 `1` 以下で指定します。不正値は `INVALID_OBSERVABILITY_CONFIGURATION` で拒否します。Analytics Engine を使わない環境でも `observability` を指定できます。

## 秘匿方針

- アクセストークン、参加トークン、再開トークン、パスワード、署名秘密値をログやメトリクスへ渡さない
- プレイヤー識別子を集計キーにしない。観測の相関にはランダムな `correlationId` と論理 `requestId` を使う
- 操作入力の Payload を属性へ展開しない
- WebSocket のゲームメッセージ本文を記録しない
- 観測先の障害、JSON 化の失敗、Analytics Engine の書込み失敗でルーム・マッチング・レーティング処理を失敗させない

観測項目を追加する場合も、公開 API やゲームメッセージの内容を記録するのではなく、安定した状態名・エラーコード・集計値で表現してください。
