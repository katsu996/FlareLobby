# クライアント基盤

`@flarelobby/client` はブラウザ標準の `fetch` と `WebSocket` を使い、認証と
JSON 通信プロトコル v1 のエラー処理を共通化します。カスタムルームの作成、
参加、一覧、Room 操作までを接続済みのオブジェクト API として提供します。

## 初期化

```ts
import { createFlareLobbyClient } from "@flarelobby/client";

const client = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
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
    idempotent: true,
  },
);
```

`idempotent: true` を指定した要求には `requestIdFactory` で生成した
`Idempotency-Key` が付与されます。再送時は同じ `requestId` を明示できます。
`AbortSignal` は `fetch` へそのまま伝播され、中止時は `CANCELLED` になります。
HTTP の失敗、JSON の不正、通信例外は `FlareLobbyError` と安定したエラーコードへ
正規化されます。

### HTTP エラーと待ち時間表示

HTTP の非成功応答は本文の形式（JSON・非 JSON・空・不正）にかかわらず
`httpStatus` を保持し、有効な `Retry-After` があれば `retryAfterSeconds` も
保持します。`code` の意味は変えず、レート制限は `code: "CONFLICT"` のままです。
`Retry-After` は非負の整数秒または有効な HTTP 日時だけを解釈し、欠落・不正値は
未設定です。別オリジンでは CORS の `Access-Control-Expose-Headers: Retry-After`
により読み取れます。自動リトライは行いません。

```ts
import { FlareLobbyError } from "@flarelobby/core";

try {
  await client.request("/v1/custom-rooms", {
    method: "POST",
    body: { name: "練習ルーム" },
  });
} catch (error) {
  if (error instanceof FlareLobbyError) {
    const waitSeconds = error.retryAfterSeconds;
    showError({
      code: error.code,
      status: error.httpStatus,
      message:
        waitSeconds === undefined
          ? error.message
          : `${error.message}（約${waitSeconds}秒後に再試行できます）`,
    });
  } else {
    throw error;
  }
}
```

## タイムアウト

HTTP 要求、WebSocket 接続、WebSocket コマンドには期限を設定できます。
操作の `timeoutMs` が `undefined` のときは Client の既定値を継承し、`null` は
明示的な無期限です。省略し続けた場合は無期限で、従来の `AbortSignal` 対応を維持します。

```ts
const client = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
  requestTimeoutMs: 10_000,
  connectionTimeoutMs: 10_000,
  commandTimeoutMs: 10_000,
});

await client.request("/v1/example", { timeoutMs: 5_000 });
const connection = await client.connect("/v1/rooms/room-1/ws", {
  timeoutMs: 5_000,
});
await connection.send("room.set_ready", { ready: true }, { timeoutMs: 5_000 });
```

正の有限数（上限 2,147,483,647）のみ有効で、`0`、負数、`NaN`、`Infinity`、
上限超過は `INVALID_PAYLOAD` です。期限切れは `TIMEOUT` になり、`requestId` が
ある場合は保持します。`AbortSignal` や `dispose()` による中止は `CANCELLED` です。
`TIMEOUT` が発生してもサーバー側処理は完了している可能性があるため、自動再送は
しません。処理結果が不明なら同じ `requestId` で確認します。

HTTP の期限は要求開始からトークン取得、`fetch`、本文受信・解析まで、WebSocket
接続の期限は接続開始からトークン取得と `open` 完了まで、コマンドの期限は `send`
から対応する成功・失敗応答までに適用します。期限切れ後に届いた応答や `open` は
処理済みの待機や接続を復活させません。コマンド一件の期限切れが他のコマンドや
接続を閉じることはありません。

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

Room の状態とイベントは次の API で購読できます。購読解除関数は何度呼び出しても
安全です。

```ts
const unsubscribeSnapshot = room.subscribe((snapshot) => {
  renderRoom(snapshot);
});
const unsubscribeEvent = room.on("room.snapshot", (event) => {
  console.log(event.revision);
});
const unsubscribeMessage = room.onMessage("chat.message", (message) => {
  showChat(message.payload.text);
});
const unsubscribeStatus = room.onStatusChange((status) => {
  // connecting / connected / reconnecting / disconnected
  showConnectionStatus(status);
});
```

`subscribe()` はリビジョンが進んだスナップショットだけを一度ずつ通知します。
同じイベントの再送、逆順、欠落は部分状態へ適用せず、再同期へ切り替えます。
購読者の例外は他の購読者や内部状態の更新へ影響しません。ゲーム固有メッセージの
名前と Payload は `createFlareLobbyClient<TApp>()` の `TApp` から型付けされます。

## マッチメイキング

プール ID、または `MatchmakingPool` を指定してチケットを作成します。作成直後から
サーバーが保持する状態、待機時間、現在の検索幅を読み取れます。

```ts
const ticket = await client.joinMatchmaking("ranked-1v1", {
  rating: 1500,
  inputMethod: "keyboard_mouse",
});

const unsubscribe = ticket.on("progress", (progress) => {
  renderQueue({
    state: progress.ticket.status,
    waitingTimeMs: progress.waitingTimeMs,
    searchRange: progress.searchRange,
    waitingCount: progress.waitingCount,
  });
});

const room = await ticket.waitForMatch();
unsubscribe();
```

`ticket.cancel()` はサーバーのキャンセル応答を受け取ってから状態を更新し、同じ
要求の再呼び出しは同じ終端状態へ収束します。待機を中止する場合は
`AbortSignal` とサーバー側キャンセルを連動できます。

```ts
const controller = new AbortController();
const ticket = await client.joinMatchmaking("ranked-1v1", {
  signal: controller.signal,
  reconnect: { maxAttempts: 5 },
});

const waiting = ticket.waitForMatch({ signal: controller.signal });
controller.abort();
await waiting; // 中止時は CANCELLED
```

作成と成立待機を一度に行う場合は `findMatch()` を使います。成立イベントを受信した
時点で、Client SDK は対戦 Room の参加トークンで WebSocket 接続し、初期スナップ
ショットを同期してから返します。チケットイベントの一時切断時は最後に受信した
イベント番号から履歴を再取得して再接続するため、既存チケットの状態を引き継げます。

`client.dispose()` と別名の `client.destroy()` はローカル終了です。保有中のマッチング
Ticket、`waitForMatch()` の待機、イベント購読、再接続タイマー、WebSocket を解放し、
待機中の Promise は `CANCELLED` で終了します。サーバー上の Ticket や、利用者へ渡された
対戦 Room は変更しません。サーバー上の Ticket も取り消す場合は、ローカル終了の前に
既存の `ticket.cancel()` を呼び出してください。

## パーティー

`createParty()` でパーティーを作成すると、作成者をリーダーとした接続済みの
`Party` ハンドルを返します。招待の受諾は `joinParty()`、既存パーティーへの再接続は
`getParty()` を使います。

```ts
const party = await client.createParty({ maxPartySize: 5 });
const invite = await party.invite("player-2");
// 招待された側:
const joined = await client.joinParty({
  partyId: party.id,
  token: invite.token,
});

const unsubscribe = party.on("update", (event) => {
  renderParty(event.snapshot);
});
```

操作メソッドはサーバーの成功応答を待ってから解決します。`leave()` は退出を要求し、
メンバーが 2 未満になった時点でサーバー側が自動解散します。リーダーだけが
`transferLeadership()` と `dissolve()` を実行できます。`dissolved` イベントを受信するか、
`leave()`・`dissolve()` が成功すると、ハンドルはイベント購読を終了し、以降の状態変更を
破棄します。

リーダーは `joinRankedQueue()` でパーティー単位のランクキューへ参加します。キュー投入中は
Party 側で構成変更が凍結され(`snapshot.queuedTicket`)、`cancelQueue()` でチケットを停止
します。キューの進捗と成立は `joinMatchmaking()` と同じ `MatchmakingTicket` ハンドルで
扱えます。単独での参加も `joinMatchmaking(pool, { partyId })` として利用できます。

### 再接続と状態復元

パーティーのイベント接続はリーダーに限らずメンバー全員が開けます。各イベントは完全な
Snapshot を運ぶため、履歴に欠落や逆順があっても最新 Snapshot へ一括で前進します。接続が
一時的に切断されると、指数バックオフと揺らぎを使って最大試行回数まで再接続し、その際に
最後に適用したイベント番号を `after` Query へ指定して、欠落分の履歴と Snapshot で状態を
復元します。再試行回数や待機時間は `reconnect` オプションで調整できます。

## WebSocket

```ts
const connection = await client.connect("/v1/rooms/room-1/ws", {
  knownEventTypes: ["room.snapshot"],
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

`connect` と `connection.send` は AbortSignal と `timeoutMs` を受け付けます。
`dispose()` は保有中の WebSocket、イベント購読、応答待機、期限タイマーを解放し、
以後の操作を `CANCELLED` として拒否します。

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

接続が一時的に切断されると、Room は指数バックオフと揺らぎを使って最大試行回数まで
再接続します。再接続時は最後に受信した `resumeToken` と `revision` を使うため、同じ
参加者状態を引き継げます。再試行不能な認証・権限エラー、明示的な `leave()` または
`close()` の後は再接続しません。待機時間や試行回数はクライアント初期化時または
Room 作成・参加時の `reconnect` オプションで調整できます。

## テスト用差し替え

`fetch`、`webSocket`、`webSocketFactory` を初期化設定へ渡すと、ブラウザ API を
テスト用実装へ差し替えられます。クライアントインスタンスごとに状態を保持する
ため、複数のクライアントを作成してもトークンや接続が共有されません。
