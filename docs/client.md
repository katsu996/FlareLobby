# クライアント基盤

`@flarelobby/client` はブラウザ標準の `fetch` と `WebSocket` を使い、認証と
JSON 通信プロトコル v1 のエラー処理を共通化します。カスタムルームや
マッチメイキング固有のメソッドは後続 Issue で追加します。

## 初期化

```ts
import { createFlareLobbyClient } from "@flarelobby/client";

const client = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken()
});
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

### 再接続と状態復元

Room Durable Object は初回接続の `room.snapshot` Payload に、参加者へ束縛された
`resumeToken`、`resumeTokenExpiresAt`、および `resume` Handshake 情報を追加します。
トークンは URL や通常の Query へ入れず、初回の参加用トークンと同じ認証用
WebSocket subprotocol へ渡してください。切断後は、同じ再開トークンと最後に適用
した `revision` を `lastRevision` Query（または
`x-flarelobby-last-revision` Header）へ指定して再接続します。

履歴が残っている場合、サーバーは `lastRevision + 1` から現在の版までの
`room.snapshot` イベントを順番に送ってから、再接続済み Handshake を含む最新
スナップショットを送ります。履歴不足、範囲外、または不整合の場合は差分を送らず、
最新の完全スナップショットだけを返します。履歴は `eventHistoryLimit` 件で有界です。

WebSocket の切断は直ちに `leave()` へ変換されず、`disconnectGracePeriodMs` の間は
参加者の準備状態・チーム・参加者 ID を保持します。猶予終了時に参加者を退出させ、
ホストなら最古のプレイヤーへ移譲します。`leave()` または `kick()` は対象参加者の
再開セッションを明示的に無効化するため、古い再開トークンで新規参加へ暗黙変換されません。

## テスト用差し替え

`fetch`、`webSocket`、`webSocketFactory` を初期化設定へ渡すと、ブラウザ API を
テスト用実装へ差し替えられます。クライアントインスタンスごとに状態を保持する
ため、複数のクライアントを作成してもトークンや接続が共有されません。
