# ゲーム統合ガイド

ゲーム側（FPS）から FlareLobby を利用するための統合ガイドです。
ハンドオフ、再戦、一覧、CORS、メッセージ、結果テーブルの扱いをまとめます。
コード変更は含みません。

## ハンドオフ用 settings/metadata 公式スキーマ（F6）

対戦成立後にゲーム側へ渡すハンドオフ情報の公式スキーマです。

| 項目                   | 内容                              |
| ---------------------- | --------------------------------- |
| `roomId`               | FlareLobby のルーム識別子         |
| `matchId`              | マッチ識別子                      |
| `descriptor`           | `mapId` / `mode` などの対戦記述子 |
| `protocolVersion`      | プロトコルバージョン              |
| `catalogHash`          | カタログハッシュ                  |
| `socketPath`           | 接続先パス（ticket なし）         |
| `reservationExpiresAt` | 予約有効期限                      |

- 想定サイズは記述子 + ID で数百バイト、数 KB 以内です。上限として数 KB を超えないでください。
- token / secret 類は載せません（例外なし。session token・ticket は載せない）。
  `socketUrl` に ticket 付き URL は含めず、ticket は別途 `/api/v2` で取得します。

## quick/rematch レシピ（F7）

- `rematch` = 同メンバー即時再戦（roomCode 保持・新 room / match ID へ合流、
  終了履歴 90 秒・旧席 30 秒保持）。
- `quick` = 1 タップ入室（人数最多の public へ予約、満員なら上限 10 室範囲で
  public 作成）。自動マッチングではありません。
- 現行 API に専用エンドポイントはないため、ゲーム側で rooms の再作成フローとして実装します。

```ts
// rematch: 同メンバーで新 room を作成し、新 room / match ID へ合流する。
const next = await lobby.createCustomRoom({ name: previous.name, settings });
await notifyMembers(previous.roomCode, next);

// quick: 人数最多の public へ予約し、満員なら上限 10 室範囲で public を作成する。
const publics = await listPublicRooms({ limit: 10 });
const target =
  mostPopulated(publics) ??
  (await lobby.createCustomRoom({ visibility: "public", settings }));
await lobby.joinCustomRoom(target.id);
```

## 公開一覧の拡張手段（F8）

結論: カスタム投影・フィルタ拡張は行いません。代替クエリ例で対応します。

- `phase` は `waiting` / `playing` の 2 値です（FlareLobby state とは別）。
  `remainingSeconds` は試合残り秒で、`playing` 時のみ減算し、`waiting` は `null` 可です。
- 取得は手動 + 詳細 open 時の 10 秒 poll です（server 側 rate は 3/10 秒）。最大 10 件です。
- 必須は `acceptingJoin` + `activePlayers` / `reservedSlots` / `maxPlayers`（= 8）です。
  `phase` / `remainingSeconds` は欠けても可、`reservedSlots` は必須寄り
  （予約込み定員判定のため）です。

代替クエリ例（現行 `GET /v1/custom-rooms` の範囲で取得し、ゲーム側で絞り込みます）：

```ts
const page = await fetch("/v1/custom-rooms?available=true&limit=10").then((r) =>
  r.json(),
);
// acceptingJoin + activePlayers / reservedSlots / maxPlayers を参照し、
// phase / remainingSeconds は欠けても可として扱う。
```

## CORS（F9）

対象 Origin と WS の扱いです。FlareLobby 側の設定方法は
[Cloudflare 設定](./cloudflare-configuration.md#cors-ブラウザからの利用) を参照してください。

- 対象 Origin: `http(s)://localhost(:port)`・`127.0.0.1`・`[::1]`・
  `http(s)://tauri.localhost` + 同一 origin + `ALLOWED_ORIGINS`。
- WS も Origin 付きで検証します。
- `tauri.localhost` のポート付きが必要になった場合はゲーム側から別途申告してください。

## `game.message` 誤用防止（F10）

- `game.message` の tick 用途は非推奨です。docs 明記のみで、拒否 / 警告 / メトリクスは行いません。
- ゲーム側の高頻度経路は現行 `input_batch`（30Hz 送信・2step/batch）のみです。
  `game.message` で送る予定はありません。
- `maxMessagesPerMinute: 60` を 3600 に上げる誤用を防ぐため、高頻度送信には
  `input_batch` を使い、`game.message` の上限引き上げは行わないでください。

## 結果テーブルの共存ガイド（F11）

- 自テーブル（`game_results` 等）追加 + `authorizeMatchResult` 併記の公式例です。
- rating 不要構成（自テーブルのみ）も可です。
- ゲーム側確定: rating 併用は最初なし。確定は Match DO が終了時に D1 へ冪等確定
  （3 回 retry、失敗時は `match_ended.resultStatus=unsaved`）。
  `aborted` は DO 再起動 / デプロイ / 致命的例外・過負荷中断・空室終了時です。

```ts
// 自テーブル確定（rating 併用なしでも可）。
await db.prepare("INSERT INTO game_results (match_id, payload) VALUES (?, ?)")
  .bind(matchId, JSON.stringify(result))
  .run();

// FlareLobby rating 連携時のみ authorizeMatchResult を使用する。
authorization: {
  authorizeMatchResult: ({ principal, matchId }) =>
    matchId !== undefined && canRegisterMatchResult(principal.id, matchId),
}
```

## P2（将来・defer）

今回は対象外とし、issue 起票のみに留めます。

- 使い切り token オプション
- result 拡張（score/kill 受付）
- 共存テストヘルパー

## 関連文書

- [カスタムルーム利用ガイド](./custom-room-guide.md)
- [公開カスタムルーム一覧](./custom-room-list.md)
- [認証・認可・入力検証・利用制限](./security.md)
- [Cloudflare 設定](./cloudflare-configuration.md)
