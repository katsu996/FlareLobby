# APIリファレンス

このページは、各パッケージの `src/index.ts` が公開する v0.1.0 の API を、利用者
向けの引数・戻り値・イベント・エラーコードと一緒にまとめたものです。実装の型宣言
を正本とし、文書のコード例は `pnpm check:docs` で型検査します。

## 共通規約

- JSON 境界へ渡す設定、メタデータ、Payload は `JsonValue` として直列化可能にする。
- ネットワーク操作は `Promise` を返し、Client SDK では失敗を `FlareLobbyError` として通知する。
- 低レベルの core/cloudflare 関数は、例外を投げる API と `ProtocolResult<T>` を返す API を型宣言どおりに使い分ける。
- `code` は機械判定、`message` は安全な表示用とし、文言で分岐しない。
- Room の `snapshot`、参加者、設定、メタデータは読み取り専用である。
- `requestId` または `Idempotency-Key` を再送する場合、コマンドと Payload を変更しない。

## `@flarelobby/core`

### ドメイン型

| 型                                                                                                                   | 内容                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `JsonPrimitive` / `JsonObject` / `JsonValue`                                                                         | JSON のプリミティブ、オブジェクト、再帰的な値                              |
| `ReadonlyDeep<T>`                                                                                                    | 設定・Snapshot・Payload を深く読み取り専用にする型                         |
| `Timestamp`                                                                                                          | ISO 8601 UTC 文字列                                                        |
| `Revision`                                                                                                           | Room 状態変更ごとに増加する数値                                            |
| `Player` / `Principal`                                                                                               | プレイヤー ID / サーバー認証主体（`id`、`playerId`）                       |
| `Team` / `PlayerParticipant` / `Spectator` / `Participant`                                                           | チーム、プレイヤー参加者、観戦者、判別可能な参加者 Union                   |
| `Host`                                                                                                               | `participantId` と `playerId` を持つホスト                                 |
| `FlareLobbyApp`                                                                                                      | `room.settings`、`room.metadata`、`room.messages` をゲーム型へ束縛する契約 |
| `AnyFlareLobbyApp` / `AppRoomSettings` / `AppRoomMetadata` / `AppGameMessages`                                       | アプリ型の既定形と各型引数の抽出                                           |
| `CustomRoom` / `MatchRoom` / `Room`                                                                                  | `kind: "custom"` または `kind: "match"` の Room 情報                       |
| `RoomStatus` / `WaitingRoomState` / `PreparingRoomState` / `InProgressRoomState` / `FinishedRoomState` / `RoomState` | Room の状態と状態別必須時刻                                                |
| `RoomSnapshotBase` / `CustomRoomSnapshot` / `MatchRoomSnapshot` / `RoomSnapshot`                                     | `revision`、状態、参加者、チーム、Room 固有情報を持つ Snapshot             |
| `MatchmakingPool`                                                                                                    | `id`、`gameId`、`seasonId`、`mode`、`region` の Pool 識別情報              |
| `Rating`                                                                                                             | `playerId`、`poolId`、`value` の現在値                                     |
| `MatchCandidate` / `MatchResult`                                                                                     | 2 チケットの候補と成立した対戦 Room                                        |
| `MatchmakingTicketStatus`                                                                                            | `creating`、`waiting`、`reserved`、`matched`、`cancelled`、`expired`       |
| `MatchmakingTicketBase` と状態別 Ticket 型                                                                           | 共通 ID/Pool/Player/Rating/時刻と状態固有フィールド                        |
| `GameMessageName<TApp>` / `GameMessagePayload<TApp, TName>` / `GameMessage<TApp>`                                    | ゲーム固有メッセージ名と Payload の型対応                                  |
| `InferFlareLobbyApp<TPublicType>`                                                                                    | 公開型へ束縛されたアプリ型を取り出す型                                     |

ID の別名は `PlayerId`、`PrincipalId`、`RoomId`、`InvitationCode`、`ParticipantId`、
`TeamId`、`MatchmakingPoolId`、`MatchmakingTicketId`、`MatchCandidateId`、`MatchId`、
`GameId`、`SeasonId`、`MatchMode`、`Region` です。実体は文字列ですが、識別子の意味を
取り違えないために API 型で使い分けます。

### マッチング候補探索

| API                                                             | 引数                                             | 戻り値と動作                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `normalizeMatchmakingSearchPolicy(input?)`                      | `MatchmakingSearchPolicy` または未知値           | `NormalizedMatchmakingSearchPolicy`。別名項目と既定値を正規化し、不正値は `TypeError`/`RangeError` |
| `getMatchmakingSearchWidth(policy, waitingTimeMs)`              | Policy、待機時間 ms                              | 現在のレート検索幅。段階境界は新しい段階を使う                                                     |
| `getNextMatchmakingSearchAt(policy, queuedAt, now)`             | Policy、開始時刻、現在 ms                        | 次の段階の epoch ms、最終段階後は `null`                                                           |
| `evaluateMatchCandidate(first, second, options)`                | 2 `MatchmakingSearchTicket`、`now` と任意 Policy | 成立可能なら `MatchmakingCandidateEvaluation`、Pool/リージョン/幅外などは `null`                   |
| `selectMatchCandidates(tickets, options)`                       | Ticket 配列、`now`、任意上限                     | 品質順に選んだ候補配列。1 チケットを複数候補へ選ばない                                             |
| `findBestMatchCandidate(tickets, options)`                      | Ticket 配列、検索オプション                      | 最良の候補評価または `null`                                                                        |
| `compareMatchCandidateQuality(left, right)`                     | 2 `MatchmakingCandidateQuality`                  | 品質順の比較数値                                                                                   |
| `evaluateMatchmakingCandidate` / `findBestMatchmakingCandidate` | 上記関数の別名                                   | 同じ引数・戻り値                                                                                   |

検索 Policy の既定は `DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES`（`0 → 75`、
`20_000 → 150`、`60_000 → 400`）、`DEFAULT_MATCHMAKING_MAX_TICKETS_PER_SEARCH`
（256）、`DEFAULT_MATCHMAKING_MAX_CANDIDATES_PER_SEARCH`（8192）、
`DEFAULT_MATCHMAKING_MAX_MATCHES_PER_SEARCH`（32）です。

### ELO

| API                          | 引数                                                 | 戻り値                                                                        |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `elo(options?)`              | `initialRating?`（既定 1500）、`kFactor?`（既定 24） | `EloEngine`。`initialRating`、`kFactor`、`calculate()` を持つ凍結オブジェクト |
| `EloEngine.calculate(input)` | `ratingA`、`ratingB`、A 側 `result`（`0`/`0.5`/`1`） | `EloCalculation`。期待勝率、未丸め差分、整数差分、更新前後値、両側スコア      |

`DEFAULT_ELO_INITIAL_RATING` と `DEFAULT_ELO_K_FACTOR` はそれぞれ `1500` と `24`
です。レーティング入力は 0 以上の有限数、K 係数は正の有限数でなければなりません。

### JSON 通信プロトコル

`PROTOCOL_VERSION` は `1` です。`ClientCommandEnvelope` は
`protocolVersion`、`kind: "command"`、`requestId`、`command`、`payload`、成功応答は
`requestId` と `payload`、失敗応答は `requestId` と `error`、イベントは `event`、
`revision`、`payload` を持ちます。

| API                                                  | 引数                           | 戻り値                                        |
| ---------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| `isDuplicateRequest(first, second)`                  | 2 コマンドの `requestId`       | 同じ ID なら `true`                           |
| `classifyEventRevision(lastRevision, eventRevision)` | 受信済み版とイベント版         | `next` / `duplicate` / `gap` / `out_of_order` |
| `validateProtocolMessage(input, options?)`           | 未知値、任意 `knownEventTypes` | `ProtocolResult<ProtocolMessage>`             |
| `decodeProtocolMessage(encoded, options?)`           | JSON 文字列、任意検証          | `ProtocolResult<ProtocolMessage>`             |
| `decodeClientCommand(encoded)`                       | JSON 文字列                    | `ProtocolResult<ClientCommandEnvelope>`       |
| `decodeServerMessage(encoded, options?)`             | JSON 文字列、任意検証          | `ProtocolResult<ServerMessage>`               |
| `encodeProtocolMessage(message, options?)`           | Protocol Message、任意検証     | `ProtocolResult<string>`                      |
| `isFlareLobbyErrorCode(value)`                       | 未知値                         | 安定エラーコードかどうか                      |

`ProtocolResult<T>` は `{ ok: true, value }` または `{ ok: false, error:
FlareLobbyError }` です。`FlareLobbyError` の constructor は
`(code, options?: { message?: string; requestId?: string })`、公開プロパティは
`code`、`requestId`、`message`、`toJSON()` は安全な `{ code, message }`、
`FlareLobbyError.fromPayload(payload, requestId?)` は通信エラーから公開例外を作ります。

## `@flarelobby/client`

### Client 本体

| API                                                   | 引数                                                                                               | 戻り値                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `createFlareLobbyClient<TApp>(options)`               | `endpoint`、`getAccessToken`、任意 `fetch`/WebSocket 差し替え、`requestIdFactory`、再接続設定      | `FlareLobbyClient<TApp>`                     |
| `client.request<T>(path, options?)`                   | HTTP path、method、JSON `body`、headers、`signal`、`idempotent`、`requestId`                       | `Promise<T>`                                 |
| `client.connect(path, options?)` / `connectWebSocket` | WebSocket path、`signal`、protocols、`knownEventTypes`、`lastRevision`                             | `Promise<FlareLobbyWebSocketConnection>`     |
| `client.createCustomRoom(options?)`                   | `name/title`、visibility/listing、joinMethod/joinMode、人数、password、settings、signal、reconnect | `Promise<HostRoom<TApp>>`                    |
| `client.joinCustomRoom(code)`                         | 招待コードまたは Room ID の文字列                                                                  | `Promise<PlayerRoom<TApp>>`                  |
| `client.joinCustomRoom(options)`                      | `roomId` または `invitationCode/code`、role、password、signal、reconnect                           | `Promise<PlayerRoom                          | SpectatorRoom>` |
| `client.listCustomRooms(query?)`                      | Pool/Room 条件、available、limit、cursor、signal                                                   | `Promise<CustomRoomListPage>`                |
| `client.joinMatchmaking(pool, options?)`              | Pool ID/Pool、rating、region、inputMethod、検索属性、期限、signal、reconnect                       | `Promise<MatchmakingTicket>`                 |
| `client.findMatch(pool, options?)`                    | `joinMatchmaking` と同じ                                                                           | `Promise<PlayerRoom<TApp>>`                  |
| `client.getRating(pool, options?)`                    | Pool ID/Pool、signal                                                                               | `Promise<Rating>`                            |
| `client.dispose()` / `destroy()`                      | なし                                                                                               | `void`。接続と購読を解放し以後は `CANCELLED` |

`ClientRequestOptions` は `method?`、`headers?`、JSON `body?`、`signal?`、
`idempotent?`、`requestId?`、`ClientWebSocketOptions` は `signal?`、protocols、
`knownEventTypes?`、`lastRevision?`、`ClientCommandOptions` は `signal?`、`requestId?`
です。`FlareLobbyWebSocketConnection` は `closed`、`send(command, payload, options?)`
（`Promise<T>`）、`onEvent()`、`onClose()`、`close()` を提供します。

### Room ハンドル

| 型/メソッド                                      | 引数                                            | 戻り値・権限                                                 |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| `RoomSubscriptionApi.connectionStatus`           | なし                                            | `connecting` / `connected` / `reconnecting` / `disconnected` |
| `subscribe(listener)`                            | `(snapshot: RoomSnapshot) => void`              | 解除関数                                                     |
| `on(eventName, listener)`                        | Protocol event と listener                      | 解除関数                                                     |
| `onMessage(messageName, listener)`               | 型付きゲームメッセージと listener               | 解除関数                                                     |
| `onStatusChange(listener)`                       | 接続状態 listener                               | 解除関数                                                     |
| `PlayerRoom.setReady(ready, options?)`           | boolean、request/signal                         | `Promise<RoomSnapshot>`                                      |
| `PlayerRoom.selectTeam(teamId, options?)`        | Team ID または `null`                           | `Promise<RoomSnapshot>`                                      |
| `PlayerRoom.send(name, payload, options?)`       | 型付きメッセージ                                | `Promise<void>`                                              |
| `PlayerRoom.leave(options?)`                     | request/signal                                  | `Promise<RoomSnapshot>`                                      |
| `HostRoom.updateSettings(settings, options?)`    | App 設定、request/signal                        | `Promise<RoomSnapshot>`。ホストのみ                          |
| `HostRoom.transferHost(participantId, options?)` | 移譲先                                          | `Promise<RoomSnapshot>`。ホストのみ                          |
| `HostRoom.kick(target, options?)`                | participant/player ID または reason 付き target | `Promise<RoomSnapshot>`。ホストのみ                          |
| `HostRoom.startMatch(options?)`                  | 任意 `at`、request/signal                       | `Promise<RoomSnapshot>`。開始条件を検証                      |
| `HostRoom.close(options?)`                       | 任意 `at`、request/signal                       | `Promise<RoomSnapshot>`。`finished` へ遷移                   |
| `SpectatorRoom.leave(options?)`                  | request/signal                                  | `Promise<RoomSnapshot>`。プレイヤー操作は持たない            |

`RoomReconnectOptions` は `maxAttempts?`、`baseDelayMs?`、`maxDelayMs?`、`jitterRatio?`
です。`RoomGameMessage` は `name`、型付き `payload`、任意 `sender`（participantId/role）、
`revision` を持ちます。Room のエイリアス `RoomOperationOptions`、
`RoomStateOperationOptions`、`RoomKickTarget` も同じ契約で利用できます。

### マッチング Ticket

`MatchmakingJoinOptions` は `requestId?`、`rating?`（数値または `{ value }`）、
`region?`、`inputMethod?/inputMode?`、`searchAttributes?`、`expiresAt?`、`ttlMs?`、
`signal?`、`reconnect?` です。

| API                                                         | 引数                           | 戻り値                                    |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| `ticket.snapshot` / `ticket.ticket`                         | なし                           | サーバーの `MatchmakingTicketSnapshot`    |
| `ticket.status` / `state` / `waitingTimeMs` / `searchWidth` | なし                           | Snapshot 由来の読み取り専用ショートカット |
| `ticket.on("progress", listener)`                           | `MatchmakingProgress` listener | 解除関数                                  |
| `ticket.onStatusChange(listener)`                           | 接続状態 listener              | 解除関数                                  |
| `ticket.refresh(options?)`                                  | signal                         | `Promise<MatchmakingTicketSnapshot>`      |
| `ticket.cancel(options?)`                                   | `requestId?`、signal           | `Promise<MatchmakingTicketSnapshot>`      |
| `ticket.waitForMatch(options?)`                             | signal                         | `Promise<PlayerRoom<TApp>>`。成立まで待つ |

`MatchmakingProgress` は `ticket`、`waitingCount`、`activeCount`、`waitingTimeMs`、
`searchWidth/searchRange`、`sequence`、`occurredAt` を持ちます。イベント名は現在
`progress`、接続状態は Room と同じ 4 値です。

## `@flarelobby/cloudflare`

### Gateway 設定

`defineFlareLobby<TApp>(configuration)` は入力を検証した `DefinedFlareLobby` を返し、
`createGatewayWorker<TEnv>()` で Wrangler 生成の `Env` に対応する Worker を作ります。
`createGatewayWorker(configuration)` は同じ Worker を直接作る関数です。

| 設定               | 必須項目・既定値                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customRooms`      | `maxPlayers`、`defaultSettings`。`maxSpectators` の既定は 0、再開 TTL 30 分、切断猶予 30 秒、履歴 128 件、処理済み結果 10 分、終了 Room 保持 24 時間 |
| `matchmakingPools` | `id`、`gameId`、`seasonId`、`mode`、`region`。任意 `searchPolicy`、`matchRoom`、`rating`                                                             |
| `authenticate`     | `Request → Principal/null/Promise`。失敗・不正値は未認証                                                                                             |
| `authorization`    | `authorizeHostOperation`、`authorizeJoin`、`authorizeSpectate`、`authorizeMatchResult`。未設定/false/例外は拒否                                      |
| `inputLimits`      | `maxHttpRequestBytes`、`maxWebSocketMessageBytes`、`maxMessagesPerMinute`、`maxRoomCreationsPerMinute`                                               |
| `observability`    | `logSampleRate?`、`analyticsSampleRate?`。既定は 1                                                                                                   |

必須 Binding は `FLARE_LOBBY_ROOMS`、`FLARE_LOBBY_MATCH_POOLS`、
`FLARE_LOBBY_RATE_LIMITS`、`FLARE_LOBBY_DB`、`FLARE_LOBBY_TOKEN_SECRET` です。
`FLARE_LOBBY_ANALYTICS` は任意です。設定不備は `FlareLobbyConfigurationError` と
`FLARE_LOBBY_CONFIGURATION_ERROR_CODES`（`D1_BINDING_MISSING`、
`ROOM_DURABLE_OBJECT_BINDING_MISSING`、`MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING`、
`TOKEN_SECRET_MISSING`、
`INVALID_CUSTOM_ROOM_CONFIGURATION`、`INVALID_MATCHMAKING_POOL`、
`INVALID_INPUT_LIMITS`、`INVALID_AUTHENTICATION_HOOK`、
`INVALID_OBSERVABILITY_CONFIGURATION`）で判定します。

### Gateway HTTP/WebSocket API

| Method / Path                                                  | 認証                  | 入力                                                                                        | 成功結果                         |
| -------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| `GET /`                                                        | 不要                  | なし                                                                                        | `{ status: "ready" }`            |
| `GET /v1/custom-rooms`                                         | 不要                  | `mode`、`region`、`state/status`、`available`、`availableSlots`、`limit/pageSize`、`cursor` | `{ rooms, nextCursor }`          |
| `POST /v1/custom-rooms`                                        | 必須                  | `CustomRoomCreationInput`                                                                   | `201 + CustomRoomCreationResult` |
| `POST /v1/custom-rooms/join` または `/{roomId-or-code}/join`   | 必須                  | `roomId`/`invitationCode`、role、password、requestId                                        | `CustomRoomJoinResult`           |
| `POST /v1/custom-rooms/leave` または `/{roomId}/leave`         | 必須                  | roomId、joinToken/token、participantId、role、requestId                                     | `CustomRoomLeaveResult`          |
| `GET /v1/custom-rooms/{roomId}/ws`                             | WebSocket subprotocol | `flarelobby.v1` と auth subprotocol                                                         | `room.snapshot` と後続イベント   |
| `POST /v1/matchmaking/pools/{poolId}/tickets`                  | 必須                  | rating、region、inputMethod、検索属性、期限、requestId                                      | `201 + { ticket }`               |
| `GET /v1/matchmaking/pools/{poolId}/tickets/{ticketId}`        | 所有者                | なし                                                                                        | `{ ticket }`                     |
| `POST` または `DELETE /v1/.../tickets/{ticketId}/cancel`       | 所有者                | requestId（POST）                                                                           | `{ ticket }`                     |
| `GET /v1/.../tickets/{ticketId}/events`                        | 所有者                | `afterSequence?`                                                                            | `{ events }`                     |
| `GET /v1/.../tickets/{ticketId}/events/ws`                     | Ticket 所有者         | WebSocket                                                                                   | `matchmaking.ticket` イベント    |
| `GET /v1/.../tickets/{ticketId}/connection`                    | 所有者、matched のみ  | なし                                                                                        | `{ ticket, connection }`         |
| `GET /v1/matchmaking/pools/{poolId}/rating`                    | 必須                  | なし                                                                                        | `{ rating }`                     |
| `POST /v1/matchmaking/pools/{poolId}/matches/{matchId}/result` | 認可 Hook             | `resultId`、A 側 `result`                                                                   | `{ match, applied }`             |

エンドポイントの `poolId`、`roomId`、`ticketId`、`matchId` は URL エンコードします。
一覧は D1 の投影で一時的に古くなるため、参加の定員・状態は Room Durable Object が
再判定します。WebSocket の token は URL や Query へ入れません。

### カスタムルーム関数・型

| API                                                                   | 引数                                         | 戻り値                                              |
| --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `createCustomRoom(request, env, configuration, authenticatedRequest)` | Gateway 内部の Request/Binding/設定/認証結果 | `Promise<ProtocolResult<CustomRoomCreationResult>>` |
| `joinCustomRoom(...)`                                                 | 同上                                         | `Promise<ProtocolResult<CustomRoomJoinResult>>`     |
| `leaveCustomRoom(...)`                                                | 同上                                         | `Promise<ProtocolResult<CustomRoomLeaveResult>>`    |
| `listCustomRooms(request, env, configuration)`                        | 公開一覧 Request/Binding/設定                | `Promise<ProtocolResult<CustomRoomListResult>>`     |

`CustomRoomCreationInput` は `requestId?`、`name/title?`、`visibility/listing?`、
`joinMethod/joinMode?`、`maxPlayers?`、`maxSpectators?`、`password?`、`settings?`。
作成結果は `roomId`、`participantId?`、`role?`、`joinMethod`、`invitationCode`、
`joinToken`、`websocketUrl`、`snapshot`。参加結果は `roomId`、`participantId`、
`role`、`joinToken`、`websocketUrl`、`snapshot`。退出結果は `roomId`、
`participantId`、`role`、`snapshot` です。

### Match Pool Durable Object

キー生成関数は `createMatchmakingPoolKey(pool)`（別名
`getMatchmakingPoolKey`、`createMatchPoolKey`、`getMatchPoolName`）、
`createMatchmakingMatchId(candidateId)`、`createMatchmakingRoomId(matchId)` です。
`MATCHMAKING_POOL_KEY_SEPARATOR` は `":"`、既定 TTL は 60 秒、成立再試行は初回 1 秒、
上限 60 秒、最大 8 回、チームは `["blue", "red"]` です。

| メソッド                                                         | 引数                                                 | 戻り値                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `initialize` / `initializePool`                                  | Pool または `MatchPoolInitializationOptions`         | `Promise<MatchmakingPool>`                |
| `getPool` / `getSearchPolicy` / `getSnapshot`                    | なし                                                 | Pool、正規化 Policy、または Snapshot/null |
| `configureSearchPolicy` / `configureMatchmakingSearch`           | Search Policy                                        | 正規化 Policy                             |
| `searchCandidates` / `findCandidates`                            | `now?`、観測情報                                     | 状態を変えない `MatchmakingSearchResult`  |
| `searchAndReserveCandidates` / `findAndReserveCandidates`        | 同上                                                 | 候補を `reserved` へ進めた Search Result  |
| `getMatchIntent`                                                 | matchId/candidateId または object                    | 成立意図/null                             |
| `processPendingMatches` / `settleMatches` / `processMatchmaking` | `now?`、`maxMatches?`、観測                          | 成立意図配列                              |
| `createTicket` / `createMatchmakingTicket`                       | 主体、requestId、rating、任意 Pool/region/input/期限 | `MatchmakingTicketRecord`                 |
| `getTicket` / `getMatchmakingTicket`                             | ticketId または `{ ticketId }`                       | Record/null                               |
| `getTicketForPrincipal` / `getActiveTicket`                      | Gateway Principal                                    | 所有者の有効 Ticket/null                  |
| `cancelTicket` / `cancelMatchmakingTicket`                       | 主体、ticketId、requestId/payload                    | Cancelled または既存終端 Record           |
| `reserveCandidate` / `reserveTickets` / `reserveTicket`          | Candidate                                            | 2 Record または先頭 1 Record              |
| `matchCandidate` / `matchTickets`                                | 成立結果                                             | 2 つの matched Record                     |
| `expireTicket` / `expireDueTickets`                              | ticketId/任意 now、または now                        | 期限切れ Record/配列                      |
| `getNextAlarm`                                                   | なし                                                 | epoch ms/null                             |
| `getTicketEvents` / `listTicketEvents`                           | 主体、ticketId、`afterSequence?`                     | Ticket Event 配列                         |

`MatchmakingTicketRecord` は core の状態別 Ticket に、`region`、`inputMethod`、
`searchAttributes`、`expiresAt`、`expiresAtMs` を加えた型です。`MatchmakingMatchIntent`
は `pending`、`initializing`、`matched`、`failed` と試行回数・結果・エラーコードを
持ちます。Durable Object の `fetch`、`webSocketMessage`、`alarm` は低レベルの
イベント入口です。

### D1 レーティング

| API                                                                       | 引数                                                     | 戻り値                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `ensureRatingSchema(database)`                                            | D1                                                       | `Promise<void>`。Schema を冪等に作成  |
| `getRating(database, pool, playerId, configuration?)` / `getPlayerRating` | D1、Pool、Player、ELO 設定                               | `Promise<Rating>`。初回は初期値を保存 |
| `registerMatchResult(database, pool, input, configuration?, maxRetries?)` | D1、Pool、`resultId`、`matchId`、A/B player、A 側 result | `Promise<MatchResultRegistration>`    |
| `recordMatchResult` / `applyMatchResult`                                  | 上記の別名                                               | 同じ                                  |
| `listMatchHistory(database, query)` / `getMatchHistory`                   | Pool、任意 player、cursor、limit/pageSize（最大 100）    | `Promise<MatchHistoryPage>`           |

`MatchResultRegistration` は `match` と `applied` を返します。`applied: false` は同じ
結果の再送です。Gateway の公開結果 API では A/B ID を本文から採用しません。

### Security / token

| API                                                                                    | 引数                                                   | 戻り値                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `normalizePrincipal(value)`                                                            | Hook 戻り値                                            | 正規化 `Principal` または null                       |
| `authenticateRequest(request, authenticate)`                                           | Request、認証 Hook                                     | `Promise<Principal                                   | null>` |
| `authenticateGatewayRequest(request, authenticate, tokenSecret, now?)`                 | Request/Hook/Secret/時刻                               | `ProtocolResult<AuthenticatedGatewayRequest>`        |
| `authorizeGatewayOperation(request, authorization, target)`                            | 認証結果、Hook、操作対象                               | `Promise<ProtocolResult<void>>`                      |
| `readValidatedJsonBody(request, maxBytes, validator)`                                  | Request、byte 上限、type guard                         | `Promise<ProtocolResult<T>>`                         |
| `validateQuery(request, validator)`                                                    | Request、type guard                                    | `ProtocolResult<T>`                                  |
| `validateWebSocketCommand(message, maxBytes, validator?)`                              | string/ArrayBuffer、上限、任意 validator               | `ProtocolResult<ClientCommandEnvelope>`              |
| `readWebSocketJoinToken(request)`                                                      | Upgrade Request                                        | token の `ProtocolResult<string>`                    |
| `issueJoinToken` / `issueResumeToken`                                                  | Secret、主体、roomId、role、participant、期限          | `Promise<ProtocolResult<string>>`                    |
| `verifyJoinToken` / `verifyResumeToken`                                                | Secret、token、主体、roomId、任意 role/participant/now | `Promise<ProtocolResult<FlareLobbyRoomTokenClaims>>` |
| `verifyWebSocketJoinToken` / `verifyWebSocketResumeToken` / `verifyWebSocketRoomToken` | Secret、token、Room/role 条件                          | 同上                                                 |
| `createGatewayPrincipalEnvelope`                                                       | Secret、Principal、now?                                | `Promise<ProtocolResult<GatewayPrincipalEnvelope>>`  |
| `verifyGatewayPrincipalEnvelope`                                                       | Secret、内部 envelope、now?                            | `Promise<Principal                                   | null>` |
| `createErrorResponse(error)`                                                           | `FlareLobbyError`                                      | 安全な HTTP Response                                 |

`FLARE_LOBBY_WEBSOCKET_PROTOCOL` は `flarelobby.v1`、認証 subprotocol の接頭辞は
`flarelobby.auth.`、Rate Limit の Scope は `websocket_message` と `room_creation`
です。認証 Hook の結果、token の claims、`GatewayPrincipalEnvelope`、認可 Hook の
型は Export 一覧に含まれます。

### Observability

`createObservabilityContext(request?, options?)` は相関 ID、要求 ID、ログ/Analytics
の sampled 状態を作ります。`withObservabilityRequestId`、`attachObservabilityHeaders`、
`readObservabilityContext`、`createObservabilitySink(analytics, configuration?, logger?)`、
`observeOperation`、`observeHttpOperation`、`recordQualityMetric`、
`getObservabilityOperationName`、`getObservabilityErrorCode` が公開関数です。

設定は `logSampleRate?` と `analyticsSampleRate?`（0〜1）です。安全なログレコードは
`schemaVersion`、`event`、時刻、level、correlation/request ID、operation、duration、
result、任意の errorCode/stage/低カーディナリティ attributes を持ちます。token、
主体/プレイヤー ID、Room ID、本文、ゲーム Payload、スタックトレースは渡しません。
メトリクス名は `match_wait_time_ms`、`match_rating_difference`、`match_search_width`、
`match_cancelled`、`match_succeeded`、`match_outcome` です。

### Durable Object の公開 RPC

`RoomDurableObject` は `initialize`、`getSnapshot/getRoomSnapshot`、`join/joinParticipant`、
`leave/leaveParticipant`、`disconnect`、`setReady`、`selectTeam`、`updateSettings`、
`transferHost`、`kick`、`startMatch`、`close/closeRoom`、`transition/transitionState`、
`scheduleOperation/scheduleDeadline`、`cancelScheduledOperation`、
`listScheduledOperations`、`getNextAlarm`、`recordProcessedCommand`、
`getProcessedCommand`、`resolveGatewayPrincipal` を提供します。各操作の入力型は
`RoomInitializationOptions`、`RoomParticipantJoinOptions`、`RoomParticipantLeaveOptions`、
`RoomParticipantDisconnectOptions`、`RoomSetReadyOptions`、`RoomSelectTeamOptions`、
`RoomUpdateSettingsOptions`、`RoomTransferHostOptions`、`RoomKickOptions`、
`RoomStartMatchOptions`、`RoomCloseOptions`、`RoomStateTransitionOptions`、
`RoomScheduledOperationOptions`、`RoomProcessedCommandOptions` です。

Room の既定値は `DEFAULT_DISCONNECT_GRACE_PERIOD_MS`、`DEFAULT_EVENT_HISTORY_LIMIT`、
`DEFAULT_FINISHED_ROOM_RETENTION_MS`、`DEFAULT_PROCESSED_COMMAND_RETENTION_MS`、
`DEFAULT_RESUME_TOKEN_TTL_MS` です。`getRoomWebSocketTag`、
`getParticipantWebSocketTag`、`getPrincipalWebSocketTag`、`getRoleWebSocketTag`、
`getResumeWebSocketTag` は Hibernation WebSocket の検索タグを作ります。

`MatchPoolDurableObject` の公開メソッド、`RateLimitDurableObject` の `consume`、
`RoomDurableObject` の `fetch`/`webSocketMessage`/`webSocketClose`/`webSocketError`/
`alarm` は上記の型と同じ永続境界で動作します。直接 RPC を使う場合もクライアント
申告 ID ではなく `GatewayPrincipalEnvelope` を渡してください。

## `@flarelobby/testing`

| API                                                                            | 引数                                                                   | 戻り値                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `VirtualClock` / `createVirtualClock(initialTime?)`                            | epoch ms または Timestamp                                              | `now`、`nowTimestamp`、`advanceBy`、`advanceTo` を持つ仮想時計 |
| `toEpochMilliseconds(value)` / `addMilliseconds(left, right)`                  | 時刻/ミリ秒                                                            | epoch ms または Timestamp                                      |
| `SeededRandom` / `createSeededRandom(seed)`                                    | string または安全な整数                                                | `next`、`nextInt`、`chance`。アルゴリズム `mulberry32-v1`      |
| `normalizePlayerGenerationOptions`                                             | 生成数、ID prefix、rating/joinedAt 分布、region、inputMethod           | 正規化設定                                                     |
| `generateSimulationPlayers`                                                    | 生成設定、RandomSource                                                 | SimulationPlayer 配列                                          |
| `normalizeSimulationPlayers`                                                   | 固定 Player 配列                                                       | 検証・順序安定化済み配列                                       |
| `normalizeNumericDistribution` / `sampleNumericDistribution`                   | fixed/uniform/normal 分布、乱数                                        | 正規化分布/数値                                                |
| `normalizeTimestampDistribution` / `sampleTimestampDistribution`               | fixed/uniform 時刻分布、乱数                                           | 正規化分布/epoch ms                                            |
| `simulateMatchmaking`                                                          | seed、players または playerGeneration、期間、tick、TTL、Policy、cancel | `MatchmakingSimulationResult`                                  |
| `replaySimulation(replay)`                                                     | 結果の `replay`                                                        | 同じ結果を再実行                                               |
| `compareSearchPolicies(config, first, second)`                                 | 同じ seed の設定と 2 Policy                                            | `SimulationPolicyComparison`。差分は second - first            |
| `serializeSimulationResult` / `summarizeSimulation` / `formatSimulationOutput` | Simulation Result                                                      | JSON、短い日本語要約、または両方                               |

シミュレーションの状態は `not_joined`、`waiting`、`matched`、`cancelled`、`expired`、
イベントは `joined`、`cancelled`、`expired`、`matched` です。結果には replay、全
チケット、全イベント、成立候補、待機時間・レート差の分布統計が含まれます。

## エラーコード

### 通信・操作エラー

| コード                         | 意味                                                          | 対処                                                             |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `CONNECTION_FAILED`            | HTTP/WebSocket/DO/D1 との一時的な通信失敗                     | 有界な再試行。処理結果が不明なら同じ requestId で確認            |
| `UNAUTHENTICATED`              | 認証がない、期限切れ、署名不正                                | token を更新して再認証。ID を本文で補わない                      |
| `FORBIDDEN`                    | 認証済みだが Room/Pool/結果登録の権限がない                   | 認可設定と対象役割を確認                                         |
| `ROOM_FULL`                    | プレイヤーまたは観戦者の枠がない                              | 一覧を信頼せず、空きができてから再参加                           |
| `ROOM_FINISHED`                | 終了済み Room への操作                                        | 新しい Room または新しい成立結果を使う                           |
| `CONFLICT`                     | 現在状態、重複、requestId の Payload、rate limit などとの競合 | Snapshot/状態を再取得。Payload を変えた requestId は再利用しない |
| `CANCELLED`                    | AbortSignal、明示取消、dispose で中止                         | 必要なら新しい要求を作る                                         |
| `INVALID_MESSAGE`              | JSON/Envelope/必須項目/サイズ/メッセージ種別が不正            | 型と Protocol v1、入力上限を確認                                 |
| `INVALID_PAYLOAD`              | JSON は読めるが業務 Payload の型・値が不正                    | API の入力型、必須条件、値域を確認                               |
| `UNSUPPORTED_PROTOCOL_VERSION` | 対応していない Protocol version                               | `PROTOCOL_VERSION` に合わせる                                    |
| `UNKNOWN_EVENT`                | `knownEventTypes` にないイベント                              | イベント登録とサーバー版を合わせる                               |

### Gateway 設定エラー

`D1_BINDING_MISSING`、`ROOM_DURABLE_OBJECT_BINDING_MISSING`、
`MATCH_POOL_DURABLE_OBJECT_BINDING_MISSING`、`TOKEN_SECRET_MISSING`、`INVALID_CUSTOM_ROOM_CONFIGURATION`、
`INVALID_MATCHMAKING_POOL`、`INVALID_INPUT_LIMITS`、`INVALID_AUTHENTICATION_HOOK`、
`INVALID_OBSERVABILITY_CONFIGURATION` は、Worker 起動または設定正規化時に
`FlareLobbyConfigurationError` として返ります。Binding 名、値域、Hook の関数型、
観測 sampling（0〜1）を確認します。

## 公開 Export の検査対象

以下は各 `src/index.ts` から公開される識別子の一覧です。API の追加・削除時に
`scripts/verify-docs.mjs` がこのページ内の名称を確認します。

### core

`JsonPrimitive`, `JsonObject`, `JsonValue`, `ReadonlyDeep`, `Timestamp`, `Revision`, `PlayerId`, `PrincipalId`, `RoomId`, `InvitationCode`, `ParticipantId`, `TeamId`, `MatchmakingPoolId`, `MatchmakingTicketId`, `MatchCandidateId`, `MatchId`, `GameId`, `SeasonId`, `MatchMode`, `Region`, `Player`, `Principal`, `Team`, `PlayerParticipant`, `Spectator`, `Participant`, `Host`, `RoomSettings`, `RoomMetadata`, `GameMessageMap`, `FlareLobbyApp`, `AnyFlareLobbyApp`, `AppRoomSettings`, `AppRoomMetadata`, `AppGameMessages`, `CustomRoom`, `MatchRoom`, `Room`, `RoomStatus`, `WaitingRoomState`, `PreparingRoomState`, `InProgressRoomState`, `FinishedRoomState`, `RoomState`, `RoomSnapshotBase`, `CustomRoomSnapshot`, `MatchRoomSnapshot`, `RoomSnapshot`, `MatchmakingPool`, `Rating`, `MatchCandidate`, `MatchResult`, `MatchmakingTicketStatus`, `MatchmakingTicketBase`, `CreatingMatchmakingTicket`, `WaitingMatchmakingTicket`, `ReservedMatchmakingTicket`, `MatchedMatchmakingTicket`, `CancelledMatchmakingTicket`, `ExpiredMatchmakingTicket`, `MatchmakingTicket`, `GameMessageName`, `GameMessagePayload`, `GameMessage`, `InferFlareLobbyApp`, `RatingResult`, `RatingCalculationInput`, `RatingCalculation`, `RatingEngine`, `EloOptions`, `DEFAULT_ELO_INITIAL_RATING`, `DEFAULT_ELO_K_FACTOR`, `EloCalculation`, `EloEngine`, `elo`, `MatchmakingSearchWidthStage`, `MatchmakingSearchPolicy`, `NormalizedMatchmakingSearchPolicy`, `DEFAULT_MATCHMAKING_SEARCH_WIDTH_STAGES`, `DEFAULT_MATCHMAKING_MAX_TICKETS_PER_SEARCH`, `DEFAULT_MATCHMAKING_MAX_CANDIDATES_PER_SEARCH`, `DEFAULT_MATCHMAKING_MAX_MATCHES_PER_SEARCH`, `MatchmakingSearchTicket`, `MatchmakingCandidateQuality`, `MatchmakingCandidateEvaluation`, `MatchmakingCandidateSearchOptions`, `MatchmakingCandidateEvaluationOptions`, `normalizeMatchmakingSearchPolicy`, `getMatchmakingSearchWidth`, `getNextMatchmakingSearchAt`, `evaluateMatchCandidate`, `selectMatchCandidates`, `findBestMatchCandidate`, `compareMatchCandidateQuality`, `evaluateMatchmakingCandidate`, `findBestMatchmakingCandidate`, `PROTOCOL_VERSION`, `ProtocolVersion`, `RequestId`, `ProtocolCommandName`, `ProtocolEventType`, `ProtocolMessageKind`, `ProtocolEnvelope`, `ClientCommandEnvelope`, `ServerSuccessEnvelope`, `FLARE_LOBBY_ERROR_CODES`, `FlareLobbyErrorCode`, `FlareLobbyErrorPayload`, `FlareLobbyErrorOptions`, `FlareLobbyError`, `ServerFailureEnvelope`, `ServerEventEnvelope`, `ServerMessage`, `ProtocolMessage`, `ProtocolSuccess`, `ProtocolFailure`, `ProtocolResult`, `ProtocolValidationOptions`, `EventRevisionStatus`, `isDuplicateRequest`, `classifyEventRevision`, `validateProtocolMessage`, `decodeProtocolMessage`, `decodeClientCommand`, `decodeServerMessage`, `encodeProtocolMessage`, `isFlareLobbyErrorCode`

### client

`createFlareLobbyClient`, `CustomRoomClientApi`, `CustomRoomCreationOptions`, `CustomRoomJoinOptions`, `CustomRoomJoinMethod`, `CustomRoomListPage`, `CustomRoomListQuery`, `CustomRoomParticipantRole`, `CustomRoomSummary`, `HostRoom`, `PlayerRoom`, `Room`, `RoomConnectionStatus`, `RoomConnectionStatusListener`, `RoomEventListener`, `RoomGameMessage`, `RoomKickTarget`, `RoomLeaveOptions`, `RoomMessageListener`, `RoomMessageSender`, `RoomOperationOptions`, `RoomReconnectOptions`, `RoomRole`, `RoomSnapshotListener`, `RoomSubscriptionApi`, `RoomStateOperationOptions`, `SpectatorRoom`, `ClientCommandOptions`, `ClientEventListener`, `ClientRequestOptions`, `ClientWebSocketOptions`, `FetchImplementation`, `FlareLobbyClient`, `FlareLobbyClientOptions`, `FlareLobbyWebSocketConnection`, `WebSocketConstructor`, `WebSocketFactory`, `MatchmakingClientApi`, `MatchmakingJoinOptions`, `MatchmakingPoolReference`, `MatchmakingProgress`, `MatchmakingProgressListener`, `MatchmakingResult`, `MatchmakingTicket`, `MatchmakingTicketCancelOptions`, `MatchmakingTicketConnectionStatus`, `MatchmakingTicketConnectionStatusListener`, `MatchmakingTicketRequestOptions`, `MatchmakingTicketSnapshot`, `MatchmakingWaitForMatchOptions`

### cloudflare

`FLARE_LOBBY_BINDINGS`, `FLARE_LOBBY_CONFIGURATION_ERROR_CODES`, `FlareLobbyConfigurationError`, `consumeRateLimit`, `consumeRoomCreationRateLimit`, `consumeWebSocketMessageRateLimit`, `createGatewayWorker`, `defineFlareLobby`, `createCustomRoom`, `joinCustomRoom`, `leaveCustomRoom`, `listCustomRooms`, `getMatchmakingTicketWebSocketRoute`, `handleMatchmakingRequest`, `upgradeMatchmakingTicketWebSocket`, `DEFAULT_RATING_CONFLICT_RETRY_COUNT`, `applyMatchResult`, `ensureRatingSchema`, `getMatchHistory`, `getPlayerRating`, `getRating`, `listMatchHistory`, `recordMatchResult`, `registerMatchResult`, `MatchPoolDurableObject`, `RateLimitDurableObject`, `RoomDurableObject`, `DEFAULT_DISCONNECT_GRACE_PERIOD_MS`, `DEFAULT_EVENT_HISTORY_LIMIT`, `DEFAULT_FINISHED_ROOM_RETENTION_MS`, `DEFAULT_PROCESSED_COMMAND_RETENTION_MS`, `DEFAULT_RESUME_TOKEN_TTL_MS`, `getParticipantWebSocketTag`, `getPrincipalWebSocketTag`, `getResumeWebSocketTag`, `getRoleWebSocketTag`, `getRoomWebSocketTag`, `DEFAULT_MATCHMAKING_MATCH_MAX_ATTEMPTS`, `DEFAULT_MATCHMAKING_MATCH_MAX_RETRY_DELAY_MS`, `DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS`, `DEFAULT_MATCHMAKING_MATCH_TEAM_IDS`, `DEFAULT_MATCHMAKING_TICKET_TTL_MS`, `MATCHMAKING_POOL_KEY_SEPARATOR`, `createMatchmakingMatchId`, `createMatchmakingPoolKey`, `createMatchmakingRoomId`, `createMatchPoolKey`, `getMatchmakingPoolKey`, `getMatchPoolName`, `FLARE_LOBBY_RATE_LIMIT_SCOPES`, `FLARE_LOBBY_WEBSOCKET_AUTH_PROTOCOL_PREFIX`, `FLARE_LOBBY_WEBSOCKET_PROTOCOL`, `authenticateGatewayRequest`, `authenticateRequest`, `authorizeGatewayOperation`, `createErrorResponse`, `createGatewayPrincipalEnvelope`, `issueJoinToken`, `issueResumeToken`, `normalizePrincipal`, `readValidatedJsonBody`, `readWebSocketJoinToken`, `validateQuery`, `validateWebSocketCommand`, `verifyGatewayPrincipalEnvelope`, `verifyJoinToken`, `verifyResumeToken`, `verifyWebSocketJoinToken`, `verifyWebSocketResumeToken`, `verifyWebSocketRoomToken`, `FLARE_LOBBY_CORRELATION_ID_HEADER`, `FLARE_LOBBY_OPERATION_HEADER`, `FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION`, `FLARE_LOBBY_REQUEST_ID_HEADER`, `attachObservabilityHeaders`, `createObservabilityContext`, `createObservabilitySink`, `getObservabilityErrorCode`, `getObservabilityOperationName`, `observeHttpOperation`, `observeOperation`, `readObservabilityContext`, `recordQualityMetric`, `withObservabilityRequestId`, `FlareLobbyBindings`, `CustomRoomConfiguration`, `MatchmakingPoolConfiguration`, `FlareLobbyInputLimits`, `FlareLobbyConfiguration`, `FlareLobbyConfigurationErrorCode`, `FlareLobbyGatewayWorker`, `DefinedFlareLobby`, `RatingConfiguration`, `CustomRoomCreationInput`, `CustomRoomCreationOptions`, `CustomRoomCreationResponse`, `CustomRoomCreationResult`, `CustomRoomJoinMethod`, `CustomRoomJoinInput`, `CustomRoomJoinOptions`, `CustomRoomJoinResponse`, `CustomRoomJoinResult`, `CustomRoomLeaveInput`, `CustomRoomLeaveOptions`, `CustomRoomLeaveResult`, `CustomRoomParticipantRole`, `CustomRoomListQuery`, `CustomRoomListResult`, `RoomSummary`, `CustomRoomIndexJoinMethod`, `CustomRoomIndexRecord`, `MatchmakingPoolKeyInput`, `MatchPoolInitializationOptions`, `MatchPoolSnapshot`, `MatchmakingAttributeObject`, `MatchmakingMatchIntent`, `MatchmakingMatchIntentStatus`, `MatchmakingMatchProcessingOptions`, `MatchmakingMatchRoomOptions`, `MatchmakingMatchRoomRecord`, `MatchmakingMatchResult`, `MatchmakingSearchOptions`, `MatchmakingSearchResult`, `MatchmakingTicketCancellationOptions`, `MatchmakingTicketCreationOptions`, `MatchmakingTicketEvent`, `MatchmakingTicketEventQueryOptions`, `MatchmakingTicketMatchOptions`, `MatchmakingTicketRecord`, `MatchmakingTicketReservationOptions`, `MatchmakingRoomConnection`, `MatchmakingTicketGatewayResponse`, `MatchmakingTicketWebSocketRoute`, `MatchHistoryPage`, `MatchHistoryQuery`, `MatchResultRegistration`, `MatchResultRegistrationInput`, `RatingMatchParticipant`, `RatingMatchRecord`, `RoomInitializationOptions`, `RoomStartConditions`, `RoomProcessedCommand`, `RoomProcessedCommandOptions`, `RoomScheduledOperation`, `RoomScheduledOperationKind`, `RoomScheduledOperationOptions`, `RoomStateTransitionOptions`, `RoomJoinMethod`, `RoomParticipantRole`, `RoomParticipantJoinOptions`, `RoomParticipantJoinResult`, `RoomParticipantLeaveOptions`, `RoomParticipantLeaveResult`, `RoomParticipantDisconnectOptions`, `RoomParticipantOperationOptions`, `RoomSetReadyOptions`, `RoomSelectTeamOptions`, `RoomHostOperationOptions`, `RoomUpdateSettingsOptions`, `RoomTransferHostOptions`, `RoomKickOptions`, `RoomStartMatchOptions`, `RoomCloseOptions`, `RoomOperationResult`, `RoomJoinOptions`, `RoomJoinResult`, `RoomLeaveOptions`, `RoomLeaveResult`, `RoomResumeHandshake`, `RoomWebSocketAttachment`, `AuthenticatedGatewayRequest`, `FlareLobbyAuthenticationHook`, `FlareLobbyAuthenticationResult`, `FlareLobbyAuthorizationContext`, `FlareLobbyAuthorizationHook`, `FlareLobbyAuthorizationHooks`, `FlareLobbyAuthorizationOperation`, `FlareLobbyAuthorizationRequest`, `FlareLobbyInputValidator`, `FlareLobbyRateLimitDecision`, `FlareLobbyRateLimitScope`, `FlareLobbyRoomTokenClaims`, `FlareLobbyRoomParticipantRole`, `FlareLobbyRoomTokenIssueOptions`, `FlareLobbyRoomTokenPurpose`, `FlareLobbyRoomTokenVerificationOptions`, `FlareLobbyWebSocketJoinTokenVerificationOptions`, `FlareLobbyWebSocketRoomTokenVerificationOptions`, `GatewayPrincipalEnvelope`, `FlareLobbyObservabilityAttributeValue`, `FlareLobbyObservabilityConfiguration`, `FlareLobbyObservabilityContext`, `FlareLobbyObservabilityContextOptions`, `FlareLobbyObservabilitySink`, `FlareLobbyObservationResult`, `FlareLobbyQualityMetric`, `FlareLobbyQualityMetricName`, `FlareLobbyStructuredLogRecord`, `FlareLobbyStructuredLogger`

### testing

`AdvancingClock`, `Clock`, `VirtualClock`, `createVirtualClock`, `toEpochMilliseconds`, `addMilliseconds`, `RandomSeed`, `RandomSource`, `SEEDED_RANDOM_ALGORITHM`, `SeededRandom`, `createSeededRandom`, `NormalizedPlayerGenerationOptions`, `NumericDistribution`, `PlayerGenerationOptions`, `SimulationPlayer`, `TimestampDistribution`, `normalizePlayerGenerationOptions`, `generateSimulationPlayers`, `normalizeSimulationPlayers`, `normalizeNumericDistribution`, `sampleNumericDistribution`, `normalizeTimestampDistribution`, `sampleTimestampDistribution`, `MatchmakingSimulationConfig`, `MatchmakingSimulationReplayConfig`, `MatchmakingSimulationResult`, `NormalizedSimulationCancellationPolicy`, `SimulationCancellationPolicy`, `SimulationDependencies`, `SimulationEvent`, `SimulationEventType`, `SimulationMatchResult`, `SimulationPolicyComparison`, `SimulationPolicyDefinition`, `SimulationPolicyRun`, `SimulationReplay`, `SimulationStatistics`, `SimulationTicketResult`, `SimulationTicketStatus`, `DistributionStatistics`, `DEFAULT_SIMULATION_DURATION_MS`, `DEFAULT_SIMULATION_TICK_MS`, `DEFAULT_SIMULATION_POOL`, `MAX_SIMULATION_EVENT_COUNT`, `simulateMatchmaking`, `replaySimulation`, `compareSearchPolicies`, `SimulationOutput`, `serializeSimulationResult`, `summarizeSimulation`, `formatSimulationOutput`
