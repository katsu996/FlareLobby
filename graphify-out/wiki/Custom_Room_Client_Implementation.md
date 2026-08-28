# Custom Room Client Implementation

> 46 nodes · cohesion 0.10

## Key Concepts

- **RoomImpl** (44 connections) — `packages/client/src/custom-room.ts`
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
- **.assertOpen()** (4 connections) — `packages/client/src/custom-room.ts`
- **.assertSubscriptionOpen()** (4 connections) — `packages/client/src/custom-room.ts`
- **.kick()** (4 connections) — `packages/client/src/custom-room.ts`
- **.sendCommand()** (4 connections) — `packages/client/src/custom-room.ts`
- **.startMatch()** (4 connections) — `packages/client/src/custom-room.ts`
- **.unsubscribeConnectionClose()** (4 connections) — `packages/client/src/custom-room.ts`
- **.unsubscribeConnectionEvents()** (4 connections) — `packages/client/src/custom-room.ts`
- **isRetryableReconnectError()** (3 connections) — `packages/client/src/custom-room.ts`
- *... and 21 more nodes in this community*

## Relationships

- [Client Request/Command Types](Client_Request-Command_Types.md) (17 shared connections)
- [Custom Room Transport](Custom_Room_Transport.md) (4 shared connections)
- [Custom Room Player Types](Custom_Room_Player_Types.md) (1 shared connections)

## Source Files

- `packages/client/src/custom-room.ts`

## Audit Trail

- EXTRACTED: 128 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*