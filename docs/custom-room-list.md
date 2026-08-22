# 公開カスタムルーム一覧

`GET /v1/custom-rooms` は、`visibility: "public"` のカスタムルームだけを検索できる認証不要の API です。Room Durable Object の正本から秘密情報を除いた `RoomSummary` を D1 の検索用投影へ反映し、一覧取得を 1 つの Room Durable Object に集中させません。

## クエリ

| パラメーター        | 内容                                              |
| ------------------- | ------------------------------------------------- |
| `mode`              | Room 設定の `settings.mode` 完全一致              |
| `region`            | Room 設定の `settings.region` 完全一致            |
| `state`             | `waiting`、`preparing`、`in_progress`、`finished` |
| `status`            | `state` の別名                                    |
| `available`         | `true` のとき、プレイヤー空き枠があるルームだけ   |
| `availableSlots`    | プレイヤー空き枠が指定値以上                      |
| `minAvailableSlots` | `availableSlots` の別名                           |
| `limit`             | 1〜100 件。既定値は 20                            |
| `pageSize`          | `limit` の別名                                    |
| `cursor`            | 前ページの `nextCursor`                           |

`state` と `status`、`availableSlots` と `minAvailableSlots` を同時に指定する場合は、値を一致させます。`state` と `status` は複数指定にも対応します。ページングは `createdAt DESC, roomId DESC` の固定順で行い、カーソルには検索条件・件数・位置を束ねた HMAC 署名を付けます。別の条件へカーソルを持ち越すことはできません。

## 応答と秘密情報

成功時は次の形です。

```json
{
  "rooms": [
    {
      "id": "room_...",
      "kind": "custom",
      "roomId": "room_...",
      "name": "公開ルーム",
      "mode": "casual",
      "region": "jp",
      "visibility": "public",
      "state": "waiting",
      "joinMethod": "password",
      "requiresPassword": true,
      "maxPlayers": 4,
      "playerCount": 1,
      "availableSlots": 3,
      "maxSpectators": 0,
      "spectatorCount": 0,
      "availableSpectatorSlots": 0,
      "revision": 0,
      "createdAt": 0,
      "updatedAt": 0
    }
  ],
  "nextCursor": null
}
```

パスワード、招待コード、参加用トークン、パスワードハッシュ、Durable Object の内部識別子、参加者の主体情報は `RoomSummary` に含めません。パスワード方式では `requiresPassword` だけを返します。

## 一貫性と再試行

一覧テーブルは D1 の非正規化投影です。Room の作成、参加、退出、設定変更、開始、状態遷移、閉鎖の後に最新の Room SQLite から同期します。D1 が一時的に利用できない場合でも Room の操作は成功し、同期 operation を Room SQLite に保存して単一 Alarm から再試行します。更新には Room の `revision` を付け、遅れて到着した古い投影が新しい投影を上書きしないようにします。

したがって一覧の空き枠や状態は一時的に古い可能性があります。参加 API は一覧を信頼せず、対象の Room Durable Object を再確認して最終的な参加可否・満員・終了判定を行います。閉鎖済み Room の保持期限処理でも、公開一覧からの D1 削除が成功するまで Room の正本を削除しません。

## 検証

- 公開ルームだけが一覧に出て、一覧非表示ルームは出ない
- `mode`、`region`、空き枠の条件検索ができる
- 署名付きカーソルで複数ページを重複なく取得でき、条件の持ち越しを拒否する
- 参加者数、満員、開始済み、閉鎖済みの状態が投影される
- 古い一覧からの参加でも Room Durable Object の現在状態が最終判定になる
- 公開応答に秘密情報や内部識別子が含まれない
- D1 同期失敗を Room 内の再試行可能な operation として保持する
