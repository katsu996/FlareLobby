# Match Settlement Helpers

> 20 nodes · cohesion 0.13

## Key Concepts

- **.processPendingMatches()** (20 connections) — `packages/cloudflare/src/match-pool.ts`
- **createObservabilitySink()** (19 connections) — `packages/cloudflare/src/observability.ts`
- **createObservabilityContext()** (16 connections) — `packages/cloudflare/src/observability.ts`
- **.initialize()** (13 connections) — `packages/cloudflare/src/match-pool.ts`
- **.processClaimedMatchIntent()** (13 connections) — `packages/cloudflare/src/match-pool.ts`
- **.getMatchIntent()** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **.failMatchIntent()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readMatchIntentByMatchId()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **normalizeMatchIntentIdentifier()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **parseStoredRoomInitialization()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readMatchIntentByCandidateId()** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **normalizePositiveSafeInteger()** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **normalizeSampleRate()** (3 connections) — `packages/cloudflare/src/observability.ts`
- **getMatchSettlementErrorCode()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **getMatchSettlementRetryDelay()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **isRetryableMatchSettlementError()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.claimMatchIntent()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.initializePool()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.processMatchmaking()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.settleMatches()** (2 connections) — `packages/cloudflare/src/match-pool.ts`

## Relationships

- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (29 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (11 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (9 shared connections)
- [Observability Logging](Observability_Logging.md) (7 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (5 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (5 shared connections)
- [Match Pool Ticket API](Match_Pool_Ticket_API.md) (2 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (2 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (2 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (2 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (1 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/observability.ts`

## Audit Trail

- EXTRACTED: 101 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*