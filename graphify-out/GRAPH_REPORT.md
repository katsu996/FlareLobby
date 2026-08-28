# Graph Report - FlareLobby  (2026-08-29)

## Corpus Check
- 161 files · ~213,331 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4706 nodes · 8077 edges · 315 communities (155 shown, 160 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Cloudflare Worker Types & AI Models
- RPS Game Client Types
- Party System Core
- Match Pool & Matchmaking
- Room Management
- Core Matchmaking Types
- Client Library
- Custom Room Creation
- Custom Room Index
- Protocol & Revision Types
- Client Request/Command Types
- Matchmaking with ADR 0004
- Core Index Types
- Custom Room Client Types
- Match Pool Durable Object
- Room Lifecycle
- Party Gateway
- Custom Room Client Implementation
- Web Platform AbortSignal
- Package Configuration
- FlareLobby Configuration
- Matchmaking Reconnection
- Glicko2 Rating System
- Browser Runtime Types
- Package Config Refs
- Matchmaking Retry Logic
- Testing Package Config
- Matchmaking Ticket Types
- Package Config Refs
- Observability
- WebSocket Testing
- Rating Schema
- Web Platform CloseEvent
- Type Testing
- Project Path References
- Room JSON Types
- Request ID Creation
- Testing Simulator
- RPS Game Types
- Public Type Testing
- Simulator Default Config
- Room Waiting State
- Browser Integration Tests
- Package Scripts Verify
- Integration Tests
- Docs TypeScript Config
- FlareLobby Dependencies
- Client Find Match
- Matchmaking Gateway Tests
- Testing Clock
- Testing Random Source
- Test TypeScript Config
- Custom Room Player Types
- Base TypeScript Config
- Match Pool Tests
- Console Types
- Match Pool Durable Object
- CompressionStream Types
- URL Types
- Browser TypeScript Config
- Browser Cancel Queue
- Rating String Comparison
- Rating Tests
- Vitest Dev Dependencies
- Project Path References
- Custom Room Tests
- Match Pool Durable Object Alarm
- TypeScript Config Refs
- Durable Objects Rate Limiting
- Match Pool Durable Object Tick
- URLSearchParams Types
- DurableObjectStorage Types
- Scripts Verify
- Package Types
- Custom Room Transport
- Test TypeScript Config
- Rating Engine Creation
- Container Types
- Element Types
- Headers Types
- SubtleCrypto Types
- TypeScript Config Refs
- Custom Room Index Types
- Room Snapshot Events
- Test TypeScript Config
- Blob Types
- Body Types
- FormData Types
- URLPattern Types
- Test Simulation
- Project Path References
- Party Tests
- DurableObjectState Types
- Email Event Types
- WorkerEntrypoint Types
- Rating Verification Scripts
- Project Path References
- TypeScript Config Refs
- Already Uploaded Error
- Seeded Random Testing
- Docs Verification Scripts
- Changeset Config
- Project Path References
- Project Path References
- Project Path References
- Matchmaking Tests
- Matchmaking Tests
- Party Tests
- Rating Schema Upgrade
- Flagship Feature Flags
- R2 Object Types
- Test TypeScript Config
- Test TypeScript Config
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 242
- Community 243
- Community 244
- Community 245
- Community 246
- Community 247
- Community 248
- Community 249
- Community 250
- Community 251
- Community 252
- Community 253
- Community 254
- Community 255
- Community 256
- Community 257
- Community 258
- Community 259
- Community 260
- Community 261
- Community 262
- Community 263
- Community 264
- Community 265
- Community 266
- Community 267
- Community 268
- Community 269
- Community 270
- Community 271
- Community 272
- Community 273
- Community 274
- Community 275
- Community 276
- Community 277
- Community 278
- Community 279
- Community 280
- Community 281
- Community 282
- Community 283
- Community 284
- Community 285
- Community 286
- Community 287
- Community 288
- Community 289
- Community 290
- Community 291
- Community 292
- Community 293
- Community 294
- Community 295
- Community 296
- Community 297

## God Nodes (most connected - your core abstractions)
1. `RoomDurableObject` - 88 edges
2. `MatchPoolDurableObject` - 87 edges
3. `MatchmakingTicketImpl` - 49 edges
4. `PartyDurableObject` - 46 edges
5. `RoomImpl` - 44 edges
6. `GatewayPrincipalEnvelope` - 43 edges
7. `PartyImpl` - 38 edges
8. `isNonEmptyString()` - 31 edges
9. `simulateMatchmaking()` - 27 edges
10. `FlareLobbyObservabilityContext` - 26 edges

## Surprising Connections (you probably didn't know these)
- `MatchedPlayers` --references--> `MatchmakingPoolConfiguration`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/config.ts
- `handleDemoRpsRequest()` --calls--> `createErrorResponse()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/security.ts
- `authenticateDemoRpsRequest()` --calls--> `createErrorResponse()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/security.ts
- `readMatchedPlayers()` --calls--> `createMatchmakingPoolKey()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/match-pool.ts
- `acceptRpsMove()` --calls--> `registerMatchResult()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/rating.ts

## Import Cycles
- None detected.

## Communities (315 total, 160 thin omitted)

### Community 0 - "Cloudflare Worker Types & AI Models"
Cohesion: 0.00
Nodes (848): RFC-2253, RFC-3339, RFC-5246, RFC-9440, AgentMemoryGetSummaryOptions, AgentMemoryGetSummaryResponse, AgentMemoryIncomingMemory, AgentMemoryIngestOptions (+840 more)

### Community 1 - "RPS Game Client Types"
Cohesion: 0.05
Nodes (87): authenticateDemoRpsRequest(), FlareLobbyConfiguration, CustomRoomCreationInput, CustomRoomCreationOptions, CustomRoomCreationResponse, CustomRoomCreationResult, CustomRoomJoinInput, CustomRoomJoinMethod (+79 more)

### Community 2 - "Party System Core"
Cohesion: 0.07
Nodes (35): compareStrings(), DEFAULT_PARTY_IDLE_TTL_MS, DEFAULT_PARTY_INVITE_TTL_MS, DEFAULT_PARTY_MAX_SIZE, EventRow, InviteRow, isNonEmptyString(), MatchPoolCancellationStub (+27 more)

### Community 3 - "Match Pool & Matchmaking"
Cohesion: 0.06
Nodes (68): createMatchmakingPoolKey(), createMatchPoolKey, createMatchRoomInitialization(), DEFAULT_MATCHMAKING_MATCH_MAX_ATTEMPTS, DEFAULT_MATCHMAKING_MATCH_MAX_RETRY_DELAY_MS, DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS, DEFAULT_MATCHMAKING_MATCH_TEAM_IDS, DEFAULT_MATCHMAKING_TICKET_TTL_MS (+60 more)

### Community 4 - "Room Management"
Cohesion: 0.04
Nodes (68): assertJoinCredentials(), AuthenticatedRoomActor, createWebSocketTags(), decodeBase64Url(), digestPassword(), encodeBase64Url(), getParticipantWebSocketTag(), getPrincipalWebSocketTag() (+60 more)

### Community 5 - "Core Matchmaking Types"
Cohesion: 0.07
Nodes (60): MatchedPlayers, JsonObject, MatchCandidate, MatchmakingPool, MatchmakingTicketId, Player, PlayerId, Rating (+52 more)

### Community 6 - "Client Library"
Cohesion: 0.06
Nodes (31): ClientEventListener, COMPATIBLE_PROTOCOLS, createErrorWithRequestId(), createWebSocketProtocols(), effectivePort(), encodeBase64Url(), FlareLobbyClient, FlareLobbyClientImpl (+23 more)

### Community 7 - "Custom Room Creation"
Cohesion: 0.08
Nodes (55): consumeRoomCreationRateLimit(), createCustomRoom(), createInvitationCode(), createPasswordFingerprint(), createWebSocketUrl(), CustomRoomGatewayStub, deriveRoomId(), encodeBase64Url() (+47 more)

### Community 8 - "Custom Room Index"
Cohesion: 0.06
Nodes (50): CUSTOM_ROOM_INDEX_RETRY_DELAY_MS, CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID, CustomRoomIndexJoinMethod, CustomRoomIndexRow, deleteCustomRoomIndex(), ensureCustomRoomIndex(), ensureCustomRoomInvitationIndex(), ensureOnce() (+42 more)

### Community 9 - "Protocol & Revision Types"
Cohesion: 0.06
Nodes (48): JsonValue, Revision, classifyEventRevision(), ClientCommandEnvelope, decodeClientCommand(), decodeProtocolMessage(), decodeServerMessage(), defaultErrorMessages (+40 more)

### Community 10 - "Client Request/Command Types"
Cohesion: 0.07
Nodes (51): ClientCommandOptions, ClientRequestOptions, appendQueryValue(), createCreationBody(), createCustomRoom(), createCustomRoomApi(), createJoinBody(), createRoomHandle() (+43 more)

### Community 11 - "Matchmaking with ADR 0004"
Cohesion: 0.09
Nodes (48): ADR-0004, MatchmakingMatchIntent, MatchPoolInitializationOptions, cancelTicket(), createMatchmakingPoolKey(), createMatchRoomConnection(), createRoomWebSocketUrl(), createTicket() (+40 more)

### Community 12 - "Core Index Types"
Cohesion: 0.05
Nodes (48): AppBound, AppGameMessages, AppRoomMetadata, AppRoomSettings, CancelledMatchmakingTicket, CreatingMatchmakingTicket, CustomRoom, CustomRoomSnapshot (+40 more)

### Community 13 - "Custom Room Client Types"
Cohesion: 0.11
Nodes (39): RoomConnectionResult, RoomCreationConnectionResult, compactJsonObject(), createMatchmakingApi(), createPoolPath(), createRequestId(), createTicketPath(), deepFreeze() (+31 more)

### Community 14 - "Match Pool Durable Object"
Cohesion: 0.11
Nodes (4): getTicketSearchWidth(), MatchPoolDurableObject, parseSearchPolicy(), ticketEventTag()

### Community 15 - "Room Lifecycle"
Cohesion: 0.08
Nodes (8): assertActiveRoom(), closeWebSocketSafely(), createRoomState(), deepFreeze(), deleteRoomState(), getDisconnectOperationId(), isAllowedTransition(), RoomDurableObject

### Community 16 - "Party Gateway"
Cohesion: 0.08
Nodes (34): MatchmakingTicketCancellationOptions, getPartyWebSocketRoute(), handlePartyRequest(), normalizeGatewayError(), notFound(), parsePartyJsonBody(), parsePartyRoute(), PartyEventsWebSocketRoute (+26 more)

### Community 17 - "Custom Room Client Implementation"
Cohesion: 0.10
Nodes (5): compactJsonObject(), isHostSnapshot(), isRetryableReconnectError(), normalizeReconnectError(), RoomImpl

### Community 18 - "Web Platform AbortSignal"
Cohesion: 0.04
Nodes (7): AbortSignal, EventSource, EventTarget, MessagePort, ServiceWorkerGlobalScope, WebSocket, WorkerGlobalScope

### Community 19 - "Package Configuration"
Cohesion: 0.05
Nodes (43): author, bugs, url, dependencies, @flarelobby/core, description, devDependencies, @flarelobby/client (+35 more)

### Community 20 - "FlareLobby Configuration"
Cohesion: 0.07
Nodes (33): assertCustomRoomConfiguration(), assertInputLimits(), assertMatchmakingPools(), assertObservabilityConfiguration(), consumeRateLimit(), consumeWebSocketMessageRateLimit(), createGatewayWorker(), CUSTOM_ROOM_OPERATION_PATH_PATTERNS (+25 more)

### Community 21 - "Matchmaking Reconnection"
Cohesion: 0.11
Nodes (35): NormalizedReconnectOptions, assertPartyId(), compactJsonObject(), createPartyApi(), createPartyPath(), createRequestId(), deepFreeze(), isCancelledError() (+27 more)

### Community 22 - "Glicko2 Rating System"
Cohesion: 0.09
Nodes (36): applyGlicko2Update(), computeGlicko2Volatility(), DEFAULT_ELO_INITIAL_RATING, DEFAULT_ELO_K_FACTOR, DEFAULT_GLICKO2_INITIAL_RATING, DEFAULT_GLICKO2_INITIAL_RATING_DEVIATION, DEFAULT_GLICKO2_TAU, DEFAULT_GLICKO2_VOLATILITY (+28 more)

### Community 23 - "Browser Runtime Types"
Cohesion: 0.05
Nodes (37): appScreen, customConnection, customInvitationCode, customMoveActions, customMoves, customPanel, customParticipants, customReady (+29 more)

### Community 24 - "Package Config Refs"
Cohesion: 0.05
Nodes (37): author, bugs, url, dependencies, @flarelobby/core, description, exports, files (+29 more)

### Community 25 - "Matchmaking Retry Logic"
Cohesion: 0.11
Nodes (3): isRetryableReconnectError(), isTerminalStatus(), MatchmakingTicketImpl

### Community 26 - "Testing Package Config"
Cohesion: 0.05
Nodes (37): author, bugs, url, dependencies, @flarelobby/core, description, exports, files (+29 more)

### Community 27 - "Matchmaking Ticket Types"
Cohesion: 0.10
Nodes (7): MatchmakingTicketCancelOptions, MatchmakingTicketSnapshot, isRetryableReconnectError(), isTerminalQueueStatus(), normalizeClientError(), PartyImpl, RawJsonEventConnection

### Community 28 - "Package Config Refs"
Cohesion: 0.06
Nodes (35): author, bugs, url, description, devDependencies, @vitest/coverage-v8, exports, files (+27 more)

### Community 29 - "Observability"
Cohesion: 0.09
Nodes (30): attachObservabilityHeaders(), FLARE_LOBBY_ANALYTICS_SAMPLED_HEADER, FLARE_LOBBY_CORRELATION_ID_HEADER, FLARE_LOBBY_LOG_SAMPLED_HEADER, FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION, FLARE_LOBBY_OPERATION_HEADER, FLARE_LOBBY_REQUEST_ID_HEADER, FlareLobbyObservabilityAttributeValue (+22 more)

### Community 30 - "WebSocket Testing"
Cohesion: 0.08
Nodes (25): RoomScheduledOperation, createRequest(), createRoom(), joinRoom(), leaveRoom(), operationRequest(), testLobby, testWorker (+17 more)

### Community 31 - "Rating Schema"
Cohesion: 0.07
Nodes (33): applyMatchResult, DEFAULT_RATING_CONFLICT_RETRY_COUNT, getPlayerRating, HistoryCursor, MatchHistoryPage, MatchHistoryQuery, MatchResultRegistration, MatchRow (+25 more)

### Community 32 - "Web Platform CloseEvent"
Cohesion: 0.06
Nodes (6): CloseEvent, CustomEvent, ErrorEvent, Event, MessageEvent, PromiseRejectionEvent

### Community 33 - "Type Testing"
Cohesion: 0.07
Nodes (22): defineFlareLobby(), FlareLobbyGatewayWorker, EnvWithoutD1, Equal, ExampleApp, Expect, fullConfiguration, fullWorker (+14 more)

### Community 34 - "Project Path References"
Cohesion: 0.06
Nodes (31): APIリファレンス, client, Client 本体, cloudflare, core, D1 レーティング, Durable Object の公開 RPC, ELO (+23 more)

### Community 35 - "Room JSON Types"
Cohesion: 0.12
Nodes (31): isJsonValue(), isNonEmptyString(), isRecord(), isRoomParticipantRole(), isSafeTimestamp(), normalizeHost(), normalizeInitialization(), normalizeInvitationCode() (+23 more)

### Community 36 - "Request ID Creation"
Cohesion: 0.10
Nodes (4): createRequestId(), errorForWebSocketCloseCode(), FlareLobbyWebSocketConnectionImpl, RawJsonEventConnectionImpl

### Community 37 - "Testing Simulator"
Cohesion: 0.15
Nodes (28): assertNonEmptyString(), assertRecord(), compareSearchPolicies(), compareWorkingTickets(), createDistributionStatistics(), createReplayConfig(), createStatistics(), deepFreeze() (+20 more)

### Community 38 - "RPS Game Types"
Cohesion: 0.16
Nodes (23): acceptRpsMove(), DEMO_RANKED_POOL_ID, ensureRpsMatch(), createRpsResultId(), getRpsOutcome(), isRatingResult(), isRpsMove(), resolveRpsResult() (+15 more)

### Community 39 - "Public Type Testing"
Cohesion: 0.07
Nodes (27): GameMessage, InferFlareLobbyApp, MatchmakingTicket, RoomSnapshot, RoomState, RoomStatus, _appCanBeInferredFromMessage, _appCanBeInferredFromSnapshot (+19 more)

### Community 40 - "Simulator Default Config"
Cohesion: 0.10
Nodes (26): NormalizedPlayerGenerationOptions, NumericDistribution, PlayerGenerationOptions, SimulationPlayer, TimestampDistribution, RandomSeed, DEFAULT_SIMULATION_DURATION_MS, DEFAULT_SIMULATION_TICK_MS (+18 more)

### Community 41 - "Room Waiting State"
Cohesion: 0.27
Nodes (3): assertWaitingRoom(), normalizeOperationRequest(), parseRoomSnapshotResult()

### Community 42 - "Browser Integration Tests"
Cohesion: 0.10
Nodes (15): boot(), ClientMock, createRoom(), customMoveButtons, element(), elements, FakeClassList, FakeElement (+7 more)

### Community 43 - "Package Scripts Verify"
Cohesion: 0.08
Nodes (25): scripts, build, changeset, check:deploy, check:docs, check:esm, check:packages, check:rating-schema (+17 more)

### Community 44 - "Integration Tests"
Cohesion: 0.13
Nodes (12): activeClients, createClient(), createCloseEvent(), createMatchedRooms(), EventListener, integrationLobby, integrationPool, integrationWorker (+4 more)

### Community 45 - "Docs TypeScript Config"
Cohesion: 0.08
Nodes (23): compilerOptions, composite, declaration, declarationMap, lib, noEmit, paths, extends (+15 more)

### Community 46 - "FlareLobby Dependencies"
Cohesion: 0.08
Nodes (23): esbuild, dependencies, @flarelobby/client, @flarelobby/cloudflare, @flarelobby/core, devDependencies, esbuild, vitest (+15 more)

### Community 47 - "Client Find Match"
Cohesion: 0.10
Nodes (6): MatchmakingJoinOptions, MatchmakingPoolReference, MatchmakingTicket, MatchmakingTicketRequestOptions, MatchmakingWaitForMatchOptions, Party

### Community 48 - "Matchmaking Gateway Tests"
Cohesion: 0.10
Nodes (19): MatchmakingMatchProcessingOptions, MatchmakingSearchOptions, MatchmakingTicketCreationOptions, MatchmakingTicketMatchOptions, MatchmakingTicketRecord, MatchmakingTicketReservationOptions, MatchmakingTicketGatewayResponse, FlareLobbyObservabilityContext (+11 more)

### Community 49 - "Testing Clock"
Cohesion: 0.14
Nodes (11): addMilliseconds(), AdvancingClock, Clock, createVirtualClock(), isNonNegativeSafeInteger(), isValidDateMilliseconds(), toEpochMilliseconds(), VirtualClock (+3 more)

### Community 50 - "Testing Random Source"
Cohesion: 0.20
Nodes (18): assertFiniteNumber(), assertNonEmptyString(), clamp(), compareStrings(), generateSimulationPlayers(), isFiniteNonNegativeNumber(), isNonEmptyString(), isNonNegativeSafeInteger() (+10 more)

### Community 51 - "Test TypeScript Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, composite, declaration, declarationMap, lib, noEmit, paths (+13 more)

### Community 52 - "Custom Room Player Types"
Cohesion: 0.11
Nodes (7): CustomRoomJoinOptions, PlayerRoom, Room, RoomSubscriptionApi, SpectatorRoom, MatchmakingClientApi, TicketWaiter

### Community 53 - "Base TypeScript Config"
Cohesion: 0.09
Nodes (21): compilerOptions, composite, declaration, declarationMap, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 54 - "Match Pool Tests"
Cohesion: 0.11
Nodes (15): createMatchmakingRoomId(), MATCHMAKING_POOL_KEY_SEPARATOR, MatchmakingMatchResult, MatchmakingTicketEventQueryOptions, captureErrorCode(), createGatewayPrincipal(), createInitializedPool(), errorCodeOf() (+7 more)

### Community 56 - "Match Pool Durable Object"
Cohesion: 0.18
Nodes (12): createMatchRoomRecord(), deepFreeze(), getMatchSettlementErrorCode(), getMatchSettlementRetryDelay(), isRetryableMatchSettlementError(), isTimestamp(), normalizeJsonObject(), parseCandidate() (+4 more)

### Community 57 - "CompressionStream Types"
Cohesion: 0.10
Nodes (7): CompressionStream, DecompressionStream, FixedLengthStream, IdentityTransformStream, TextDecoderStream, TextEncoderStream, TransformStream

### Community 59 - "Browser TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, composite, lib, module, moduleResolution, noEmit, paths, extends (+9 more)

### Community 60 - "Browser Cancel Queue"
Cohesion: 0.24
Nodes (18): cancelRankedQueue(), createCustomRoom(), createRequestId(), displayPlayer(), element(), getClient(), isCancelled(), isMove() (+10 more)

### Community 61 - "Rating String Comparison"
Cohesion: 0.18
Nodes (18): compareStrings(), findExistingTeamMatch(), isNonEmptyString(), isNonNegativeSafeInteger(), isRatingResult(), isRecord(), isSafeInteger(), isSafeIntegerValue() (+10 more)

### Community 62 - "Rating Tests"
Cohesion: 0.15
Nodes (6): getMatchHistory, createGatewayPrincipal(), FakePreparedStatement, FakeSchemaDatabase, readStoredRating(), readStoredRatingState()

### Community 63 - "Vitest Dev Dependencies"
Cohesion: 0.12
Nodes (17): @changesets/cli, @cloudflare/vitest-pool-workers, oxfmt, oxlint, devDependencies, @changesets/cli, @cloudflare/vitest-pool-workers, oxfmt (+9 more)

### Community 64 - "Project Path References"
Cohesion: 0.19
Nodes (5): 0.1.0 - 2026-08-12, 品質と公開準備, 変更履歴, 追加, Examples

### Community 65 - "Custom Room Tests"
Cohesion: 0.15
Nodes (9): createFlareLobbyClient(), FetchImplementation, createClient(), webSocket, createClient(), createSnapshot(), creationResponse(), snapshotEvent() (+1 more)

### Community 66 - "Match Pool Durable Object Alarm"
Cohesion: 0.15
Nodes (6): PartyQueueStub, roundHalfAwayFromZero(), createObservabilityContext(), createObservabilitySink(), normalizeSampleRate(), PartyQueueStartResult

### Community 67 - "TypeScript Config Refs"
Cohesion: 0.12
Nodes (15): compilerOptions, composite, noEmit, paths, extends, include, ../../packages/cloudflare/src/index.ts, ../../packages/cloudflare/worker-configuration.d.ts (+7 more)

### Community 68 - "Durable Objects Rate Limiting"
Cohesion: 0.20
Nodes (10): developmentLobby, allowedRateLimitDecision(), deniedRateLimitDecision(), isPositiveSafeInteger(), isRateLimitScope(), RateLimitDurableObject, RateLimitOwnerRow, RateLimitRow (+2 more)

### Community 69 - "Match Pool Durable Object Tick"
Cohesion: 0.18
Nodes (3): createMatchmakingMatchId(), normalizeSearchNow(), toPool()

### Community 72 - "Scripts Verify"
Cohesion: 0.14
Nodes (13): archiveDirectory, changelog, changeset, changesetConfig, errors, packages, read(), readJson() (+5 more)

### Community 73 - "Package Types"
Cohesion: 0.14
Nodes (13): author, bugs, url, description, engines, node, homepage, license (+5 more)

### Community 74 - "Custom Room Transport"
Cohesion: 0.16
Nodes (5): ClientWebSocketOptions, FlareLobbyWebSocketConnection, CustomRoomTransport, MatchmakingTransport, PartyTransport

### Community 75 - "Test TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, composite, declaration, declarationMap, lib, noEmit, extends, include (+5 more)

### Community 76 - "Rating Engine Creation"
Cohesion: 0.20
Nodes (14): createRatingEngine(), createRatingUpdateExtraBinds(), createRatingUpdateSql(), hasOwn(), isRatingAlgorithm(), normalizeRatingConfiguration(), normalizeRetryCount(), readMatchRecord() (+6 more)

### Community 81 - "TypeScript Config Refs"
Cohesion: 0.15
Nodes (12): compilerOptions, lib, outDir, rootDir, tsBuildInfoFile, extends, include, DOM (+4 more)

### Community 82 - "Custom Room Index Types"
Cohesion: 0.22
Nodes (7): CustomRoomIndexRecord, isJsonObject(), parseJsonObject(), parseJsonValue(), readIndexString(), requireJsonObject(), serializeJsonObject()

### Community 83 - "Room Snapshot Events"
Cohesion: 0.18
Nodes (7): createRoomSnapshotEvent(), getWebSocketRoomId(), hasWebSocketProtocol(), normalizeWebSocketError(), readLastRevision(), readPositiveHeader(), readWebSocketAttachment()

### Community 84 - "Test TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, composite, declaration, declarationMap, noEmit, types, extends, include (+4 more)

### Community 86 - "Body Types"
Cohesion: 0.15
Nodes (3): Body, Request, Response

### Community 89 - "Test Simulation"
Cohesion: 0.23
Nodes (9): formatMetric(), formatNumber(), formatSimulationOutput(), serializeSimulationResult(), SimulationOutput, summarizeSimulation(), DEFAULT_SIMULATION_POOL, replaySimulation() (+1 more)

### Community 90 - "Project Path References"
Cohesion: 0.21
Nodes (5): ADR-0004: 試合結果の信頼境界をサーバー側に置く, 代替案, 決定, 結果, 背景

### Community 91 - "Party Tests"
Cohesion: 0.29
Nodes (9): baseSnapshot(), cancelledTicket(), createFetch(), dissolvedSnapshot(), joinedSnapshot(), pool, reconnectOptions, waitingTicket() (+1 more)

### Community 93 - "Email Event Types"
Cohesion: 0.17
Nodes (6): EmailEvent, ExtendableEvent, FetchEvent, QueueEvent, ScheduledEvent, TailEvent

### Community 95 - "Rating Verification Scripts"
Cohesion: 0.17
Nodes (10): errors, migrationSql, migrationStatements, ratingSource, root, statementCount, statementsBlock, upgradeMigrationStatements (+2 more)

### Community 96 - "Project Path References"
Cohesion: 0.18
Nodes (11): ADR-0005: パーティーマッチングとチーム編成をパーティー単位のチケットで行う, D1 スキーマ変更, Match Pool チケットの N 人拡張, Party Durable Object, `revision` と再開トークンとの整合, 代替案, 後続 Issue への分割線, 探索幅とレーティング参照値 (+3 more)

### Community 97 - "TypeScript Config Refs"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, tsBuildInfoFile, types, extends, include, src/**/*.ts (+2 more)

### Community 98 - "Already Uploaded Error"
Cohesion: 0.18
Nodes (11): AlreadyUploadedError, BadRequestError, ForbiddenError, InternalError, InvalidURLError, MaxFileSizeError, NotFoundError, QuotaReachedError (+3 more)

### Community 99 - "Seeded Random Testing"
Cohesion: 0.25
Nodes (5): assertSeed(), createSeededRandom(), hashSeed(), SEEDED_RANDOM_ALGORITHM, SeededRandom

### Community 100 - "Docs Verification Scripts"
Cohesion: 0.24
Nodes (10): apiReference, errors, exportedNames(), markdownFiles, publicEntries, read(), requiredFiles, requireText() (+2 more)

### Community 101 - "Changeset Config"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 102 - "Project Path References"
Cohesion: 0.20
Nodes (10): Match Pool 状態遷移, Room 状態遷移, アーキテクチャ, コンポーネント境界, 保存境界, 再接続の順序, 対象外との境界, 整合性と冪等性 (+2 more)

### Community 103 - "Project Path References"
Cohesion: 0.20
Nodes (10): Issue #26 完了条件と検証先, v0.1.0 公開前チェック, Workers 横断統合テスト, シミュレーション, 固定時計と固定乱数, 実行, 文書コード例と公開契約の検証, 検索幅の比較と失敗ケースの再現 (+2 more)

### Community 104 - "Project Path References"
Cohesion: 0.20
Nodes (10): Changesets, Cloudflare Worker, FlareLobby, まず読む文書, パッケージ構成, 含まれないもの, 含まれるもの, 変更履歴、Release Note、ライセンス (+2 more)

### Community 105 - "Matchmaking Tests"
Cohesion: 0.27
Nodes (6): createFetch(), matchedTicket(), matchRoomSnapshot(), pool, waitingTicket(), webSocket

### Community 108 - "Rating Schema Upgrade"
Cohesion: 0.20
Nodes (10): applyRatingSchemaUpgrades(), assertUpgradeColumnsExist(), encodeHistoryCursor(), ensureRatingSchema(), isDuplicateColumnError(), listMatchHistory(), normalizeHistoryLimit(), readMatchRecords() (+2 more)

### Community 111 - "Test TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, extends, include, ./**/*.ts (+1 more)

### Community 112 - "Test TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, extends, include, ./**/*.ts (+1 more)

### Community 113 - "Community 113"
Cohesion: 0.28
Nodes (9): refreshRankedState(), refreshRating(), renderRankedResult(), setRankedMoveButtonsDisabled(), showMode(), startRankedPolling(), startSession(), stopRankedPolling() (+1 more)

### Community 114 - "Community 114"
Cohesion: 0.25
Nodes (8): DemoApp, DemoAssets, DemoEnv, demoWorker, gateway, lobby, readDemoPlayer(), FlareLobbyApp

### Community 115 - "Community 115"
Cohesion: 0.22
Nodes (9): ADR-0006: レーティング計算を Strategy として差し替え可能にし Glicko-2 を追加する, D1 永続化との整合, Strategy 境界, チーム対応の試合結果, 代替案, 決定, 結果, 背景 (+1 more)

### Community 116 - "Community 116"
Cohesion: 0.25
Nodes (9): HTTP 要求, WebSocket, カスタムルーム, クライアント基盤, テスト用差し替え, パーティー, マッチメイキング, 再接続と状態復元 (+1 more)

### Community 117 - "Community 117"
Cohesion: 0.22
Nodes (9): HTTP を直接使う場合, Room 操作と権限, カスタムルーム利用ガイド, スナップショットとイベント, 作成方式, 再接続, 参加・観戦, 基本利用 (+1 more)

### Community 118 - "Community 118"
Cohesion: 0.22
Nodes (9): 1. 依存関係を揃える, 2. ビルドと文書例の型検査, 3. ブラウザサンプルを起動する, 4. ヘルスチェックとカスタムルーム, 5. ローカル Migration, 6. ローカル検証, staging/production への準備, つまずきやすい点 (+1 more)

### Community 119 - "Community 119"
Cohesion: 0.22
Nodes (8): ログ・エラーコード, 再現手順, 完了条件, 実際の動作, 最小再現コードまたはテスト, 期待する動作, 概要, 環境

### Community 120 - "Community 120"
Cohesion: 0.22
Nodes (8): 利用者のシナリオ, 含めないもの, 含めるもの, 完了条件, 対象範囲, 提案する公開 API または文書, 背景と目的, 設計の正本 #1 との関係

### Community 125 - "Community 125"
Cohesion: 0.22
Nodes (3): ByteLengthQueuingStrategy, CountQueuingStrategy, QueuingStrategy

### Community 132 - "Community 132"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 133 - "Community 133"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 134 - "Community 134"
Cohesion: 0.28
Nodes (8): aggregate, metrics, newline, output, percentage(), reportPaths, reports, row()

### Community 135 - "Community 135"
Cohesion: 0.25
Nodes (8): APIと責務, デプロイ前の確認, ランク戦, ローカルじゃんけんサンプル, 切断と再接続, 招待ルーム, 画面で確認する導線, 起動

### Community 136 - "Community 136"
Cohesion: 0.25
Nodes (8): Party Durable Object, チケット状態, パーティー単位のチケット, マッチングプール、候補探索、チケット, 候補探索, 冪等性と競合, 成立処理と対戦 Room, 期限と通知

### Community 137 - "Community 137"
Cohesion: 0.25
Nodes (8): ELO と試合結果, Pool を設定する, イベント接続, チケットを待つ, マッチメイキング利用ガイド, 期限と整合性, 短縮 API、キャンセル、再接続, 関連文書

### Community 138 - "Community 138"
Cohesion: 0.25
Nodes (8): FlareLobby v0.1.0 Release Note, 主な機能, 公開前検証, 公開対象 package, 公開状態, 対象外, 既知の制限, 許容した診断と理由

### Community 139 - "Community 139"
Cohesion: 0.25
Nodes (7): 共通入力検証, 利用制限, 参加用・再開用トークン, 秘密値と運用上の前提, 認可 Hook, 認証・認可・入力検証・利用制限, 認証主体の境界

### Community 142 - "Community 142"
Cohesion: 0.39
Nodes (6): flarelobby_rating_match_participants, flarelobby_rating_matches, flarelobby_rating_seasons, flarelobby_ratings, flarelobby_team_rating_match_participants, flarelobby_team_rating_matches

### Community 143 - "Community 143"
Cohesion: 0.36
Nodes (8): asRecord(), findExistingMatch(), firstResultRow(), isFiniteNumber(), readRatingState(), readTeamRatingState(), toRatingRow(), toSeasonRow()

### Community 144 - "Community 144"
Cohesion: 0.36
Nodes (8): createDeviationBinds(), createRatingInsert(), ensureRatingRows(), ensureTeamRatingRows(), getRating(), normalizeRatingError(), readRatingRow(), toRating()

### Community 150 - "Community 150"
Cohesion: 0.29
Nodes (7): Cloudflare 設定, D1 Migration, Secret, wrangler.jsonc, アプリケーション設定との関係, デプロイ, 必要な Binding

### Community 151 - "Community 151"
Cohesion: 0.29
Nodes (7): JSON 通信プロトコル v1, エンコード、デコード、検証, コマンド, サーバーイベント, 公開エラー, 共通 Envelope, 成功応答と失敗応答

### Community 152 - "Community 152"
Cohesion: 0.29
Nodes (7): D1 への永続化, ELO の利用, Glicko-2 の利用, チーム対応の試合結果, レーティングエンジン, 入力検証, 計算式と丸め

### Community 153 - "Community 153"
Cohesion: 0.29
Nodes (6): 変更内容, 完了条件, 対応 Issue, 検証, 概要, 設計・公開契約への影響

### Community 154 - "Community 154"
Cohesion: 0.29
Nodes (6): ignorePatterns, packages/cloudflare/worker-configuration.d.ts, printWidth, proseWrap, $schema, sortPackageJson

### Community 155 - "Community 155"
Cohesion: 0.38
Nodes (5): createGatewayPrincipal(), createPartyWithLeader(), DurableObjectSqlBoundary, newPartyId(), TestMember

### Community 161 - "Community 161"
Cohesion: 0.33
Nodes (5): calculation, decoded, policy, revision, width

### Community 162 - "Community 162"
Cohesion: 0.33
Nodes (5): ADR-0001: Durable Object と SQLite を正本にする, 代替案, 決定, 結果, 背景

### Community 163 - "Community 163"
Cohesion: 0.33
Nodes (5): ADR-0002: `revision` と再開トークンで再接続する, 代替案, 決定, 結果, 背景

### Community 164 - "Community 164"
Cohesion: 0.33
Nodes (5): ADR-0003: 公開ルーム一覧を D1 の投影にする, 代替案, 決定, 結果, 背景

### Community 165 - "Community 165"
Cohesion: 0.33
Nodes (5): クエリ, 一貫性と再試行, 公開カスタムルーム一覧, 応答と秘密情報, 検証

### Community 166 - "Community 166"
Cohesion: 0.33
Nodes (5): ゲーム固有型の指定, マッチングチケット状態, ルーム状態, 公開ドメイン型, 用語と型の対応

### Community 167 - "Community 167"
Cohesion: 0.33
Nodes (5): Analytics Engine, サンプリング, 構造化ログ, 秘匿方針, 観測基盤

### Community 178 - "Community 178"
Cohesion: 0.50
Nodes (4): ExampleApp, getAccessToken(), lobby, stop

### Community 179 - "Community 179"
Cohesion: 0.50
Nodes (4): createMatchedPair(), requestAs(), RpsResponse, TicketResponse

### Community 180 - "Community 180"
Cohesion: 0.40
Nodes (4): カスタムルームの参加・退出・観戦, 参加, 検証, 退出と通信切断

### Community 181 - "Community 181"
Cohesion: 0.40
Nodes (5): devEngines, runtime, name, onFail, version

### Community 199 - "Community 199"
Cohesion: 0.40
Nodes (3): commandEnvironment, outputDirectory, root

### Community 226 - "Community 226"
Cohesion: 0.67
Nodes (3): renderCustomResult(), resolveResult(), submitCustomMove()

### Community 228 - "Community 228"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 231 - "Community 231"
Cohesion: 0.67
Nodes (3): BasicImageTransformations, RequestInitCfPropertiesImage, RequestInitCfPropertiesImageDraw

### Community 248 - "Community 248"
Cohesion: 0.67
Nodes (3): RequestInitCfPropertiesVaryAcceptHeader, RequestInitCfPropertiesVaryAcceptLanguageHeader, RequestInitCfPropertiesVaryHeader

## Knowledge Gaps
- **1713 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+1708 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **160 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RoomDurableObject` connect `Room Lifecycle` to `RPS Game Client Types`, `Room Management`, `Durable Objects Rate Limiting`, `Custom Room Index`, `Room Waiting State`, `Integration Tests`, `Community 114`, `Custom Room Index Types`, `FlareLobby Configuration`, `Room Snapshot Events`, `WebSocket Testing`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `MatchPoolDurableObject` connect `Match Pool Durable Object` to `RPS Game Client Types`, `Match Pool Durable Object Alarm`, `Match Pool & Matchmaking`, `Durable Objects Rate Limiting`, `Match Pool Durable Object Tick`, `Type Testing`, `Room Lifecycle`, `Community 114`, `FlareLobby Configuration`, `Match Pool Tests`, `Match Pool Durable Object`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `defineFlareLobby()` connect `Type Testing` to `RPS Game Client Types`, `Durable Objects Rate Limiting`, `Custom Room Index`, `Integration Tests`, `Matchmaking Gateway Tests`, `Party Gateway`, `Community 114`, `FlareLobby Configuration`, `Rating Tests`, `WebSocket Testing`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _1713 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cloudflare Worker Types & AI Models` be split into smaller, more focused modules?**
  _Cohesion score 0.002347417840375587 - nodes in this community are weakly interconnected._
- **Should `RPS Game Client Types` be split into smaller, more focused modules?**
  _Cohesion score 0.050042955326460484 - nodes in this community are weakly interconnected._
- **Should `Party System Core` be split into smaller, more focused modules?**
  _Cohesion score 0.07335280753002273 - nodes in this community are weakly interconnected._