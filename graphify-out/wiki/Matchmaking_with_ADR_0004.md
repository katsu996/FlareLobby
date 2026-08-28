# Matchmaking with ADR 0004

> 54 nodes · cohesion 0.09

## Key Concepts

- **cloudflare/src/matchmaking.ts** (69 connections) — `packages/cloudflare/src/matchmaking.ts`
- **createErrorResponse()** (25 connections) — `packages/cloudflare/src/security.ts`
- **registerGatewayMatchResult()** (17 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readObservabilityContext()** (17 connections) — `packages/cloudflare/src/observability.ts`
- **createTicket()** (16 connections) — `packages/cloudflare/src/matchmaking.ts`
- **handleMatchmakingRequest()** (16 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readValidatedJsonBody()** (16 connections) — `packages/cloudflare/src/security.ts`
- **upgradeMatchmakingTicketWebSocket()** (13 connections) — `packages/cloudflare/src/matchmaking.ts`
- **withObservabilityRequestId()** (11 connections) — `packages/cloudflare/src/observability.ts`
- **cancelTicket()** (8 connections) — `packages/cloudflare/src/matchmaking.ts`
- **MatchmakingMatchIntent** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **isJsonObject()** (7 connections) — `packages/cloudflare/src/matchmaking.ts`
- **MatchPoolGatewayStub** (7 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isNonEmptyString()** (6 connections) — `packages/cloudflare/src/matchmaking.ts`
- **MatchPoolInitializationOptions** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **createMatchmakingPoolKey()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **createMatchRoomConnection()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **getMatchmakingTicketWebSocketRoute()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **initializeMatchPool()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isRecord()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **.getTicket()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isFiniteNumber()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **.getSnapshot()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readMatchResultInput()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readOptionalExpiry()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- *... and 29 more nodes in this community*

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (30 shared connections)
- [Custom Room Creation](Custom_Room_Creation.md) (16 shared connections)
- [Matchmaking Gateway Tests](Matchmaking_Gateway_Tests.md) (9 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (8 shared connections)
- [Observability](Observability.md) (8 shared connections)
- [RPS Game Types](RPS_Game_Types.md) (7 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (4 shared connections)
- [Rating Engine Creation](Rating_Engine_Creation.md) (4 shared connections)
- [Match Pool Durable Object Alarm](Match_Pool_Durable_Object_Alarm.md) (3 shared connections)
- [Party Gateway](Party_Gateway.md) (3 shared connections)
- [Community 144](Community_144.md) (2 shared connections)
- [Rating Schema](Rating_Schema.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/matchmaking.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/rating.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 228 (98%)
- INFERRED: 4 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*