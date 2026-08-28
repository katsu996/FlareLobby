# FlareLobby Configuration

> 44 nodes · cohesion 0.07

## Key Concepts

- **config.ts** (82 connections) — `packages/cloudflare/src/config.ts`
- **FlareLobbyBindings** (15 connections) — `packages/cloudflare/src/config.ts`
- **configuration.test.ts** (10 connections) — `packages/cloudflare/test/configuration.test.ts`
- **MatchmakingPoolConfiguration** (8 connections) — `packages/cloudflare/src/config.ts`
- **normalizeConfiguration()** (8 connections) — `packages/cloudflare/src/config.ts`
- **verifyWebSocketRoomToken()** (8 connections) — `packages/cloudflare/src/security.ts`
- **room-constants.ts** (7 connections) — `packages/cloudflare/src/room-constants.ts`
- **consumeRateLimit()** (5 connections) — `packages/cloudflare/src/config.ts`
- **FlareLobbyConfigurationError** (5 connections) — `packages/cloudflare/src/config.ts`
- **MatchmakingMatchRoomOptions** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **assertCustomRoomConfiguration()** (4 connections) — `packages/cloudflare/src/config.ts`
- **assertMatchmakingPools()** (4 connections) — `packages/cloudflare/src/config.ts`
- **consumeWebSocketMessageRateLimit()** (4 connections) — `packages/cloudflare/src/config.ts`
- **createGatewayWorker()** (4 connections) — `packages/cloudflare/src/config.ts`
- **normalizeRatingConfiguration()** (4 connections) — `packages/cloudflare/src/config.ts`
- **upgradeCustomRoomWebSocket()** (4 connections) — `packages/cloudflare/src/config.ts`
- **RatingConfiguration** (4 connections) — `packages/cloudflare/src/rating.ts`
- **DEFAULT_DISCONNECT_GRACE_PERIOD_MS** (4 connections) — `packages/cloudflare/src/room-constants.ts`
- **DEFAULT_EVENT_HISTORY_LIMIT** (4 connections) — `packages/cloudflare/src/room-constants.ts`
- **DEFAULT_FINISHED_ROOM_RETENTION_MS** (4 connections) — `packages/cloudflare/src/room-constants.ts`
- **DEFAULT_PROCESSED_COMMAND_RETENTION_MS** (4 connections) — `packages/cloudflare/src/room-constants.ts`
- **DEFAULT_RESUME_TOKEN_TTL_MS** (4 connections) — `packages/cloudflare/src/room-constants.ts`
- **createRateLimitError()** (4 connections) — `packages/cloudflare/src/security.ts`
- **assertInputLimits()** (3 connections) — `packages/cloudflare/src/config.ts`
- **DefinedFlareLobby** (3 connections) — `packages/cloudflare/src/config.ts`
- *... and 19 more nodes in this community*

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (37 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (8 shared connections)
- [Custom Room Creation](Custom_Room_Creation.md) (7 shared connections)
- [Room Management](Room_Management.md) (7 shared connections)
- [Type Testing](Type_Testing.md) (6 shared connections)
- [Durable Objects Rate Limiting](Durable_Objects_Rate_Limiting.md) (5 shared connections)
- [Observability](Observability.md) (5 shared connections)
- [Party Gateway](Party_Gateway.md) (5 shared connections)
- [Party System Core](Party_System_Core.md) (4 shared connections)
- [Custom Room Index](Custom_Room_Index.md) (3 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (2 shared connections)
- [Room Lifecycle](Room_Lifecycle.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/rating.ts`
- `packages/cloudflare/src/room-constants.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/configuration.test.ts`

## Audit Trail

- EXTRACTED: 173 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*