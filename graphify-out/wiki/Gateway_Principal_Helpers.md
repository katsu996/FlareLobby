# Gateway Principal Helpers

> 6 nodes · cohesion 0.33

## Key Concepts

- **.requireGatewayPrincipal()** (8 connections) — `packages/cloudflare/src/match-pool.ts`
- **.getTicketForPrincipal()** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **.resolveGatewayPrincipal()** (5 connections) — `packages/cloudflare/src/match-pool.ts`
- **isGatewayPrincipalEnvelope()** (4 connections) — `packages/cloudflare/src/match-pool.ts`
- **.getActiveTicket()** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **.readActiveTicketByPlayer()** (3 connections) — `packages/cloudflare/src/match-pool.ts`

## Relationships

- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (8 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (4 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (3 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (3 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`

## Audit Trail

- EXTRACTED: 24 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*