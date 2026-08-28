# Custom Room Transport

> 14 nodes · cohesion 0.16

## Key Concepts

- **FlareLobbyWebSocketConnection** (18 connections) — `packages/client/src/client.ts`
- **CustomRoomTransport** (8 connections) — `packages/client/src/custom-room.ts`
- **ClientWebSocketOptions** (7 connections) — `packages/client/src/client.ts`
- **.connectWithToken()** (4 connections) — `packages/client/src/custom-room.ts`
- **PartyTransport** (4 connections) — `packages/client/src/party.ts`
- **.connect()** (3 connections) — `packages/client/src/custom-room.ts`
- **.eventConnectionOptions()** (3 connections) — `packages/client/src/matchmaking.ts`
- **MatchmakingTransport** (2 connections) — `packages/client/src/matchmaking.ts`
- **.close()** (1 connections) — `packages/client/src/client.ts`
- **.onClose()** (1 connections) — `packages/client/src/client.ts`
- **.onEvent()** (1 connections) — `packages/client/src/client.ts`
- **.send()** (1 connections) — `packages/client/src/client.ts`
- **.connectEvents()** (1 connections) — `packages/client/src/party.ts`
- **.requestIdFactory()** (1 connections) — `packages/client/src/party.ts`

## Relationships

- [Client Request/Command Types](Client_Request-Command_Types.md) (7 shared connections)
- [Matchmaking Retry Logic](Matchmaking_Retry_Logic.md) (5 shared connections)
- [Custom Room Client Types](Custom_Room_Client_Types.md) (4 shared connections)
- [Custom Room Client Implementation](Custom_Room_Client_Implementation.md) (4 shared connections)
- [Client Library](Client_Library.md) (2 shared connections)
- [Matchmaking Reconnection](Matchmaking_Reconnection.md) (2 shared connections)
- [Request ID Creation](Request_ID_Creation.md) (1 shared connections)

## Source Files

- `packages/client/src/client.ts`
- `packages/client/src/custom-room.ts`
- `packages/client/src/matchmaking.ts`
- `packages/client/src/party.ts`

## Audit Trail

- EXTRACTED: 40 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*