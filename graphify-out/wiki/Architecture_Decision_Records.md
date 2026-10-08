# Architecture Decision Records

> 28 nodes · cohesion 0.08

## Key Concepts

- **D1 search projection for public rooms** (4 connections) — `docs/adr/0003-public-room-index.md`
- **Party Durable Object** (4 connections) — `docs/adr/0005-party-matching-and-team-composition.md`
- **Idempotent result registration via matchId resultId** (3 connections) — `docs/adr/0004-match-result-trust-boundary.md`
- **Server-side trust boundary for match results** (3 connections) — `docs/adr/0004-match-result-trust-boundary.md`
- **Version-conditional D1 batch write** (3 connections) — `docs/adr/0004-match-result-trust-boundary.md`
- **RatingEngine Strategy boundary** (3 connections) — `docs/adr/0006-rating-strategy-and-glicko2.md`
- **Architecture v0.1.0 boundaries** (3 connections) — `docs/architecture.md`
- **Custom Room Usage Guide** (3 connections) — `docs/custom-room-guide.md`
- **RoomSummary D1 projection without secrets** (3 connections) — `docs/custom-room-list.md`
- **Candidate search policy with expanding width** (3 connections) — `docs/match-pool.md`
- **ELO calculation with away-from-zero rounding** (3 connections) — `docs/rating.md`
- **Revision-guarded async sync** (2 connections) — `docs/adr/0003-public-room-index.md`
- **Room SQLite as source of truth** (2 connections) — `docs/adr/0003-public-room-index.md`
- **N-person party ticket with memberIds** (2 connections) — `docs/adr/0005-party-matching-and-team-composition.md`
- **Arithmetic mean rating reference with max deviation tiebreak** (2 connections) — `docs/adr/0005-party-matching-and-team-composition.md`
- **D1 ratings match participant history** (2 connections) — `docs/architecture.md`
- **Room Durable Object roomId SQLite** (2 connections) — `docs/architecture.md`
- **Join leave participation token flow** (2 connections) — `docs/custom-room-participation.md`
- **Match intent settlement with deterministic IDs** (2 connections) — `docs/match-pool.md`
- **Analytics Engine match metrics** (2 connections) — `docs/observability.md`
- **Team match result registration API** (2 connections) — `docs/rating.md`
- **Pending operation plus single Alarm retry** (1 connections) — `docs/adr/0003-public-room-index.md`
- **Glicko-2 engine with RD and volatility** (1 connections) — `docs/adr/0006-rating-strategy-and-glicko2.md`
- **Season algorithm column with CONFLICT guard** (1 connections) — `docs/adr/0006-rating-strategy-and-glicko2.md`
- **Gateway Worker auth routing** (1 connections) — `docs/architecture.md`
- *... and 3 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `docs/adr/0003-public-room-index.md`
- `docs/adr/0004-match-result-trust-boundary.md`
- `docs/adr/0005-party-matching-and-team-composition.md`
- `docs/adr/0006-rating-strategy-and-glicko2.md`
- `docs/architecture.md`
- `docs/custom-room-guide.md`
- `docs/custom-room-list.md`
- `docs/custom-room-participation.md`
- `docs/match-pool.md`
- `docs/observability.md`
- `docs/rating.md`

## Audit Trail

- EXTRACTED: 12 (39%)
- INFERRED: 19 (61%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*