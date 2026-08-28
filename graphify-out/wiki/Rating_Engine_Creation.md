# Rating Engine Creation

> 14 nodes · cohesion 0.20

## Key Concepts

- **registerMatchResult()** (22 connections) — `packages/cloudflare/src/rating.ts`
- **registerTeamMatchResult()** (22 connections) — `packages/cloudflare/src/rating.ts`
- **normalizeRatingConfiguration()** (8 connections) — `packages/cloudflare/src/rating.ts`
- **readMatchRecord()** (5 connections) — `packages/cloudflare/src/rating.ts`
- **resolveRatingConfiguration()** (4 connections) — `packages/cloudflare/src/rating.ts`
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

- [Rating Schema](Rating_Schema.md) (16 shared connections)
- [Rating String Comparison](Rating_String_Comparison.md) (7 shared connections)
- [Community 144](Community_144.md) (6 shared connections)
- [Community 143](Community_143.md) (4 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (4 shared connections)
- [Rating Schema Upgrade](Rating_Schema_Upgrade.md) (3 shared connections)
- [RPS Game Types](RPS_Game_Types.md) (2 shared connections)
- [Rating Tests](Rating_Tests.md) (2 shared connections)
- [RPS Game Client Types](RPS_Game_Client_Types.md) (2 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (2 shared connections)
- [Match Pool Tests](Match_Pool_Tests.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`

## Audit Trail

- EXTRACTED: 67 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*