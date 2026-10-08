# Match Pool Ticket API

> 17 nodes · cohesion 0.13

## Key Concepts

- **match-pool.test.ts** (22 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **.ensureMatchIntent()** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **createMatchmakingMatchId()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.ensureMatchIntentsForReservedTickets()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **MATCHMAKING_POOL_KEY_SEPARATOR** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **parseMatchRoomOptions()** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **extractErrorCode()** (3 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **captureErrorCode()** (2 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **createGatewayPrincipal()** (2 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **createInitializedPool()** (2 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **errorCodeOf()** (2 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **createPool()** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **createTicketOptions()** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **getQueuedAt()** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **TicketEventMessage** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **TicketEventsResponse** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`
- **TicketOptionOverrides** (1 connections) — `packages/cloudflare/test/match-pool.test.ts`

## Relationships

- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (7 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (6 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (4 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (3 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (3 shared connections)
- [Match Settlement Tests](Match_Settlement_Tests.md) (2 shared connections)
- [Match Settlement Helpers](Match_Settlement_Helpers.md) (2 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (2 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/test/match-pool.test.ts`

## Audit Trail

- EXTRACTED: 48 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*