# Rating Schema Queries

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

- [Rating History Storage](Rating_History_Storage.md) (10 shared connections)
- [Rating Row Writers](Rating_Row_Writers.md) (3 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (3 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (2 shared connections)
- [Rating Validation Helpers](Rating_Validation_Helpers.md) (2 shared connections)
- [Rating Schema Tests](Rating_Schema_Tests.md) (1 shared connections)
- [Rating Normalize Helpers](Rating_Normalize_Helpers.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`

## Audit Trail

- EXTRACTED: 31 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*