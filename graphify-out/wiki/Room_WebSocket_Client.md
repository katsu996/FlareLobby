# Room WebSocket Client

> 45 nodes · cohesion 0.11

## Key Concepts

- **RoomImpl** (44 connections) — `packages/client/src/custom-room.ts`
- **FlareLobbyWebSocketConnection** (18 connections) — `packages/client/src/client.ts`
- **.sendSnapshot()** (10 connections) — `packages/client/src/custom-room.ts`
- **.markDisconnected()** (9 connections) — `packages/client/src/custom-room.ts`
- **.attachConnection()** (8 connections) — `packages/client/src/custom-room.ts`
- **.attemptReconnect()** (8 connections) — `packages/client/src/custom-room.ts`
- **.markClosed()** (8 connections) — `packages/client/src/custom-room.ts`
- **.assertHost()** (7 connections) — `packages/client/src/custom-room.ts`
- **.handleEvent()** (7 connections) — `packages/client/src/custom-room.ts`
- **.leave()** (7 connections) — `packages/client/src/custom-room.ts`
- **.setStatus()** (7 connections) — `packages/client/src/custom-room.ts`
- **compactJsonObject()** (6 connections) — `packages/client/src/custom-room.ts`
- **.assertPlayer()** (6 connections) — `packages/client/src/custom-room.ts`
- **.close()** (6 connections) — `packages/client/src/custom-room.ts`
- **.constructor()** (6 connections) — `packages/client/src/custom-room.ts`
- **.handleConnectionClosed()** (6 connections) — `packages/client/src/custom-room.ts`
- **.scheduleReconnect()** (6 connections) — `packages/client/src/custom-room.ts`
- **.replaceSnapshot()** (5 connections) — `packages/client/src/custom-room.ts`
- **freezeSnapshot()** (4 connections) — `packages/client/src/custom-room.ts`
- **.assertOpen()** (4 connections) — `packages/client/src/custom-room.ts`
- **.kick()** (4 connections) — `packages/client/src/custom-room.ts`
- **.sendCommand()** (4 connections) — `packages/client/src/custom-room.ts`
- **.startMatch()** (4 connections) — `packages/client/src/custom-room.ts`
- **.unsubscribeConnectionClose()** (4 connections) — `packages/client/src/custom-room.ts`
- **.unsubscribeConnectionEvents()** (4 connections) — `packages/client/src/custom-room.ts`
- *... and 20 more nodes in this community*

## Relationships

- [Custom Room Client Types](Custom_Room_Client_Types.md) (20 shared connections)
- [Client Matchmaking API](Client_Matchmaking_API.md) (4 shared connections)
- [Client Transport Types](Client_Transport_Types.md) (2 shared connections)
- [Client SDK Entry](Client_SDK_Entry.md) (1 shared connections)
- [Client WebSocket Impl](Client_WebSocket_Impl.md) (1 shared connections)
- [Client Connection Impl](Client_Connection_Impl.md) (1 shared connections)
- [Room Subscription API](Room_Subscription_API.md) (1 shared connections)

## Source Files

- `packages/client/src/client.ts`
- `packages/client/src/custom-room.ts`

## Audit Trail

- EXTRACTED: 136 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*