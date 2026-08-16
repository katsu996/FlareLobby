# 認証・認可・入力検証・利用制限

FlareLobby の Gateway Worker は、ヘルスチェックである `GET /` を除く要求を保護対象として扱います。後続の HTTP API と WebSocket 接続処理は、必ずここで定義する共通基盤を通してから Durable Object を呼び出してください。

## 認証主体の境界

利用者は `defineFlareLobby()` にサーバー側の `authenticate(request)` Hook を渡します。Hook は認証済みなら次の `Principal` を返し、認証できないときは `null` を返します。

```ts
authenticate: async (request) => {
  const accessToken = request.headers.get("authorization");
  const account = await verifyApplicationAccessToken(accessToken);

  return account === null
    ? null
    : {
        id: account.subjectId,
        playerId: account.gamePlayerId,
      };
};
```

`authenticateRequest()` は戻り値の `id` と `playerId` を空でない文字列として検証し、余分なプロパティを除いた読み取り専用の `Principal` に正規化します。HTTP 本文、Query、WebSocket Payload に含まれる `playerId` は本人確認へ使いません。認証 Hook の例外や不正な戻り値も、公開エラーの詳細を増やさず未認証として扱います。

認証後の `AuthenticatedGatewayRequest` には、`Principal` と `gatewayPrincipal` が入ります。後者は `FLARE_LOBBY_TOKEN_SECRET` で署名された 60 秒間だけ有効な内部証明です。Gateway から Room、Match Pool、利用制限 Durable Object へ渡す値は必ず `gatewayPrincipal` とし、DO 側では `resolveGatewayPrincipal()` または `consume()` が署名から主体を復元します。クライアント入力の識別子を DO へ渡してはいけません。

## 認可 Hook

認可は認証とは別です。`authorization` はホスト操作、参加、観戦、試合結果登録に対応する Hook を持ちます。Hook がない、`false` を返す、または例外を送出する場合は、すべて `FORBIDDEN` として拒否します。

```ts
authorization: {
  authorizeHostOperation: ({ principal, roomId }) =>
    roomId !== undefined && isRoomHost(principal.id, roomId),
  authorizeJoin: ({ principal, roomId }) =>
    roomId !== undefined && canJoinRoom(principal.id, roomId),
  authorizeSpectate: ({ principal, roomId }) =>
    roomId !== undefined && canSpectateRoom(principal.id, roomId),
  authorizeMatchResult: ({ principal, matchId }) =>
    matchId !== undefined && canRegisterMatchResult(principal.id, matchId)
}
```

ルート実装では、`authorizeGatewayOperation(authenticatedRequest, configuration.authorization, target)` を業務処理より先に呼びます。認可 Hook の引数に入る `principal` は Gateway の認証結果から固定されます。

試合結果登録では、本文からプレイヤー ID を受け付けません。`matchId` に紐付く成立済み Match Pool のチケットからサーバー側で参加者を確定し、`resultId` と結果値だけを受け取ります。認可 Hook が許可しない場合は D1 のレーティング処理へ進みません。

## 共通入力検証

HTTP 本文には `readValidatedJsonBody(request, maxBytes, validator)` を使います。`Content-Length` を早期に確認したうえで、ストリームから最大サイズまでだけ読み取ります。Query は `validateQuery(request, validator)`、WebSocket コマンドは `validateWebSocketCommand(message, maxBytes, validator)` を使います。後者はサイズ、UTF-8、JSON プロトコル v1、利用者の追加検証を順に適用します。

検証関数は型ガードとして書けます。

```ts
const roomInput = await readValidatedJsonBody(
  request,
  limits.maxHttpRequestBytes,
  (value): value is { title: string } =>
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string" &&
    value.title.length <= 80,
);
```

構文不正、UTF-8 不正、本文またはメッセージの上限超過は `INVALID_MESSAGE`、アプリケーション固有の構造検証失敗は `INVALID_PAYLOAD` です。内部例外、トークン、DO 識別子は応答へ含めません。

## 利用制限

`inputLimits` では HTTP 本文、WebSocket メッセージ、主体ごとのメッセージ回数、主体ごとのルーム作成回数を設定します。

```ts
inputLimits: {
  maxHttpRequestBytes: 16 * 1024,
  maxWebSocketMessageBytes: 8 * 1024,
  maxMessagesPerMinute: 60,
  maxRoomCreationsPerMinute: 10
}
```

WebSocket メッセージの直前に `consumeWebSocketMessageRateLimit()`、ルーム作成の直前に `consumeRoomCreationRateLimit()` を呼びます。どちらも認証済み `principal.id` をキーに `FLARE_LOBBY_RATE_LIMITS.getByName(principal.id)` を解決します。1 利用者ごとの Durable Object に状態を保存するため、全利用者を 1 個のグローバル Durable Object へ集約しません。上限超過は既存の安定した `CONFLICT` で返します。

## 参加用・再開用トークン

`issueJoinToken()` と `issueResumeToken()` は、主体、ルーム、用途、期限、推測困難な nonce を HMAC 署名した不透明な文字列を返します。検証時は必ず同じ用途と、現在の認証済み主体・ルームを渡してください。

```ts
const issued = await issueResumeToken(env.FLARE_LOBBY_TOKEN_SECRET, {
  principal: authenticatedRequest.principal,
  roomId,
  expiresAt: Date.now() + 10 * 60 * 1000,
});

const verified = await verifyResumeToken(env.FLARE_LOBBY_TOKEN_SECRET, token, {
  principal: authenticatedRequest.principal,
  roomId,
});
```

発行・検証は `ProtocolResult` を返します。期限切れ、用途違い、署名改ざん、別主体、別ルームのトークンはすべて `UNAUTHENTICATED` として拒否します。トークンの内容をエラー文へ反映してはいけません。

## 秘密値と運用上の前提

- `FLARE_LOBBY_TOKEN_SECRET` は Wrangler Secret として環境ごとに設定し、ソース、設定ファイル、ログへ書かない。
- 十分なランダム性を持つ独立した値を使用する。値をローテーションすると、旧値で署名された参加用・再開用・内部証明トークンは無効になる。
- `authenticate()` はアプリケーションの認証情報を完全に検証し、主体 ID を信頼できるサーバー側のデータから決定する。
- 後続 Issue のすべての保護操作は、認証、入力検証、利用制限、認可をこの順で通過してから DO を呼び出す。
- この基盤は高度な Bot 判定、特定の ID プロバイダー、汎用チート対策を実装しない。必要な場合は設計の正本 #1 へ影響範囲を提案する。

自動テストでは、未認証、クライアント申告 ID の無効化、DO 境界の改ざん、権限不足、本文・WebSocket の上限超過、トークンの改ざん・期限切れ・用途違い・別主体利用、メッセージ頻度とルーム作成頻度の超過を確認しています。
