# Matchmaking Gateway Tests

> 24 nodes · cohesion 0.10

## Key Concepts

- **FlareLobbyObservabilityContext** (26 connections) — `packages/cloudflare/src/observability.ts`
- **matchmaking-gateway.test.ts** (13 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **MatchmakingTicketRecord** (11 connections) — `packages/cloudflare/src/match-pool.ts`
- **AuthenticatedGatewayRequest** (11 connections) — `packages/cloudflare/src/security.ts`
- **MatchmakingTicketCreationOptions** (6 connections) — `packages/cloudflare/src/match-pool.ts`
- **RoomParticipantOperationOptions** (6 connections) — `packages/cloudflare/src/room.ts`
- **.cancelTicket()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **.createTicket()** (4 connections) — `packages/cloudflare/src/matchmaking.ts`
- **RoomParticipantJoinOptions** (4 connections) — `packages/cloudflare/src/room.ts`
- **MatchmakingMatchProcessingOptions** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **MatchmakingSearchOptions** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **MatchmakingTicketMatchOptions** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **MatchmakingTicketReservationOptions** (3 connections) — `packages/cloudflare/src/match-pool.ts`
- **MatchmakingTicketGatewayResponse** (3 connections) — `packages/cloudflare/src/matchmaking.ts`
- **RoomSelectTeamOptions** (3 connections) — `packages/cloudflare/src/room.ts`
- **RoomSetReadyOptions** (3 connections) — `packages/cloudflare/src/room.ts`
- **createTicket()** (2 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **fetchWorker()** (2 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **TicketResponse** (2 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **encodeWebSocketToken()** (1 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **fetchAuthorizingWorker()** (1 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **pool** (1 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **testLobby** (1 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`
- **testWorker** (1 connections) — `packages/cloudflare/test/matchmaking-gateway.test.ts`

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (17 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (9 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (7 shared connections)
- [Party Gateway](Party_Gateway.md) (6 shared connections)
- [Room Management](Room_Management.md) (6 shared connections)
- [Custom Room Creation](Custom_Room_Creation.md) (6 shared connections)
- [RPS Game Types](RPS_Game_Types.md) (3 shared connections)
- [Type Testing](Type_Testing.md) (2 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (2 shared connections)
- [Match Pool Tests](Match_Pool_Tests.md) (1 shared connections)
- [Observability](Observability.md) (1 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/matchmaking.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/matchmaking-gateway.test.ts`

## Audit Trail

- EXTRACTED: 89 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*