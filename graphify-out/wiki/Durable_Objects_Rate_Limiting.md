# Durable Objects Rate Limiting

> 16 nodes · cohesion 0.20

## Key Concepts

- **durable-objects.ts** (23 connections) — `packages/cloudflare/src/durable-objects.ts`
- **dev-worker.ts** (10 connections) — `packages/cloudflare/src/dev-worker.ts`
- **RateLimitDurableObject** (10 connections) — `packages/cloudflare/src/durable-objects.ts`
- **.consume()** (10 connections) — `packages/cloudflare/src/durable-objects.ts`
- **FlareLobbyRateLimitScope** (5 connections) — `packages/cloudflare/src/security.ts`
- **.resolveGatewayPrincipal()** (4 connections) — `packages/cloudflare/src/durable-objects.ts`
- **FlareLobbyRateLimitDecision** (4 connections) — `packages/cloudflare/src/security.ts`
- **allowedRateLimitDecision()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **deniedRateLimitDecision()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **isPositiveSafeInteger()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **isRateLimitScope()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **.claimPrincipalShard()** (2 connections) — `packages/cloudflare/src/durable-objects.ts`
- **developmentLobby** (1 connections) — `packages/cloudflare/src/dev-worker.ts`
- **.constructor()** (1 connections) — `packages/cloudflare/src/durable-objects.ts`
- **RateLimitOwnerRow** (1 connections) — `packages/cloudflare/src/durable-objects.ts`
- **RateLimitRow** (1 connections) — `packages/cloudflare/src/durable-objects.ts`

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (10 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (5 shared connections)
- [Party System Core](Party_System_Core.md) (5 shared connections)
- [Party Gateway](Party_Gateway.md) (3 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (2 shared connections)
- [Room Lifecycle](Room_Lifecycle.md) (2 shared connections)
- [Type Testing](Type_Testing.md) (1 shared connections)
- [Cloudflare Worker Types & AI Models](Cloudflare_Worker_Types_&_AI_Models.md) (1 shared connections)
- [Room Management](Room_Management.md) (1 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (1 shared connections)
- [Community 114](Community_114.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/dev-worker.ts`
- `packages/cloudflare/src/durable-objects.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 56 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*