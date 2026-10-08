# Room Subscription API

> 22 nodes · cohesion 0.11

## Key Concepts

- **PlayerRoom** (19 connections) — `packages/client/src/custom-room.ts`
- **RoomSubscriptionApi** (9 connections) — `packages/client/src/custom-room.ts`
- **MatchmakingClientApi** (8 connections) — `packages/client/src/matchmaking.ts`
- **SpectatorRoom** (7 connections) — `packages/client/src/custom-room.ts`
- **.joinCustomRoom()** (5 connections) — `packages/client/src/client.ts`
- **.joinCustomRoom()** (5 connections) — `packages/client/src/client.ts`
- **CustomRoomJoinOptions** (5 connections) — `packages/client/src/custom-room.ts`
- **Room** (5 connections) — `packages/client/src/custom-room.ts`
- **.findMatch()** (2 connections) — `packages/client/src/matchmaking.ts`
- **TicketWaiter** (2 connections) — `packages/client/src/matchmaking.ts`
- **.leave()** (1 connections) — `packages/client/src/custom-room.ts`
- **.selectTeam()** (1 connections) — `packages/client/src/custom-room.ts`
- **.send()** (1 connections) — `packages/client/src/custom-room.ts`
- **.setReady()** (1 connections) — `packages/client/src/custom-room.ts`
- **.on()** (1 connections) — `packages/client/src/custom-room.ts`
- **.onMessage()** (1 connections) — `packages/client/src/custom-room.ts`
- **.onStatusChange()** (1 connections) — `packages/client/src/custom-room.ts`
- **.subscribe()** (1 connections) — `packages/client/src/custom-room.ts`
- **.leave()** (1 connections) — `packages/client/src/custom-room.ts`
- **.dispose()** (1 connections) — `packages/client/src/matchmaking.ts`
- **.getRating()** (1 connections) — `packages/client/src/matchmaking.ts`
- **.joinMatchmaking()** (1 connections) — `packages/client/src/matchmaking.ts`

## Relationships

- [Client SDK Entry](Client_SDK_Entry.md) (9 shared connections)
- [Client Connection Impl](Client_Connection_Impl.md) (7 shared connections)
- [Client Matchmaking API](Client_Matchmaking_API.md) (7 shared connections)
- [Custom Room Client Types](Custom_Room_Client_Types.md) (5 shared connections)
- [Room WebSocket Client](Room_WebSocket_Client.md) (1 shared connections)

## Source Files

- `packages/client/src/client.ts`
- `packages/client/src/custom-room.ts`
- `packages/client/src/matchmaking.ts`

## Audit Trail

- EXTRACTED: 54 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*