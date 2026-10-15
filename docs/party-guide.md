# パーティー利用ガイド

パーティーは、マッチングへまとめて参加するための小集団です。
1 パーティー = 1 Durable Object が正本状態を持ち、リーダーが招待とキュー投入を行います。

## ライフサイクル

作成 → 招待 → 受諾 →（キュー投入 → 成立）→ 退出・移譲・解散の順に進みます。
すべての変更操作は `requestId` 再生に対応し、同じ `requestId` + 同一内容の再送は
保存結果を返します。異なる内容での再利用は `CONFLICT` です。

## 操作一覧

| 操作         | HTTP                                                                           | SDK                                     | 権限             |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------- | ---------------- |
| 作成         | `POST /v1/parties`（`requestId` 必須、`maxPartySize?`）→ `201`                 | `client.createParty()`                  | 誰でも新規作成可 |
| 招待         | `POST /v1/parties/{partyId}/invites`（`requestId`・`playerId` 必須、`ttlMs?`） | `party.invite(playerId)`                | リーダーのみ     |
| 受諾         | `POST /v1/parties/{partyId}/members`（`requestId`・`token` 必須）              | `client.joinParty({ partyId, token })`  | 招待された本人   |
| 取得         | `GET /v1/parties/{partyId}`                                                    | `client.getParty()` / `party.refresh()` | メンバーのみ     |
| 退出         | `POST /v1/parties/{partyId}/leave`（`requestId?`）→ `{ dissolved }`            | `party.leave()`                         | 本人のみ         |
| 移譲         | `POST /v1/parties/{partyId}/transfer-leadership`（`playerId` 必須）            | `party.transferLeadership(playerId)`    | リーダーのみ     |
| 解散         | `POST /v1/parties/{partyId}/dissolve`（`requestId?`）                          | `party.dissolve()`                      | リーダーのみ     |
| イベント取得 | `GET /v1/parties/{partyId}/events`                                             | 自動接続                                | メンバーのみ     |
| イベント購読 | `GET /v1/parties/{partyId}/events/ws`（WebSocket）                             | `party.on("update", ...)`               | メンバーのみ     |
| キュー投入   | マッチングチケット作成に `partyId` を指定                                      | `party.joinRankedQueue(pool)`           | リーダーのみ     |
| キュー取消   | チケット取消                                                                   | `party.cancelQueue()`                   | リーダーのみ     |

## 招待の仕組み

- 招待は対象ごとの単一用途トークンです。既定 TTL は 10 分（`DEFAULT_PARTY_INVITE_TTL_MS`）で、`ttlMs` で変更できます。
- 期限内かつ未使用の招待が同一対象に存在する場合、再発行要求は既存トークンを返します。
- 受諾時はトークンを使用済みにし、呼び出し者を `member` として追加します。
  トークン不存在・使用済・他人宛・期限切れは `FORBIDDEN` です。
- 満員（既定 5 人、`DEFAULT_PARTY_MAX_SIZE`。作成時に `maxPartySize` で 2〜64 の範囲で変更可）時は `ROOM_FULL` です。

## 同時所属の禁止

主体は同時に 1 つのパーティーにしか所属できません。主体 ID を分割キーとする
`PartyMembershipDurableObject` が原子的に検査し、違反する作成・受諾は `CONFLICT` です。

## 待機中の制約

マッチング待機中（キュー投入済み）のパーティーは凍結されます。

- 参加・退出・招待受諾は `CONFLICT` で拒否されます（退出は先にチケットを取消してください）。
- 解散は待機チケットの取消を伴って実行できます。
- チケットが終端状態になると凍結は解除されます。

## 自動解散と無活動掃除

- 退出後の残存が 2 未満になった場合、自動解散します。
  リーダーの自発退出で残存が 2 以上ある場合は、最古参メンバーへ権限が移ります。
- 24 時間（`DEFAULT_PARTY_IDLE_TTL_MS`）無活動のパーティーは Alarm で掃除されます。
  使用済・期限切れの招待も Alarm で削除されます。

## イベント

`created` / `member_joined` / `member_left` / `leader_transferred` /
`invite_created` / `queue_started` / `queue_ended` / `dissolved` を配信します。
各イベントは完全 Snapshot を運び、`sequence` は単調増加します。
`afterSequence` を指定した再接続で差分を取得できます。

## 関連文書

- [Client SDK](./client.md)
- [マッチングプール](./match-pool.md)
- [マッチメイキング](./matchmaking-guide.md)
- [API リファレンス](./api-reference.md)
