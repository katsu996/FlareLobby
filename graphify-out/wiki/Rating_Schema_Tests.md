# Rating Schema Tests

> 18 nodes · cohesion 0.15

## Key Concepts

- **cloudflare/test/rating.test.ts** (20 connections) — `packages/cloudflare/test/rating.test.ts`
- **FakePreparedStatement** (5 connections) — `packages/cloudflare/test/rating.test.ts`
- **FakeSchemaDatabase** (4 connections) — `packages/cloudflare/test/rating.test.ts`
- **readStoredRating()** (4 connections) — `packages/cloudflare/test/rating.test.ts`
- **readStoredRatingState()** (4 connections) — `packages/cloudflare/test/rating.test.ts`
- **getMatchHistory** (3 connections) — `packages/cloudflare/src/rating.ts`
- **.bind()** (3 connections) — `packages/cloudflare/test/rating.test.ts`
- **.first()** (3 connections) — `packages/cloudflare/test/rating.test.ts`
- **.prepare()** (3 connections) — `packages/cloudflare/test/rating.test.ts`
- **createGatewayPrincipal()** (2 connections) — `packages/cloudflare/test/rating.test.ts`
- **createGatedWriteDatabase()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **createPool()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **createResultInput()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **.all()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **.run()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **.batch()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **.failNextBatchWith()** (1 connections) — `packages/cloudflare/test/rating.test.ts`
- **withFirstOverride()** (1 connections) — `packages/cloudflare/test/rating.test.ts`

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (2 shared connections)
- [Demo Auth Gateway](Demo_Auth_Gateway.md) (2 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (2 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (2 shared connections)
- [Rating History Storage](Rating_History_Storage.md) (1 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (1 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (1 shared connections)
- [Rating Schema Queries](Rating_Schema_Queries.md) (1 shared connections)
- [Rating Row Writers](Rating_Row_Writers.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/rating.ts`
- `packages/cloudflare/test/rating.test.ts`

## Audit Trail

- EXTRACTED: 36 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*