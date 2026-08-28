# Match Pool Durable Object Alarm

> 17 nodes · cohesion 0.15

## Key Concepts

- **.createTicket()** (22 connections) — `packages/cloudflare/src/match-pool.ts`
- **.processPendingMatches()** (20 connections) — `packages/cloudflare/src/match-pool.ts`
- **createObservabilitySink()** (17 connections) — `packages/cloudflare/src/observability.ts`
- **createObservabilityContext()** (16 connections) — `packages/cloudflare/src/observability.ts`
- **.initialize()** (13 connections) — `packages/cloudflare/src/match-pool.ts`
- **.snapshotMemberRatings()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.beginQueueTicket()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **PartyQueueStartResult** (4 connections) — `packages/cloudflare/src/party.ts`
- **PartyQueueStub** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **.endQueueTicket()** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **normalizeSampleRate()** (3 connections) — `packages/cloudflare/src/observability.ts`
- **.claimMatchIntent()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.createMatchmakingTicket()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.initializePool()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.processMatchmaking()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.settleMatches()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **roundHalfAwayFromZero()** (2 connections) — `packages/cloudflare/src/match-pool.ts`

## Relationships

- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (32 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (13 shared connections)
- [Observability](Observability.md) (9 shared connections)
- [Match Pool Durable Object Tick](Match_Pool_Durable_Object_Tick.md) (7 shared connections)
- [Room Lifecycle](Room_Lifecycle.md) (4 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (3 shared connections)
- [RPS Game Client Types](RPS_Game_Client_Types.md) (3 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (2 shared connections)
- [Room Management](Room_Management.md) (2 shared connections)
- [Community 144](Community_144.md) (1 shared connections)
- [Party Gateway](Party_Gateway.md) (1 shared connections)
- [Room Snapshot Events](Room_Snapshot_Events.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/party.ts`

## Audit Trail

- EXTRACTED: 100 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*