# Local RPS Game Logic

> 30 nodes · cohesion 0.15

## Key Concepts

- **local-demo/src/rps.ts** (43 connections) — `examples/local-demo/src/rps.ts`
- **acceptRpsMove()** (12 connections) — `examples/local-demo/src/rps.ts`
- **local-demo/src/rps-game.ts** (12 connections) — `examples/local-demo/src/rps-game.ts`
- **MatchmakingPool** (11 connections) — `packages/core/src/index.ts`
- **RatingResult** (10 connections) — `packages/core/src/rating.ts`
- **handleDemoRpsRequest()** (8 connections) — `examples/local-demo/src/rps.ts`
- **readMatchedPlayers()** (6 connections) — `examples/local-demo/src/rps.ts`
- **readRpsMatch()** (5 connections) — `examples/local-demo/src/rps.ts`
- **createRpsResultId()** (4 connections) — `examples/local-demo/src/rps-game.ts`
- **getRpsOutcome()** (4 connections) — `examples/local-demo/src/rps-game.ts`
- **isRpsMove()** (4 connections) — `examples/local-demo/src/rps-game.ts`
- **resolveRpsResult()** (4 connections) — `examples/local-demo/src/rps-game.ts`
- **RpsMove** (4 connections) — `examples/local-demo/src/rps-game.ts`
- **RpsMatchResponse** (4 connections) — `examples/local-demo/src/rps.ts`
- **toRpsResponse()** (4 connections) — `examples/local-demo/src/rps.ts`
- **local-demo/test/rps-game.test.ts** (4 connections) — `examples/local-demo/test/rps-game.test.ts`
- **MatchedPlayers** (3 connections) — `examples/hosted-demo/src/rps.ts`
- **isRatingResult()** (3 connections) — `examples/local-demo/src/rps-game.ts`
- **RpsOutcome** (3 connections) — `examples/local-demo/src/rps-game.ts`
- **MatchedPlayers** (3 connections) — `examples/local-demo/src/rps.ts`
- **MatchPoolGatewayStub** (3 connections) — `examples/local-demo/src/rps.ts`
- **.getMatchIntent()** (3 connections) — `examples/local-demo/src/rps.ts`
- **.getTicket()** (3 connections) — `examples/local-demo/src/rps.ts`
- **RpsMatchRow** (3 connections) — `examples/local-demo/src/rps.ts`
- **ensureRpsMatch()** (2 connections) — `examples/local-demo/src/rps.ts`
- *... and 5 more nodes in this community*

## Relationships

- [Hosted RPS Game Logic](Hosted_RPS_Game_Logic.md) (6 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (4 shared connections)
- [Core Public App Types](Core_Public_App_Types.md) (4 shared connections)
- [Core Matchmaking Types](Core_Matchmaking_Types.md) (4 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (4 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (3 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (3 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (3 shared connections)
- [Demo Auth Gateway](Demo_Auth_Gateway.md) (3 shared connections)
- [Match Pool Helpers](Match_Pool_Helpers.md) (2 shared connections)
- [Rating Engine Factory](Rating_Engine_Factory.md) (2 shared connections)
- [Core Public Type Tests](Core_Public_Type_Tests.md) (2 shared connections)

## Source Files

- `examples/hosted-demo/src/rps.ts`
- `examples/local-demo/src/rps-game.ts`
- `examples/local-demo/src/rps.ts`
- `examples/local-demo/test/rps-game.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/rating.ts`

## Audit Trail

- EXTRACTED: 108 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*