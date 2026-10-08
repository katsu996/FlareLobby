# Hosted RPS Game Logic

> 30 nodes · cohesion 0.15

## Key Concepts

- **hosted-demo/src/rps.ts** (44 connections) — `examples/hosted-demo/src/rps.ts`
- **hosted-demo/src/index.ts** (15 connections) — `examples/hosted-demo/src/index.ts`
- **acceptRpsMove()** (12 connections) — `examples/hosted-demo/src/rps.ts`
- **hosted-demo/src/rps-game.ts** (12 connections) — `examples/hosted-demo/src/rps-game.ts`
- **handleHostedRpsRequest()** (8 connections) — `examples/hosted-demo/src/rps.ts`
- **readMatchedPlayers()** (6 connections) — `examples/hosted-demo/src/rps.ts`
- **hosted-demo/test/rps-game.test.ts** (6 connections) — `examples/hosted-demo/test/rps-game.test.ts`
- **isRpsMove()** (5 connections) — `examples/hosted-demo/src/rps-game.ts`
- **readRpsMatch()** (5 connections) — `examples/hosted-demo/src/rps.ts`
- **authenticateHostedRpsRequest()** (4 connections) — `examples/hosted-demo/src/rps.ts`
- **createRpsResultId()** (4 connections) — `examples/hosted-demo/src/rps-game.ts`
- **getRpsOutcome()** (4 connections) — `examples/hosted-demo/src/rps-game.ts`
- **isRatingResult()** (4 connections) — `examples/hosted-demo/src/rps-game.ts`
- **resolveRpsResult()** (4 connections) — `examples/hosted-demo/src/rps-game.ts`
- **RpsMove** (4 connections) — `examples/hosted-demo/src/rps-game.ts`
- **RpsMatchResponse** (4 connections) — `examples/hosted-demo/src/rps.ts`
- **toRpsResponse()** (4 connections) — `examples/hosted-demo/src/rps.ts`
- **RpsOutcome** (3 connections) — `examples/hosted-demo/src/rps-game.ts`
- **MatchPoolGatewayStub** (3 connections) — `examples/hosted-demo/src/rps.ts`
- **.getMatchIntent()** (3 connections) — `examples/hosted-demo/src/rps.ts`
- **.getTicket()** (3 connections) — `examples/hosted-demo/src/rps.ts`
- **RpsMatchRow** (3 connections) — `examples/hosted-demo/src/rps.ts`
- **ensureRpsMatch()** (2 connections) — `examples/hosted-demo/src/rps.ts`
- **RPS_MOVES** (2 connections) — `examples/hosted-demo/src/rps-game.ts`
- **isJsonObject()** (2 connections) — `examples/hosted-demo/src/rps.ts`
- *... and 5 more nodes in this community*

## Relationships

- [Local RPS Game Logic](Local_RPS_Game_Logic.md) (6 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (5 shared connections)
- [Demo Auth Gateway](Demo_Auth_Gateway.md) (4 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (4 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (4 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (4 shared connections)
- [Core Public App Types](Core_Public_App_Types.md) (3 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (2 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (2 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (2 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (2 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (1 shared connections)

## Source Files

- `examples/hosted-demo/src/index.ts`
- `examples/hosted-demo/src/rps-game.ts`
- `examples/hosted-demo/src/rps.ts`
- `examples/hosted-demo/test/rps-game.test.ts`

## Audit Trail

- EXTRACTED: 107 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*