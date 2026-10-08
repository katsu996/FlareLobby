# Rate Limit Durable Object

> 15 nodes · cohesion 0.21

## Key Concepts

- **durable-objects.ts** (24 connections) — `packages/cloudflare/src/durable-objects.ts`
- **RateLimitDurableObject** (13 connections) — `packages/cloudflare/src/durable-objects.ts`
- **dev-worker.ts** (11 connections) — `packages/cloudflare/src/dev-worker.ts`
- **.consume()** (8 connections) — `packages/cloudflare/src/durable-objects.ts`
- **FlareLobbyRateLimitScope** (5 connections) — `packages/cloudflare/src/security.ts`
- **.resolveGatewayPrincipal()** (4 connections) — `packages/cloudflare/src/durable-objects.ts`
- **FlareLobbyRateLimitDecision** (4 connections) — `packages/cloudflare/src/security.ts`
- **FLARE_LOBBY_RATE_LIMIT_SCOPES** (3 connections) — `packages/cloudflare/src/security.ts`
- **allowedRateLimitDecision()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **deniedRateLimitDecision()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **migrateRateLimitSchema()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **.claimPrincipalShard()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **.constructor()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **developmentLobby** (1 connections) — `packages/cloudflare/src/dev-worker.ts`
- **RateLimitRow** (1 connections) — `packages/cloudflare/src/durable-objects.ts`

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (6 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (6 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (5 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (4 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (4 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (3 shared connections)
- [Demo Auth Gateway](Demo_Auth_Gateway.md) (2 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (2 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (2 shared connections)
- [Cloudflare Agents Runtime Types](Cloudflare_Agents_Runtime_Types.md) (1 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (1 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/dev-worker.ts`
- `packages/cloudflare/src/durable-objects.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 62 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*