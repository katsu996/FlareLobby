# クライアント基盤

`@flarelobby/client` はブラウザ標準の `fetch` と `WebSocket` を使い、認証と
JSON 通信プロトコル v1 のエラー処理を共通化します。カスタムルームの作成、
参加、一覧、Room 操作までを接続済みのオブジェクト API として提供します。

## 初期化

```ts
import { createFlareLobbyClient } from "@flarelobby/client";

const client = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken()
});

const room = await client.createCustomRoom({ maxPlayers: 4 });
const joinedRoom = await client.joinCustomRoom("4F9K2D");
const rooms = await client.listCustomRooms({ available: true });

await room.setReady(true);
await room.selectTeam("blue");
await room.send("chat.message", { text: "準備完了" });
```

`getAccessToken` はクライアント生成時には呼ばれません。HTTP 要求ごとに直前で
呼び出されるため、トークン更新後の値が使われます。認証取得関数の例外や空の
戻り値は、内部情報を含まない `UNAUTHENTICATED` へ変換されます。

## HTTP 要求

```ts
const result = await client.request<{ readonly accepted: boolean }>(
  "/v1/example",
  {
    method: "POST",
    body: { value: 1 },
    idempotent: true
  }
);
```

`idempotent: true` を指定した要求には `requestIdFactory` で生成した
`Idempotency-Key` が付与されます。再送時は同じ `requestId` を明示できます。
`AbortSignal` は `fetch` へそのまま伝播され、中止時は `CANCELLED` になります。
HTTP の失敗、JSON の不正、通信例外は `FlareLobbyError` と安定したエラーコードへ
正規化されます。

## カスタムルーム

`createCustomRoom()` は作成者をホストとして登録し、HTTP の初期スナップショットを
凍結したうえで WebSocket へ接続した `HostRoom` を返します。`joinCustomRoom()` は
招待コード文字列、または `roomId`、`invitationCode`、`role`、`password` を含む
詳細 Options を受け付けます。`role: "spectator"` の参加者は観戦者用の型で返り、
プレイヤー操作は実行時にも `FORBIDDEN` になります。

Room の状態変更メソッドはサーバーの成功応答を待ってから解決し、成功時の最新
スナップショットを返します。`snapshot` とその入れ子の値は利用者から変更できません。
`leave()` は参加用トークンを使った HTTP 退出、ホストの `close()` は WebSocket
操作として実行されます。

## WebSocket

```ts
const connection = await client.connect("/v1/rooms/room-1/ws", {
  knownEventTypes: ["room.snapshot"]
});

const result = await connection.send("room.set_ready", { ready: true });
const unsubscribe = connection.onEvent((event) => {
  // event.event と event.payload を処理する
});
```

WebSocket の接続時にも最新のアクセストークンを取得します。ブラウザの標準
WebSocket は任意の HTTP ヘッダーを付けられないため、トークンは URL の Query へ
入れず、認証用の WebSocket subprotocol として送ります。トークン値は URL、公開
エラー、内部例外へ含めません。

`connect` と `connection.send` は AbortSignal を受け付けます。`dispose()` は
保有中の WebSocket、イベント購読、応答待機を解放し、以後の操作を
`CANCELLED` として拒否します。

## テスト用差し替え

`fetch`、`webSocket`、`webSocketFactory` を初期化設定へ渡すと、ブラウザ API を
テスト用実装へ差し替えられます。クライアントインスタンスごとに状態を保持する
ため、複数のクライアントを作成してもトークンや接続が共有されません。
