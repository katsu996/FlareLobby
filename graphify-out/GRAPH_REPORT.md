# Graph Report - FlareLobby  (2026-08-28)

## Corpus Check
- 161 files · ~213,331 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4570 nodes · 8058 edges · 273 communities (124 shown, 149 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 96 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Cloudflare Workers Config Types
- FlareLobby Configuration & Security
- Room Core & Validation
- Party System
- Documentation & ADRs
- Custom Room Server
- RPS Demo Game
- Match Pool Core
- Core Matchmaking Types
- Matchmaking Orchestration
- Custom Room Index
- Protocol & Error Codes
- Client WebSocket & Matchmaking
- Room Durable Object
- Client API Entry Point
- Client Party System
- Core App Types
- Client Custom Room
- Match Pool Durable Object
- Client Room Implementation
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
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
- `@flarelobby/testing Package` --implements--> `Virtual Clock for Testing`  [INFERRED]
  README.md → docs/api-reference.md
- `handleDemoRpsRequest()` --calls--> `createErrorResponse()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/security.ts
- `readMatchedPlayers()` --calls--> `createMatchmakingPoolKey()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/match-pool.ts
- `acceptRpsMove()` --calls--> `registerMatchResult()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/rating.ts
- `acceptRpsMove()` --calls--> `createErrorResponse()`  [EXTRACTED]
  examples/local-demo/src/rps.ts → packages/cloudflare/src/security.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Party Feature Ecosystem** — changeset_party_client_sdk, changeset_party_gateway_fixes, changeset_party_leave_replay_fix, changeset_party_matching_server, changeset_party_client_create_party, changeset_party_client_get_party, changeset_party_client_join_party, changeset_party_client_party_handle, changeset_party_client_invite, changeset_party_client_leave, changeset_party_client_transfer_leadership, changeset_party_client_dissolve, changeset_party_client_join_ranked_queue, changeset_party_client_cancel_queue, changeset_party_client_join_matchmaking_party_id, changeset_party_client_event_connection, changeset_party_client_history_replay, party_gateway_post_v1_parties, party_gateway_party_id_generation, party_gateway_get_v1_parties_events_ws, party_gateway_websocket_auth_fix, party_gateway_matchmaking_websocket_pattern, party_leave_leave_party_function, party_leave_request_id_idempotency, party_leave_party_snapshot, party_leave_dissolved_null_response, party_matching_party_durable_object, party_matching_party_membership_durable_object, party_matching_single_use_token_invitation, party_matching_monotonic_revision, party_matching_one_party_per_principal, party_matching_matchmaking_pool_extension, party_matching_max_party_size, party_matching_team_size, party_matching_party_composition_freeze, party_matching_double_queue_prevention, party_matching_gateway_v1_parties_api, party_matching_ticket_creation_party_id, party_matching_d1_migration_0004, party_matching_register_team_match_result, party_matching_n_participant_results, party_matching_one_vs_one_api_preserved [INFERRED 0.85]
- **Glicko-2 Rating Strategy Ecosystem** — changeset_rating_strategy_glicko2, rating_strategy_adr_0006, changeset_rating_strategy_glicko2_function, rating_strategy_rd_volatility, rating_strategy_calculate_deviation_params, rating_strategy_rating_calculation_delta_b, rating_strategy_elo_delta_sum_zero, changeset_rating_strategy_glicko2_independent_updates, rating_strategy_pool_config_algorithm, rating_strategy_d1_rd_volatility_season, rating_strategy_idempotent_result_registration, rating_strategy_d1_migration_0005, rating_strategy_existing_rows_elo_default [INFERRED 0.85]
- **Release and CI/CD Pipeline** — changeset_readme, changeset_pnpm_changeset_command, changeset_pnpm_version_packages_command, changeset_pnpm_release_check_command, changeset_public_scoped_packages, v010_release, v010_public_packages, v010_mit_license, v010_package_readme, v010_npm_publish_dry_run, v010_cloudflare_deploy_dry_run, v010_changelog, v010_release_note, v010_empty_changeset, coderabbit_yaml_config, coderabbit_auto_review_enabled, coderabbit_base_branches_regex [INFERRED 0.75]
- **ADR Series (0001-0006)** — docs_adr_0001_durable_object_sqlite, docs_adr_0002_reconnect_and_revision, docs_adr_0003_public_room_index, docs_adr_0004_match_result_trust_boundary, docs_adr_0005_party_matching_and_team_composition, docs_adr_0006_rating_strategy_and_glicko2 [EXTRACTED 1.00]
- **Core Durable Objects Architecture** — room_durable_object, match_pool_durable_object, party_durable_object, rate_limit_durable_object [INFERRED 0.85]
- **FlareLobby Package Ecosystem** — package_core, package_cloudflare, package_client, package_testing, example_local_demo [EXTRACTED 1.00]

## Communities (273 total, 149 thin omitted)

### Community 0 - "Cloudflare Workers Config Types"
Cohesion: 0.00
Nodes (848): RFC-2253, RFC-3339, RFC-5246, RFC-9440, AgentMemoryGetSummaryOptions, AgentMemoryGetSummaryResponse, AgentMemoryIncomingMemory, AgentMemoryIngestOptions (+840 more)

### Community 1 - "FlareLobby Configuration & Security"
Cohesion: 0.06
Nodes (78): consumeRateLimit(), consumeRoomCreationRateLimit(), consumeWebSocketMessageRateLimit(), FlareLobbyConfiguration, FlareLobbyObservabilityConfiguration, FlareLobbyObservabilityContextOptions, RoomOperationResult, RoomScheduledOperationKind (+70 more)

### Community 2 - "Room Core & Validation"
Cohesion: 0.05
Nodes (83): assertJoinCredentials(), AuthenticatedRoomActor, decodeBase64Url(), digestPassword(), encodeBase64Url(), hashRoomPassword(), isJsonValue(), isNonEmptyString() (+75 more)

### Community 3 - "Party System"
Cohesion: 0.07
Nodes (35): compareStrings(), DEFAULT_PARTY_IDLE_TTL_MS, DEFAULT_PARTY_INVITE_TTL_MS, DEFAULT_PARTY_MAX_SIZE, EventRow, InviteRow, isNonEmptyString(), MatchPoolCancellationStub (+27 more)

### Community 4 - "Documentation & ADRs"
Cohesion: 0.06
Nodes (73): Async D1 Synchronization, Authentication Hook, Authorization Hook, Changelog, Changesets for Versioning, CI Verification Steps, Codecov Configuration, Coverage Thresholds (70% patch, 1% project) (+65 more)

### Community 5 - "Custom Room Server"
Cohesion: 0.06
Nodes (67): createCustomRoom(), createInvitationCode(), createPasswordFingerprint(), createWebSocketUrl(), CustomRoomCreationInput, CustomRoomCreationOptions, CustomRoomCreationResponse, CustomRoomCreationResult (+59 more)

### Community 6 - "RPS Demo Game"
Cohesion: 0.06
Nodes (58): acceptRpsMove(), DEMO_RANKED_POOL_ID, ensureRpsMatch(), createRpsResultId(), getRpsOutcome(), isRatingResult(), isRpsMove(), resolveRpsResult() (+50 more)

### Community 7 - "Match Pool Core"
Cohesion: 0.04
Nodes (53): createMatchPoolKey, createMatchRoomInitialization(), DEFAULT_MATCHMAKING_MATCH_MAX_ATTEMPTS, DEFAULT_MATCHMAKING_MATCH_MAX_RETRY_DELAY_MS, DEFAULT_MATCHMAKING_MATCH_RETRY_DELAY_MS, DEFAULT_MATCHMAKING_MATCH_TEAM_IDS, DEFAULT_MATCHMAKING_TICKET_TTL_MS, EventRow (+45 more)

### Community 8 - "Core Matchmaking Types"
Cohesion: 0.07
Nodes (58): JsonObject, MatchCandidate, MatchmakingTicketId, Player, PlayerId, Rating, Timestamp, averageMemberRating() (+50 more)

### Community 9 - "Matchmaking Orchestration"
Cohesion: 0.08
Nodes (51): ADR-0004, MatchmakingMatchIntent, MatchmakingTicketRecord, MatchPoolInitializationOptions, cancelTicket(), createMatchmakingPoolKey(), createMatchRoomConnection(), createRoomWebSocketUrl() (+43 more)

### Community 10 - "Custom Room Index"
Cohesion: 0.06
Nodes (50): CUSTOM_ROOM_INDEX_RETRY_DELAY_MS, CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID, CustomRoomIndexJoinMethod, CustomRoomIndexRow, deleteCustomRoomIndex(), ensureCustomRoomIndex(), ensureCustomRoomInvitationIndex(), ensureOnce() (+42 more)

### Community 11 - "Protocol & Error Codes"
Cohesion: 0.06
Nodes (48): JsonValue, Revision, classifyEventRevision(), ClientCommandEnvelope, decodeClientCommand(), decodeProtocolMessage(), decodeServerMessage(), defaultErrorMessages (+40 more)

### Community 12 - "Client WebSocket & Matchmaking"
Cohesion: 0.07
Nodes (10): ClientRequestOptions, ClientWebSocketOptions, FlareLobbyWebSocketConnection, createRoomHandle(), CustomRoomTransport, isRetryableReconnectError(), isTerminalStatus(), MatchmakingTicketImpl (+2 more)

### Community 13 - "Room Durable Object"
Cohesion: 0.13
Nodes (5): assertActiveRoom(), assertWaitingRoom(), getDisconnectOperationId(), normalizeOperationRequest(), RoomDurableObject

### Community 14 - "Client API Entry Point"
Cohesion: 0.07
Nodes (28): ClientEventListener, COMPATIBLE_PROTOCOLS, createErrorWithRequestId(), createRequestId(), createWebSocketProtocols(), effectivePort(), encodeBase64Url(), FlareLobbyClientImpl (+20 more)

### Community 15 - "Client Party System"
Cohesion: 0.09
Nodes (15): NormalizedReconnectOptions, assertPartyId(), compactJsonObject(), createPartyApi(), createPartyPath(), createRequestId(), isCancelledError(), isNonEmptyString() (+7 more)

### Community 16 - "Core App Types"
Cohesion: 0.05
Nodes (49): AnyFlareLobbyApp, AppBound, AppGameMessages, AppRoomMetadata, AppRoomSettings, CancelledMatchmakingTicket, CreatingMatchmakingTicket, CustomRoom (+41 more)

### Community 17 - "Client Custom Room"
Cohesion: 0.11
Nodes (39): RoomConnectionResult, RoomCreationConnectionResult, compactJsonObject(), createMatchmakingApi(), createPoolPath(), createRequestId(), createTicketPath(), deepFreeze() (+31 more)

### Community 18 - "Match Pool Durable Object"
Cohesion: 0.11
Nodes (8): MatchPoolDurableObject, normalizePositiveSafeInteger(), normalizeSearchNow(), parseSearchPolicy(), toPool(), createObservabilityContext(), createObservabilitySink(), normalizeSampleRate()

### Community 19 - "Client Room Implementation"
Cohesion: 0.10
Nodes (5): compactJsonObject(), freezeSnapshot(), isHostSnapshot(), isRetryableReconnectError(), RoomImpl

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (7): AbortSignal, EventSource, EventTarget, MessagePort, ServiceWorkerGlobalScope, WebSocket, WorkerGlobalScope

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (33): authenticateDemoRpsRequest(), handlePartyRequest(), normalizeGatewayError(), notFound(), parsePartyJsonBody(), parsePartyRoute(), PartyEventsWebSocketRoute, PartyGatewayStub (+25 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (43): author, bugs, url, dependencies, @flarelobby/core, description, devDependencies, @flarelobby/client (+35 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (32): MatchedPlayers, assertCustomRoomConfiguration(), assertInputLimits(), assertMatchmakingPools(), assertObservabilityConfiguration(), createGatewayWorker(), CUSTOM_ROOM_OPERATION_PATH_PATTERNS, CustomRoomConfiguration (+24 more)

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (42): ClientCommandOptions, appendQueryValue(), createCreationBody(), createCustomRoom(), createCustomRoomApi(), createJoinBody(), CustomRoomJoinMethod, CustomRoomParticipantRole (+34 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (39): FlareLobbyClientOptions, RoomReconnectOptions, MatchmakingProgress, MatchmakingProgressListener, MatchmakingResult, MatchmakingTicketCancelOptions, MatchmakingTicketConnectionStatus, MatchmakingTicketConnectionStatusListener (+31 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (41): applyMatchResult, compareStrings(), DEFAULT_RATING_CONFLICT_RETRY_COUNT, getPlayerRating, HistoryCursor, MatchHistoryPage, MatchHistoryQuery, MatchResultRegistration (+33 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (37): appScreen, customConnection, customInvitationCode, customMoveActions, customMoves, customPanel, customParticipants, customReady (+29 more)

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (37): author, bugs, url, dependencies, @flarelobby/core, description, exports, files (+29 more)

### Community 29 - "Community 29"
Cohesion: 0.05
Nodes (37): author, bugs, url, dependencies, @flarelobby/core, description, exports, files (+29 more)

### Community 30 - "Community 30"
Cohesion: 0.06
Nodes (35): author, bugs, url, description, devDependencies, @vitest/coverage-v8, exports, files (+27 more)

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (25): RoomScheduledOperation, createRequest(), createRoom(), joinRoom(), leaveRoom(), operationRequest(), testLobby, testWorker (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.06
Nodes (6): CloseEvent, CustomEvent, ErrorEvent, Event, MessageEvent, PromiseRejectionEvent

### Community 33 - "Community 33"
Cohesion: 0.08
Nodes (12): createFlareLobbyClient(), FetchImplementation, WebSocketConstructor, fakeWebSocketConstructor, createClient(), webSocket, createClient(), createSnapshot() (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (27): attachObservabilityHeaders(), FLARE_LOBBY_ANALYTICS_SAMPLED_HEADER, FLARE_LOBBY_CORRELATION_ID_HEADER, FLARE_LOBBY_LOG_SAMPLED_HEADER, FLARE_LOBBY_OBSERVABILITY_SCHEMA_VERSION, FLARE_LOBBY_OPERATION_HEADER, FLARE_LOBBY_REQUEST_ID_HEADER, FlareLobbyObservabilityAttributeValue (+19 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (5): FlareLobbyClient, MatchmakingJoinOptions, MatchmakingPoolReference, MatchmakingTicket, Party

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (9): CustomRoomCreationOptions, CustomRoomJoinOptions, HostRoom, PlayerRoom, Room, RoomSubscriptionApi, SpectatorRoom, MatchmakingClientApi (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.15
Nodes (28): assertNonEmptyString(), assertRecord(), compareSearchPolicies(), compareWorkingTickets(), createDistributionStatistics(), createReplayConfig(), createStatistics(), deepFreeze() (+20 more)

### Community 38 - "Community 38"
Cohesion: 0.07
Nodes (27): GameMessage, InferFlareLobbyApp, MatchmakingTicket, RoomSnapshot, RoomState, RoomStatus, _appCanBeInferredFromMessage, _appCanBeInferredFromSnapshot (+19 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (19): createMatchmakingMatchId(), createMatchmakingRoomId(), createMatchRoomRecord(), MATCHMAKING_POOL_KEY_SEPARATOR, MatchmakingMatchResult, MatchmakingTicketEventQueryOptions, parseJsonObject(), parseMatchRoomOptions() (+11 more)

### Community 40 - "Community 40"
Cohesion: 0.16
Nodes (3): PartyQueueStub, recordQualityMetric(), PartyQueueStartResult

### Community 41 - "Community 41"
Cohesion: 0.10
Nodes (26): NormalizedPlayerGenerationOptions, NumericDistribution, PlayerGenerationOptions, SimulationPlayer, TimestampDistribution, RandomSeed, DEFAULT_SIMULATION_DURATION_MS, DEFAULT_SIMULATION_TICK_MS (+18 more)

### Community 42 - "Community 42"
Cohesion: 0.12
Nodes (3): errorForWebSocketCloseCode(), FlareLobbyWebSocketConnectionImpl, RawJsonEventConnectionImpl

### Community 43 - "Community 43"
Cohesion: 0.10
Nodes (15): boot(), ClientMock, createRoom(), customMoveButtons, element(), elements, FakeClassList, FakeElement (+7 more)

### Community 44 - "Community 44"
Cohesion: 0.08
Nodes (25): scripts, build, changeset, check:deploy, check:docs, check:esm, check:packages, check:rating-schema (+17 more)

### Community 45 - "Community 45"
Cohesion: 0.24
Nodes (23): createMatchmakingPoolKey(), deepFreeze(), isGatewayPrincipalEnvelope(), isNonEmptyString(), isRecord(), isTimestamp(), normalizeCandidate(), normalizeCreation() (+15 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (14): closeWebSocketSafely(), createRoomSnapshotEvent(), createWebSocketTags(), getParticipantWebSocketTag(), getPrincipalWebSocketTag(), getResumeWebSocketTag(), getRoleWebSocketTag(), getRoomWebSocketTag() (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (12): activeClients, createClient(), createCloseEvent(), createMatchedRooms(), EventListener, integrationLobby, integrationPool, integrationWorker (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (23): compilerOptions, composite, declaration, declarationMap, lib, noEmit, paths, extends (+15 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (23): esbuild, dependencies, @flarelobby/client, @flarelobby/cloudflare, @flarelobby/core, devDependencies, esbuild, vitest (+15 more)

### Community 50 - "Community 50"
Cohesion: 0.14
Nodes (11): addMilliseconds(), AdvancingClock, Clock, createVirtualClock(), isNonNegativeSafeInteger(), isValidDateMilliseconds(), toEpochMilliseconds(), VirtualClock (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (18): assertFiniteNumber(), assertNonEmptyString(), clamp(), compareStrings(), generateSimulationPlayers(), isFiniteNonNegativeNumber(), isNonEmptyString(), isNonNegativeSafeInteger() (+10 more)

### Community 52 - "Community 52"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, composite, declaration, declarationMap, lib, noEmit, paths (+13 more)

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (10): baseSnapshot(), cancelledTicket(), createFetch(), dissolvedSnapshot(), FakeWebSocket, joinedSnapshot(), pool, reconnectOptions (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.09
Nodes (21): compilerOptions, composite, declaration, declarationMap, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (9): defineFlareLobby(), getMatchHistory, createResultLobby(), createGatewayPrincipal(), createGatewayWorker(), FakePreparedStatement, FakeSchemaDatabase, readStoredRating() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.14
Nodes (7): createFetch(), FakeWebSocket, matchedTicket(), matchRoomSnapshot(), pool, waitingTicket(), webSocket

### Community 58 - "Community 58"
Cohesion: 0.10
Nodes (7): CompressionStream, DecompressionStream, FixedLengthStream, IdentityTransformStream, TextDecoderStream, TextEncoderStream, TransformStream

### Community 60 - "Community 60"
Cohesion: 0.11
Nodes (17): compilerOptions, composite, lib, module, moduleResolution, noEmit, paths, extends (+9 more)

### Community 61 - "Community 61"
Cohesion: 0.24
Nodes (18): cancelRankedQueue(), createCustomRoom(), createRequestId(), displayPlayer(), element(), getClient(), isCancelled(), isMove() (+10 more)

### Community 62 - "Community 62"
Cohesion: 0.12
Nodes (9): FlareLobbyGatewayWorker, createGatewayPrincipal(), createInitializedPool(), createTestParty(), deniedWorker, PartyUnderTest, resultSoloPool, resultTeamPool (+1 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (17): @changesets/cli, @cloudflare/vitest-pool-workers, oxfmt, oxlint, devDependencies, @changesets/cli, @cloudflare/vitest-pool-workers, oxfmt (+9 more)

### Community 64 - "Community 64"
Cohesion: 0.19
Nodes (17): asRecord(), findExistingMatch(), findExistingTeamMatch(), firstResultRow(), isFiniteNumber(), isNonNegativeSafeInteger(), isRatingResult(), isSafeInteger() (+9 more)

### Community 65 - "Community 65"
Cohesion: 0.17
Nodes (16): Party Matching Server Implementation, ADR-0005 Party Matching Server Design, D1 migration 0004_team_rating.sql, Double queue prevention, MatchmakingPool extension for party tickets, maxPartySize configuration, Monotonic revision and event sync, N-participant result registration (+8 more)

### Community 66 - "Community 66"
Cohesion: 0.12
Nodes (15): compilerOptions, composite, noEmit, paths, extends, include, ../../packages/cloudflare/src/index.ts, ../../packages/cloudflare/worker-configuration.d.ts (+7 more)

### Community 67 - "Community 67"
Cohesion: 0.17
Nodes (8): CustomRoomIndexRecord, isJsonObject(), parseJsonObject(), parseJsonValue(), parseRoomSnapshotResult(), readIndexString(), requireJsonObject(), serializeJsonObject()

### Community 68 - "Community 68"
Cohesion: 0.20
Nodes (10): developmentLobby, allowedRateLimitDecision(), deniedRateLimitDecision(), isPositiveSafeInteger(), isRateLimitScope(), RateLimitDurableObject, RateLimitOwnerRow, RateLimitRow (+2 more)

### Community 70 - "Community 70"
Cohesion: 0.18
Nodes (15): applyRatingSchemaUpgrades(), assertUpgradeColumnsExist(), createRatingEngine(), createRatingUpdateExtraBinds(), createRatingUpdateSql(), ensureRatingSchema(), hasOwn(), isDuplicateColumnError() (+7 more)

### Community 72 - "Community 72"
Cohesion: 0.14
Nodes (13): archiveDirectory, changelog, changeset, changesetConfig, errors, packages, read(), readJson() (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.21
Nodes (14): Rating Strategy Glicko-2 Implementation, glicko2() strategy function, Glicko-2 independent uncertainty-based updates, @flarelobby/core package, ADR-0006 Rating Strategy Glicko-2 Design, calculate() with deviationA/deviationB parameters, D1 migration 0005_rating_algorithm.sql, D1 storage for RD, volatility, and Season mode (+6 more)

### Community 74 - "Community 74"
Cohesion: 0.14
Nodes (13): author, bugs, url, description, engines, node, homepage, license (+5 more)

### Community 75 - "Community 75"
Cohesion: 0.14
Nodes (13): compilerOptions, composite, declaration, declarationMap, lib, noEmit, extends, include (+5 more)

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (12): compilerOptions, lib, outDir, rootDir, tsBuildInfoFile, extends, include, DOM (+4 more)

### Community 81 - "Community 81"
Cohesion: 0.18
Nodes (10): getPartyWebSocketRoute(), baseConfiguration, createParty(), fetchWorker(), listEventTypes(), PartyMemberResponse, PartySnapshotResponse, pool (+2 more)

### Community 82 - "Community 82"
Cohesion: 0.15
Nodes (12): compilerOptions, composite, declaration, declarationMap, noEmit, types, extends, include (+4 more)

### Community 84 - "Community 84"
Cohesion: 0.15
Nodes (3): Body, Request, Response

### Community 87 - "Community 87"
Cohesion: 0.23
Nodes (9): formatMetric(), formatNumber(), formatSimulationOutput(), serializeSimulationResult(), SimulationOutput, summarizeSimulation(), DEFAULT_SIMULATION_POOL, replaySimulation() (+1 more)

### Community 88 - "Community 88"
Cohesion: 0.18
Nodes (12): cancelQueue function, createParty function, Event connection for party members, getParty function, History replay from last event number on reconnect, joinMatchmaking partyId option, joinParty function, joinRankedQueue function (+4 more)

### Community 89 - "Community 89"
Cohesion: 0.18
Nodes (10): isAllowedTransition(), isRoomStatus(), isValidTimestamp(), normalizeCloseOptions(), normalizeHostOperationBase(), normalizeOperationTimestamp(), normalizeStartMatchOptions(), normalizeTransferHostOptions() (+2 more)

### Community 91 - "Community 91"
Cohesion: 0.17
Nodes (6): EmailEvent, ExtendableEvent, FetchEvent, QueueEvent, ScheduledEvent, TailEvent

### Community 93 - "Community 93"
Cohesion: 0.17
Nodes (10): errors, migrationSql, migrationStatements, ratingSource, root, statementCount, statementsBlock, upgradeMigrationStatements (+2 more)

### Community 94 - "Community 94"
Cohesion: 0.18
Nodes (10): EnvWithoutD1, Equal, ExampleApp, Expect, fullConfiguration, fullWorker, _generatedEnvSatisfiesBindingContract, invalidSettings (+2 more)

### Community 95 - "Community 95"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, tsBuildInfoFile, types, extends, include, src/**/*.ts (+2 more)

### Community 96 - "Community 96"
Cohesion: 0.18
Nodes (11): AlreadyUploadedError, BadRequestError, ForbiddenError, InternalError, InvalidURLError, MaxFileSizeError, NotFoundError, QuotaReachedError (+3 more)

### Community 97 - "Community 97"
Cohesion: 0.25
Nodes (5): assertSeed(), createSeededRandom(), hashSeed(), SEEDED_RANDOM_ALGORITHM, SeededRandom

### Community 98 - "Community 98"
Cohesion: 0.24
Nodes (10): apiReference, errors, exportedNames(), markdownFiles, publicEntries, read(), requiredFiles, requireText() (+2 more)

### Community 99 - "Community 99"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 100 - "Community 100"
Cohesion: 0.24
Nodes (10): dissolve method on Party handle, invite method on Party handle, leave method on Party handle, Party handle, transferLeadership method on Party handle, Party Leave Replay Idempotency Fix, Null response on party dissolution, leaveParty function (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (10): MatchmakingMatchProcessingOptions, MatchmakingSearchOptions, MatchmakingTicketCancellationOptions, MatchmakingTicketCreationOptions, MatchmakingTicketMatchOptions, MatchmakingTicketReservationOptions, FlareLobbyObservabilityContext, RoomParticipantOperationOptions (+2 more)

### Community 104 - "Community 104"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, extends, include, ./**/*.ts (+1 more)

### Community 105 - "Community 105"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, extends, include, ./**/*.ts (+1 more)

### Community 106 - "Community 106"
Cohesion: 0.28
Nodes (9): refreshRankedState(), refreshRating(), renderRankedResult(), setRankedMoveButtonsDisabled(), showMode(), startRankedPolling(), startSession(), stopRankedPolling() (+1 more)

### Community 107 - "Community 107"
Cohesion: 0.25
Nodes (8): DemoApp, DemoAssets, DemoEnv, demoWorker, gateway, lobby, readDemoPlayer(), FlareLobbyApp

### Community 110 - "Community 110"
Cohesion: 0.22
Nodes (4): getMatchSettlementErrorCode(), getMatchSettlementRetryDelay(), isRetryableMatchSettlementError(), normalizeMatchIntentIdentifier()

### Community 111 - "Community 111"
Cohesion: 0.33
Nodes (9): encodeHistoryCursor(), isNonEmptyString(), isRecord(), listMatchHistory(), normalizeHistoryLimit(), normalizeIdentifier(), normalizeMatchResultInput(), normalizePool() (+1 more)

### Community 113 - "Community 113"
Cohesion: 0.22
Nodes (3): ByteLengthQueuingStrategy, CountQueuingStrategy, QueuingStrategy

### Community 120 - "Community 120"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 121 - "Community 121"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, tsBuildInfoFile, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 122 - "Community 122"
Cohesion: 0.28
Nodes (8): aggregate, metrics, newline, output, percentage(), reportPaths, reports, row()

### Community 123 - "Community 123"
Cohesion: 0.39
Nodes (6): flarelobby_rating_match_participants, flarelobby_rating_matches, flarelobby_rating_seasons, flarelobby_ratings, flarelobby_team_rating_match_participants, flarelobby_team_rating_matches

### Community 124 - "Community 124"
Cohesion: 0.36
Nodes (8): createDeviationBinds(), createRatingInsert(), ensureRatingRows(), ensureTeamRatingRows(), getRating(), normalizeRatingError(), readRatingRow(), toRating()

### Community 125 - "Community 125"
Cohesion: 0.29
Nodes (5): createTicket(), fetchWorker(), pool, testLobby, testWorker

### Community 131 - "Community 131"
Cohesion: 0.38
Nodes (7): Party Gateway Fixes, @flarelobby/cloudflare package, Matchmaking WebSocket pattern (Gateway Token conversion), Gateway Party ID generation, POST /v1/parties endpoint, WebSocket authentication fix (subprotocol token validation), Gateway /v1/parties HTTP API

### Community 132 - "Community 132"
Cohesion: 0.29
Nodes (6): ignorePatterns, packages/cloudflare/worker-configuration.d.ts, printWidth, proseWrap, $schema, sortPackageJson

### Community 133 - "Community 133"
Cohesion: 0.29
Nodes (3): createRoomState(), deepFreeze(), deleteRoomState()

### Community 139 - "Community 139"
Cohesion: 0.33
Nodes (5): calculation, decoded, policy, revision, width

### Community 140 - "Community 140"
Cohesion: 0.33
Nodes (6): Feature request completion criteria checklist, Design Source of Truth #1 consistency check, Feature Request Template, Blank issues disabled, 設計の正本 #1 (Design Source of Truth #1), GitHub Issue Template Configuration

### Community 151 - "Community 151"
Cohesion: 0.40
Nodes (5): pnpm changeset command, pnpm release:check command, pnpm version-packages command, Public Scoped Packages Configuration, Changesets Workflow Documentation

### Community 152 - "Community 152"
Cohesion: 0.50
Nodes (4): ExampleApp, getAccessToken(), lobby, stop

### Community 153 - "Community 153"
Cohesion: 0.50
Nodes (4): createMatchedPair(), requestAs(), RpsResponse, TicketResponse

### Community 154 - "Community 154"
Cohesion: 0.40
Nodes (5): devEngines, runtime, name, onFail, version

### Community 172 - "Community 172"
Cohesion: 0.40
Nodes (3): commandEnvironment, outputDirectory, root

### Community 173 - "Community 173"
Cohesion: 0.83
Nodes (4): Match Pool After Query Fix, INVALID_PAYLOAD error code, parseAfterSequence function, workerd uncaught exception

### Community 198 - "Community 198"
Cohesion: 0.67
Nodes (3): Auto review enabled, Base branches regex (all branches), CodeRabbit Configuration

### Community 201 - "Community 201"
Cohesion: 0.67
Nodes (3): renderCustomResult(), resolveResult(), submitCustomMove()

### Community 202 - "Community 202"
Cohesion: 0.67
Nodes (3): Bug report completion criteria checklist, FlareLobbyError.code reference, Bug Report Template

### Community 203 - "Community 203"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 205 - "Community 205"
Cohesion: 0.67
Nodes (3): BasicImageTransformations, RequestInitCfPropertiesImage, RequestInitCfPropertiesImageDraw

### Community 222 - "Community 222"
Cohesion: 0.67
Nodes (3): RequestInitCfPropertiesVaryAcceptHeader, RequestInitCfPropertiesVaryAcceptLanguageHeader, RequestInitCfPropertiesVaryHeader

## Knowledge Gaps
- **1556 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+1551 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **149 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RoomDurableObject` connect `Room Durable Object` to `FlareLobby Configuration & Security`, `Room Core & Validation`, `Community 67`, `Community 68`, `Community 133`, `Community 233`, `Custom Room Index`, `Community 107`, `Community 46`, `Community 47`, `Match Pool Durable Object`, `Community 23`, `Community 89`, `Community 31`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `MatchPoolDurableObject` connect `Match Pool Durable Object` to `FlareLobby Configuration & Security`, `Community 68`, `Match Pool Core`, `Community 40`, `Community 39`, `Community 107`, `Community 45`, `Community 110`, `Community 23`, `Community 62`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `defineFlareLobby()` connect `Community 55` to `FlareLobby Configuration & Security`, `Community 68`, `Custom Room Index`, `Community 107`, `Community 47`, `Community 81`, `Community 23`, `Community 62`, `Community 125`, `Community 94`, `Community 31`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _1556 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cloudflare Workers Config Types` be split into smaller, more focused modules?**
  _Cohesion score 0.002347417840375587 - nodes in this community are weakly interconnected._
- **Should `FlareLobby Configuration & Security` be split into smaller, more focused modules?**
  _Cohesion score 0.06138975966562173 - nodes in this community are weakly interconnected._
- **Should `Room Core & Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._