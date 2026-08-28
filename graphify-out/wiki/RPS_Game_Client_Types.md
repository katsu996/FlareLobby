# RPS Game Client Types

> 97 nodes · cohesion 0.05

## Key Concepts

- **cloudflare/src/index.ts** (260 connections) — `packages/cloudflare/src/index.ts`
- **security.ts** (85 connections) — `packages/cloudflare/src/security.ts`
- **security.test.ts** (31 connections) — `packages/cloudflare/test/security.test.ts`
- **createGatewayPrincipalEnvelope()** (25 connections) — `packages/cloudflare/src/security.ts`
- **authenticateGatewayRequest()** (23 connections) — `packages/cloudflare/src/security.ts`
- **verifyGatewayPrincipalEnvelope()** (17 connections) — `packages/cloudflare/src/security.ts`
- **readWebSocketJoinToken()** (16 connections) — `packages/cloudflare/src/security.ts`
- **issueRoomToken()** (12 connections) — `packages/cloudflare/src/security.ts`
- **protocolFailure()** (12 connections) — `packages/cloudflare/src/security.ts`
- **room.test.ts** (12 connections) — `packages/cloudflare/test/room.test.ts`
- **protocolSuccess()** (11 connections) — `packages/cloudflare/src/security.ts`
- **verifyRoomToken()** (11 connections) — `packages/cloudflare/src/security.ts`
- **verifyWebSocketRoomTokenPurpose()** (11 connections) — `packages/cloudflare/src/security.ts`
- **FlareLobbyConfiguration** (10 connections) — `packages/cloudflare/src/config.ts`
- **isNonEmptyString()** (10 connections) — `packages/cloudflare/src/security.ts`
- **normalizePrincipal()** (9 connections) — `packages/cloudflare/src/security.ts`
- **verifySignedToken()** (9 connections) — `packages/cloudflare/src/security.ts`
- **isSafeTimestamp()** (7 connections) — `packages/cloudflare/src/security.ts`
- **issueResumeToken()** (7 connections) — `packages/cloudflare/src/security.ts`
- **isUsableSecret()** (7 connections) — `packages/cloudflare/src/security.ts`
- **validateWebSocketCommand()** (7 connections) — `packages/cloudflare/src/security.ts`
- **parseSignedTokenPayload()** (6 connections) — `packages/cloudflare/src/security.ts`
- **validateInput()** (6 connections) — `packages/cloudflare/src/security.ts`
- **verifyJoinToken()** (6 connections) — `packages/cloudflare/src/security.ts`
- **FlareLobbyObservabilityConfiguration** (5 connections) — `packages/cloudflare/src/observability.ts`
- *... and 72 more nodes in this community*

## Relationships

- [Custom Room Creation](Custom_Room_Creation.md) (43 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (37 shared connections)
- [Room Management](Room_Management.md) (32 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (30 shared connections)
- [Party Gateway](Party_Gateway.md) (26 shared connections)
- [Observability](Observability.md) (22 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (20 shared connections)
- [Matchmaking Gateway Tests](Matchmaking_Gateway_Tests.md) (17 shared connections)
- [Rating Schema](Rating_Schema.md) (15 shared connections)
- [Party System Core](Party_System_Core.md) (13 shared connections)
- [Custom Room Index](Custom_Room_Index.md) (11 shared connections)
- [Durable Objects Rate Limiting](Durable_Objects_Rate_Limiting.md) (10 shared connections)

## Source Files

- `examples/local-demo/src/rps.ts`
- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/src/custom-room.ts`
- `packages/cloudflare/src/index.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/room.test.ts`
- `packages/cloudflare/test/security.test.ts`

## Audit Trail

- EXTRACTED: 567 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*