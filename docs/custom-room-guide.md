# カスタムルーム利用ガイド

カスタムルームは、利用者が作成し、招待または公開一覧から参加するルームです。
Room Durable Object が参加者、定員、権限、状態、WebSocket 接続の正本を持ちます。
一覧やクライアントのローカルスナップショットは、参加可否の最終判定ではありません。

## 基本利用

```ts
import { createFlareLobbyClient } from "@flarelobby/client";
import type { FlareLobbyApp } from "@flarelobby/core";

type GameApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string },
  { chat: { text: string } }
>;

const lobby = createFlareLobbyClient<GameApp>({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken()
});

const host = await lobby.createCustomRoom({
  name: "週末の練習",
  visibility: "unlisted",
  joinMethod: "invitation",
  maxPlayers: 4,
  settings: { map: "forest" }
});

const unsubscribe = host.subscribe((snapshot) => {
  render(snapshot);
});

await host.setReady(true);
await host.selectTeam("blue");
await host.send("chat", { text: "準備できました" });
unsubscribe();
```

`createCustomRoom()` と `joinCustomRoom()` は、HTTP の成功結果を受け取った後に
WebSocket 接続と初期スナップショット同期まで完了した Room ハンドルを返します。
通常利用で `connect()` を別途呼び出す必要はありません。

## 作成方式

| 設定 | 動作 | `invitationCode` |
| --- | --- | --- |
| `joinMethod: "public"` | ルーム ID を指定して認証・認可後に参加 | `null` |
| `joinMethod: "invitation"` | 6 文字の招待コードと Room の照合が必要 | 作成結果に含む |
| `joinMethod: "password"` | Room 側のパスワード照合が必要 | `null` |

`joinMethod` の `"open"` と `"invite"`、`joinMode`、`listing`、`title` は入力の
説明的な別名です。説明が分かれる場合は正規名を優先してください。パスワードは
返却値や一覧へ含まれず、平文保存もしません。

## 参加・観戦

```ts
const player = await lobby.joinCustomRoom(host.id);

const spectator = await lobby.joinCustomRoom({
  roomId: host.id,
  role: "spectator",
  password: "必要な場合だけ"
});

// SpectatorRoom では、退出と購読だけが利用できます。
await spectator.leave();
await player.leave();
```

文字列形式はプレイヤー参加の短縮形です。観戦者は必ず詳細 Options の
`role: "spectator"` を指定します。同じ認証主体の同じ役割の再送は既存参加者へ
収束しますが、別役割での重複参加は `CONFLICT` です。プレイヤー枠と観戦者枠は
別々に数えます。

## Room 操作と権限

| ハンドル | 操作 | 成功時の戻り値 |
| --- | --- | --- |
| `PlayerRoom` | `setReady`、`selectTeam`、`send`、`leave` | 最新 `RoomSnapshot`（`send` は `void`） |
| `HostRoom` | 上記に加えて `updateSettings`、`transferHost`、`kick`、`startMatch`、`close` | 最新 `RoomSnapshot` |
| `SpectatorRoom` | `subscribe`、`on`、`onMessage`、`onStatusChange`、`leave` | 操作ごとの契約に従う |

サーバーが成功応答を返すまで Promise は解決しません。クライアントからの
`playerId` は本人確認に使われず、Gateway が認証 Hook から得た主体へ束縛されます。
権限不足は `FlareLobbyError.code === "FORBIDDEN"` で判定します。

`startMatch()` は `minimumPlayers`、`requireAllPlayersReady`、役割、現在の Room
状態を検証します。`close()` は Room を `finished` へ進めます。終了済み Room は
再開できません。

## スナップショットとイベント

`room.snapshot` は読み取り専用です。`revision` は状態変更ごとに増加し、同じ
revision の再送は一度だけ適用されます。欠落や逆順を検出した場合は不完全な部分
状態を公開せず、サーバーから差分または完全スナップショットを再取得します。

```ts
const stopSnapshot = player.subscribe((snapshot) => {
  if (snapshot.state.status === "preparing") {
    showCountdown(snapshot.state.preparationStartedAt);
  }
});

const stopStatus = player.onStatusChange((status) => {
  // connecting / connected / reconnecting / disconnected
  showConnection(status);
});

const stopMessage = player.onMessage("chat", (message) => {
  showChat(message.payload.text, message.sender?.participantId);
});
```

購読解除関数は冪等です。購読者の例外は他の購読者や Room の内部状態更新を止め
ません。

## 再接続

一時的な WebSocket 切断は `leave()` ではありません。Room は切断猶予の間、参加者
ID、準備状態、チーム、ホスト情報を保持します。Client SDK は指数バックオフと揺らぎ
を使って再接続し、最後の `revision` とサーバー発行の再開トークンを送ります。

```ts
const room = await lobby.joinCustomRoom({
  roomId: host.id,
  reconnect: {
    maxAttempts: 5,
    baseDelayMs: 250,
    maxDelayMs: 5_000,
    jitterRatio: 0.2
  }
});
```

履歴が残っているときは連続イベントを再送し、履歴が不足すると完全スナップショット
へ切り替えます。明示的な `leave()`、`kick()`、`close()` 後は自動再接続しません。
ホストの明示退出は最古のプレイヤーへ移譲し、移譲先がなければ Room を閉鎖します。

## HTTP を直接使う場合

Client SDK を使わない場合の入口は次のとおりです。

| 操作 | エンドポイント | 認証 | 成功結果 |
| --- | --- | --- | --- |
| 作成 | `POST /v1/custom-rooms` | 必須 | `CustomRoomCreationResult` |
| 参加 | `POST /v1/custom-rooms/join` または `POST /v1/custom-rooms/{id-or-code}/join` | 必須 | `CustomRoomJoinResult` |
| 退出 | `POST /v1/custom-rooms/leave` または `POST /v1/custom-rooms/{roomId}/leave` | 必須 | `CustomRoomLeaveResult` |
| 一覧 | `GET /v1/custom-rooms` | 不要 | `CustomRoomListResult` |
| 接続 | `GET /v1/custom-rooms/{roomId}/ws` | WebSocket subprotocol | `room.snapshot` イベント |

HTTP のエラー本文は `{ "code": "...", "message": "..." }` です。`message` の
文言では分岐せず、[APIリファレンス](./api-reference.md#エラーコード)の安定した
コードだけを使ってください。

## 関連文書

- [カスタムルームの参加・退出・観戦](./custom-room-participation.md)
- [公開カスタムルーム一覧](./custom-room-list.md)
- [JSON 通信プロトコル v1](./protocol.md)
- [アーキテクチャ](./architecture.md)
