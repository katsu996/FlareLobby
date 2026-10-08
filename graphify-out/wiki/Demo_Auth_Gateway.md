# Demo Auth Gateway

> 31 nodes · cohesion 0.09

## Key Concepts

- **local-demo/src/index.ts** (20 connections) — `examples/local-demo/src/index.ts`
- **defineFlareLobby()** (20 connections) — `packages/cloudflare/src/config.ts`
- **gateway.ts** (12 connections) — `examples/hosted-demo/src/gateway.ts`
- **hosted-demo/src/auth.ts** (10 connections) — `examples/hosted-demo/src/auth.ts`
- **verifyHostedDemoAccessToken()** (6 connections) — `examples/hosted-demo/src/auth.ts`
- **FlareLobbyApp** (6 connections) — `packages/core/src/index.ts`
- **createHostedDemoGateway()** (5 connections) — `examples/hosted-demo/src/gateway.ts`
- **authenticateHostedDemoRequest()** (4 connections) — `examples/hosted-demo/src/auth.ts`
- **hosted-demo/test/worker.integration.test.ts** (4 connections) — `examples/hosted-demo/test/worker.integration.test.ts`
- **authenticateDemoRpsRequest()** (4 connections) — `examples/local-demo/src/rps.ts`
- **test/auth.test.ts** (3 connections) — `examples/hosted-demo/test/auth.test.ts`
- **getJwks()** (2 connections) — `examples/hosted-demo/src/auth.ts`
- **normalizeProjectUrl()** (2 connections) — `examples/hosted-demo/src/auth.ts`
- **readBearerToken()** (2 connections) — `examples/hosted-demo/src/auth.ts`
- **HOSTED_RANKED_POOL_ID** (2 connections) — `examples/hosted-demo/src/rps.ts`
- **lobby** (2 connections) — `examples/local-demo/src/index.ts`
- **readDemoPlayer()** (2 connections) — `examples/local-demo/src/index.ts`
- **createResultLobby()** (2 connections) — `packages/cloudflare/test/matchmaking-settlement.test.ts`
- **createGatewayWorker()** (2 connections) — `packages/cloudflare/test/rating.test.ts`
- **allowedAlgorithms** (1 connections) — `examples/hosted-demo/src/auth.ts`
- **HostedDemoPrincipal** (1 connections) — `examples/hosted-demo/src/auth.ts`
- **jwksCache** (1 connections) — `examples/hosted-demo/src/auth.ts`
- **HostedDemoApp** (1 connections) — `examples/hosted-demo/src/gateway.ts`
- **sign()** (1 connections) — `examples/hosted-demo/test/auth.test.ts`
- **authorized()** (1 connections) — `examples/hosted-demo/test/worker.integration.test.ts`
- *... and 6 more nodes in this community*

## Relationships

- [Hosted RPS Game Logic](Hosted_RPS_Game_Logic.md) (4 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (4 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (4 shared connections)
- [Core Public App Types](Core_Public_App_Types.md) (3 shared connections)
- [Local RPS Game Logic](Local_RPS_Game_Logic.md) (3 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (2 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (2 shared connections)
- [Match Settlement Tests](Match_Settlement_Tests.md) (2 shared connections)
- [Rating Schema Tests](Rating_Schema_Tests.md) (2 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (1 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (1 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (1 shared connections)

## Source Files

- `examples/hosted-demo/src/auth.ts`
- `examples/hosted-demo/src/gateway.ts`
- `examples/hosted-demo/src/rps.ts`
- `examples/hosted-demo/test/auth.test.ts`
- `examples/hosted-demo/test/worker.integration.test.ts`
- `examples/local-demo/src/index.ts`
- `examples/local-demo/src/rps.ts`
- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/test/matchmaking-settlement.test.ts`
- `packages/cloudflare/test/rating.test.ts`
- `packages/core/src/index.ts`

## Audit Trail

- EXTRACTED: 81 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*