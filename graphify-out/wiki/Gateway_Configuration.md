# Gateway Configuration

> 67 nodes · cohesion 0.05

## Key Concepts

- **config.ts** (89 connections) — `packages/cloudflare/src/config.ts`
- **cors.ts** (17 connections) — `packages/cloudflare/src/cors.ts`
- **FlareLobbyConfiguration** (12 connections) — `packages/cloudflare/src/config.ts`
- **configuration.test.ts** (12 connections) — `packages/cloudflare/test/configuration.test.ts`
- **cors.test.ts** (12 connections) — `packages/cloudflare/test/cors.test.ts`
- **MatchmakingPoolConfiguration** (10 connections) — `packages/cloudflare/src/config.ts`
- **normalizeConfiguration()** (9 connections) — `packages/cloudflare/src/config.ts`
- **applyCorsHeaders()** (9 connections) — `packages/cloudflare/src/cors.ts`
- **room-constants.ts** (7 connections) — `packages/cloudflare/src/room-constants.ts`
- **issueResumeToken()** (7 connections) — `packages/cloudflare/src/security.ts`
- **consumeRateLimit()** (6 connections) — `packages/cloudflare/src/config.ts`
- **FlareLobbyConfigurationError** (6 connections) — `packages/cloudflare/src/config.ts`
- **handleCorsPreflight()** (5 connections) — `packages/cloudflare/src/cors.ts`
- **isAllowedCorsOrigin()** (5 connections) — `packages/cloudflare/src/cors.ts`
- **isCorsPreflightRequest()** (5 connections) — `packages/cloudflare/src/cors.ts`
- **isValidCorsOrigin()** (5 connections) — `packages/cloudflare/src/cors.ts`
- **MatchmakingMatchRoomOptions** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **createRateLimitError()** (5 connections) — `packages/cloudflare/src/security.ts`
- **assertCustomRoomConfiguration()** (4 connections) — `packages/cloudflare/src/config.ts`
- **assertMatchmakingPools()** (4 connections) — `packages/cloudflare/src/config.ts`
- **consumeWebSocketMessageRateLimit()** (4 connections) — `packages/cloudflare/src/config.ts`
- **createGatewayWorker()** (4 connections) — `packages/cloudflare/src/config.ts`
- **normalizeRatingConfiguration()** (4 connections) — `packages/cloudflare/src/config.ts`
- **FlareLobbyCorsConfiguration** (4 connections) — `packages/cloudflare/src/cors.ts`
- **RatingConfiguration** (4 connections) — `packages/cloudflare/src/rating.ts`
- *... and 42 more nodes in this community*

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (43 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (15 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (8 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (7 shared connections)
- [Observability Logging](Observability_Logging.md) (6 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (5 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (4 shared connections)
- [Demo Auth Gateway](Demo_Auth_Gateway.md) (4 shared connections)
- [Local RPS Game Logic](Local_RPS_Game_Logic.md) (4 shared connections)
- [Custom Room Listing](Custom_Room_Listing.md) (3 shared connections)
- [Rating History Storage](Rating_History_Storage.md) (3 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/src/cors.ts`
- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/rating.ts`
- `packages/cloudflare/src/room-constants.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/configuration.test.ts`
- `packages/cloudflare/test/cors.test.ts`

## Audit Trail

- EXTRACTED: 230 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*