# Matchmaking Gateway Routes

> 47 nodes · cohesion 0.10

## Key Concepts

- **cloudflare/src/matchmaking.ts** (68 connections) — `packages/cloudflare/src/matchmaking.ts`
- **createErrorResponse()** (32 connections) — `packages/cloudflare/src/security.ts`
- **readObservabilityContext()** (19 connections) — `packages/cloudflare/src/observability.ts`
- **createTicket()** (16 connections) — `packages/cloudflare/src/matchmaking.ts`
- **registerGatewayMatchResult()** (15 connections) — `packages/cloudflare/src/matchmaking.ts`
- **handleMatchmakingRequest()** (14 connections) — `packages/cloudflare/src/matchmaking.ts`
- **observeOperation()** (13 connections) — `packages/cloudflare/src/observability.ts`
- **upgradeMatchmakingTicketWebSocket()** (11 connections) — `packages/cloudflare/src/matchmaking.ts`
- **withObservabilityRequestId()** (11 connections) — `packages/cloudflare/src/observability.ts`
- **issueJoinToken()** (11 connections) — `packages/cloudflare/src/security.ts`
- **cancelTicket()** (8 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isJsonObject()** (7 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isNonEmptyString()** (6 connections) — `packages/cloudflare/src/matchmaking.ts`
- **createMatchmakingPoolKey()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **createMatchRoomConnection()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **getMatchmakingTicketWebSocketRoute()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isRecord()** (5 connections) — `packages/cloudflare/src/matchmaking.ts`
- **initializeMatchPool()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **isFiniteNumber()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **.getSnapshot()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readMatchResultInput()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readOptionalExpiry()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readRating()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **readRequestId()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **MatchResultRegistrationInput** (4 connections) — `packages/cloudflare/src/rating.ts`
- *... and 22 more nodes in this community*

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (25 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (20 shared connections)
- [Observability Logging](Observability_Logging.md) (10 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (8 shared connections)
- [Match Settlement Helpers](Match_Settlement_Helpers.md) (5 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (5 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (4 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (4 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (4 shared connections)
- [Hosted RPS Game Logic](Hosted_RPS_Game_Logic.md) (4 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (3 shared connections)
- [Local RPS Game Logic](Local_RPS_Game_Logic.md) (3 shared connections)

## Source Files

- `packages/cloudflare/src/matchmaking.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/rating.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 219 (98%)
- INFERRED: 4 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*