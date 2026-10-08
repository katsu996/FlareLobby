# Client Transport Types

> 11 nodes · cohesion 0.20

## Key Concepts

- **CustomRoomTransport** (8 connections) — `packages/client/src/custom-room.ts`
- **ClientWebSocketOptions** (7 connections) — `packages/client/src/client.ts`
- **ClientRequestOptions** (5 connections) — `packages/client/src/client.ts`
- **.connectWithToken()** (4 connections) — `packages/client/src/custom-room.ts`
- **PartyTransport** (4 connections) — `packages/client/src/party.ts`
- **.connect()** (3 connections) — `packages/client/src/custom-room.ts`
- **.eventConnectionOptions()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.request()** (2 connections) — `packages/client/src/custom-room.ts`
- **MatchmakingTransport** (2 connections) — `packages/client/src/matchmaking.ts`
- **.connectEvents()** (1 connections) — `packages/client/src/party.ts`
- **.requestIdFactory()** (1 connections) — `packages/client/src/party.ts`

## Relationships

- [Client Matchmaking API](Client_Matchmaking_API.md) (7 shared connections)
- [Client SDK Entry](Client_SDK_Entry.md) (4 shared connections)
- [Custom Room Client Types](Custom_Room_Client_Types.md) (3 shared connections)
- [Client Connection Impl](Client_Connection_Impl.md) (2 shared connections)
- [Room WebSocket Client](Room_WebSocket_Client.md) (2 shared connections)

## Source Files

- `packages/client/src/client.ts`
- `packages/client/src/custom-room.ts`
- `packages/client/src/matchmaking.ts`
- `packages/client/src/party.ts`

## Audit Trail

- EXTRACTED: 29 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*