# Rating Engine Factory

> 13 nodes · cohesion 0.22

## Key Concepts

- **registerMatchResult()** (24 connections) — `packages/cloudflare/src/rating.ts`
- **registerTeamMatchResult()** (22 connections) — `packages/cloudflare/src/rating.ts`
- **normalizeRatingConfiguration()** (8 connections) — `packages/cloudflare/src/rating.ts`
- **readMatchRecord()** (5 connections) — `packages/cloudflare/src/rating.ts`
- **createRatingEngine()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **createRatingUpdateSql()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **isRatingAlgorithm()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **normalizeRetryCount()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **resolveExistingMatch()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **resultChanges()** (3 connections) — `packages/cloudflare/src/rating.ts`
- **createRatingUpdateExtraBinds()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **hasOwn()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **requireRatingRow()** (2 connections) — `packages/cloudflare/src/rating.ts`

## Relationships

- [Rating History Storage](Rating_History_Storage.md) (15 shared connections)
- [Rating Validation Helpers](Rating_Validation_Helpers.md) (7 shared connections)
- [Rating Row Writers](Rating_Row_Writers.md) (6 shared connections)
- [Rating Normalize Helpers](Rating_Normalize_Helpers.md) (4 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (4 shared connections)
- [Rating Schema Queries](Rating_Schema_Queries.md) (3 shared connections)
- [Hosted RPS Game Logic](Hosted_RPS_Game_Logic.md) (2 shared connections)
- [Local RPS Game Logic](Local_RPS_Game_Logic.md) (2 shared connections)
- [Rating Schema Tests](Rating_Schema_Tests.md) (2 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (2 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (1 shared connections)
- [Match Settlement Tests](Match_Settlement_Tests.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`

## Audit Trail

- EXTRACTED: 66 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*