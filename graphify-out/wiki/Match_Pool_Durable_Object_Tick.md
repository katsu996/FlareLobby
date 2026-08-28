# Match Pool Durable Object Tick

> 16 nodes · cohesion 0.18

## Key Concepts

- **.requirePool()** (12 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchAndReserveCandidatesAt()** (12 connections) — `packages/cloudflare/src/match-pool.ts`
- **.ensureMatchIntent()** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **toPool()** (10 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchCandidatesAt()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **.toSearchTicket()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **createMatchmakingMatchId()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.createSearchResult()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchAndReserveCandidates()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchCandidates()** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **.ensureMatchIntentsForReservedTickets()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.getNextSearchAtForWaitingTickets()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readWaitingTicketRows()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **normalizeSearchNow()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.findAndReserveCandidates()** (2 connections) — `packages/cloudflare/src/match-pool.ts`
- **.findCandidates()** (2 connections) — `packages/cloudflare/src/match-pool.ts`

## Relationships

- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (39 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (9 shared connections)
- [Match Pool Durable Object Alarm](Match_Pool_Durable_Object_Alarm.md) (7 shared connections)
- [Match Pool Tests](Match_Pool_Tests.md) (1 shared connections)
- [Type Testing](Type_Testing.md) (1 shared connections)
- [RPS Game Client Types](RPS_Game_Client_Types.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`

## Audit Trail

- EXTRACTED: 80 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*