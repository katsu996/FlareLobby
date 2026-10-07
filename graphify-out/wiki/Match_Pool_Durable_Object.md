# Match Pool Durable Object

> 56 nodes · cohesion 0.11

## Key Concepts

- **MatchPoolDurableObject** (91 connections) — `packages/cloudflare/src/match-pool.ts`
- **.createTicket()** (22 connections) — `packages/cloudflare/src/match-pool.ts`
- **.applyMatchResult()** (18 connections) — `packages/cloudflare/src/match-pool.ts`
- **.cancelTicket()** (17 connections) — `packages/cloudflare/src/match-pool.ts`
- **.synchronizeAlarm()** (16 connections) — `packages/cloudflare/src/match-pool.ts`
- **.appendTicketEvent()** (14 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readPoolRow()** (13 connections) — `packages/cloudflare/src/match-pool.ts`
- **.requirePool()** (12 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchAndReserveCandidatesAt()** (12 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readTicket()** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readTicketRow()** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **.reserveCandidate()** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **parseSearchPolicy()** (10 connections) — `packages/cloudflare/src/match-pool.ts`
- **toPool()** (10 connections) — `packages/cloudflare/src/match-pool.ts`
- **.expireTicket()** (9 connections) — `packages/cloudflare/src/match-pool.ts`
- **.incrementPoolRevision()** (9 connections) — `packages/cloudflare/src/match-pool.ts`
- **.configureSearchPolicy()** (8 connections) — `packages/cloudflare/src/match-pool.ts`
- **.expireDueTicketsAt()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **.getSnapshot()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **.reserveCandidateRows()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **.searchCandidatesAt()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **.toSearchTicket()** (7 connections) — `packages/cloudflare/src/match-pool.ts`
- **recordQualityMetric()** (7 connections) — `packages/cloudflare/src/observability.ts`
- **.createSearchResult()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.releaseReservedCandidate()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- *... and 31 more nodes in this community*

## Relationships

- [Match Settlement Helpers](Match_Settlement_Helpers.md) (29 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (27 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (25 shared connections)
- [Gateway Principal Helpers](Gateway_Principal_Helpers.md) (8 shared connections)
- [Match Pool Ticket API](Match_Pool_Ticket_API.md) (7 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (3 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (3 shared connections)
- [Party Queue Stub](Party_Queue_Stub.md) (3 shared connections)
- [Observability Logging](Observability_Logging.md) (3 shared connections)
- [Match Settlement Tests](Match_Settlement_Tests.md) (2 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (2 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/observability.ts`

## Audit Trail

- EXTRACTED: 281 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*