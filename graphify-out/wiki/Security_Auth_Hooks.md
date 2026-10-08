# Security Auth Hooks

> 70 nodes · cohesion 0.07

## Key Concepts

- **security.ts** (93 connections) — `packages/cloudflare/src/security.ts`
- **security.test.ts** (31 connections) — `packages/cloudflare/test/security.test.ts`
- **authenticateGatewayRequest()** (30 connections) — `packages/cloudflare/src/security.ts`
- **createGatewayPrincipalEnvelope()** (30 connections) — `packages/cloudflare/src/security.ts`
- **verifyGatewayPrincipalEnvelope()** (19 connections) — `packages/cloudflare/src/security.ts`
- **readValidatedJsonBody()** (18 connections) — `packages/cloudflare/src/security.ts`
- **readWebSocketJoinToken()** (16 connections) — `packages/cloudflare/src/security.ts`
- **issueRoomToken()** (12 connections) — `packages/cloudflare/src/security.ts`
- **protocolFailure()** (12 connections) — `packages/cloudflare/src/security.ts`
- **authorizeGatewayOperation()** (11 connections) — `packages/cloudflare/src/security.ts`
- **protocolSuccess()** (11 connections) — `packages/cloudflare/src/security.ts`
- **verifyRoomToken()** (11 connections) — `packages/cloudflare/src/security.ts`
- **verifyWebSocketRoomTokenPurpose()** (11 connections) — `packages/cloudflare/src/security.ts`
- **isNonEmptyString()** (10 connections) — `packages/cloudflare/src/security.ts`
- **normalizePrincipal()** (9 connections) — `packages/cloudflare/src/security.ts`
- **verifySignedToken()** (9 connections) — `packages/cloudflare/src/security.ts`
- **verifyWebSocketRoomToken()** (8 connections) — `packages/cloudflare/src/security.ts`
- **isSafeTimestamp()** (7 connections) — `packages/cloudflare/src/security.ts`
- **isUsableSecret()** (7 connections) — `packages/cloudflare/src/security.ts`
- **validateWebSocketCommand()** (7 connections) — `packages/cloudflare/src/security.ts`
- **parseSignedTokenPayload()** (6 connections) — `packages/cloudflare/src/security.ts`
- **readGatewayToken()** (6 connections) — `packages/cloudflare/src/security.ts`
- **validateInput()** (6 connections) — `packages/cloudflare/src/security.ts`
- **authenticateRequest()** (5 connections) — `packages/cloudflare/src/security.ts`
- **createSignedToken()** (5 connections) — `packages/cloudflare/src/security.ts`
- *... and 45 more nodes in this community*

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (42 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (20 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (15 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (7 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (7 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (6 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (6 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (6 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (6 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (5 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (4 shared connections)
- [Hosted RPS Game Logic](Hosted_RPS_Game_Logic.md) (4 shared connections)

## Source Files

- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/rate-limit.test.ts`
- `packages/cloudflare/test/room-operations.test.ts`
- `packages/cloudflare/test/security.test.ts`

## Audit Trail

- EXTRACTED: 331 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*