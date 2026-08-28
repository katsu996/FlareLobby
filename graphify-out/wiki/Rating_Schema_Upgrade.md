# Rating Schema Upgrade

> 10 nodes · cohesion 0.20

## Key Concepts

- **listMatchHistory()** (10 connections) — `packages/cloudflare/src/rating.ts`
- **ensureRatingSchema()** (8 connections) — `packages/cloudflare/src/rating.ts`
- **applyRatingSchemaUpgrades()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **readMatchRecords()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **toMatchRecord()** (4 connections) — `packages/cloudflare/src/rating.ts`
- **assertUpgradeColumnsExist()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **encodeHistoryCursor()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **isDuplicateColumnError()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **normalizeHistoryLimit()** (2 connections) — `packages/cloudflare/src/rating.ts`
- **toParticipantRecord()** (2 connections) — `packages/cloudflare/src/rating.ts`

## Relationships

- [Rating Schema](Rating_Schema.md) (10 shared connections)
- [Community 144](Community_144.md) (3 shared connections)
- [Rating Engine Creation](Rating_Engine_Creation.md) (3 shared connections)
- [Rating String Comparison](Rating_String_Comparison.md) (3 shared connections)
- [RPS Game Client Types](RPS_Game_Client_Types.md) (2 shared connections)
- [Rating Tests](Rating_Tests.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`

## Audit Trail

- EXTRACTED: 31 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*