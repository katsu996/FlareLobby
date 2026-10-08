# Rating Row Writers

> 8 nodes · cohesion 0.36

## Key Concepts

- **getRating()** (15 connections) — `packages/cloudflare/src/rating.ts`
- **normalizeRatingError()** (15 connections) — `packages/cloudflare/src/rating.ts`
- **createRatingInsert()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **ensureRatingRows()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **ensureTeamRatingRows()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **createDeviationBinds()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **readRatingRow()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **toRating()** (2 connections) — `packages/cloudflare/src/rating.ts`

## Relationships

- [Rating History Storage](Rating_History_Storage.md) (9 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (6 shared connections)
- [Rating Validation Helpers](Rating_Validation_Helpers.md) (5 shared connections)
- [Rating Schema Queries](Rating_Schema_Queries.md) (3 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (2 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (1 shared connections)
- [Rating Normalize Helpers](Rating_Normalize_Helpers.md) (1 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (1 shared connections)
- [Rating Schema Tests](Rating_Schema_Tests.md) (1 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`

## Audit Trail

- EXTRACTED: 40 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*