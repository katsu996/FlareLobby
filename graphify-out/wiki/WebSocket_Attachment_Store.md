# WebSocket Attachment Store

> 9 nodes · cohesion 0.28

## Key Concepts

- **RoomWebSocketAttachment** (15 connections) — `packages/cloudflare/src/room.ts`
- **.markWebSocketDisconnected()** (5 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readWebSocketAttachment()** (5 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.createWebSocketTags()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.storeWebSocketConnection()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.handleWebSocketClose()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.handleWebSocketError()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.storeWebSocketConnection()** (2 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.broadcastGameMessage()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Relationships

- [Room WebSocket Handler](Room_WebSocket_Handler.md) (6 shared connections)
- [Room Persistence Layer](Room_Persistence_Layer.md) (3 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (3 shared connections)
- [WebSocket Send Handler](WebSocket_Send_Handler.md) (3 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (2 shared connections)
- [Room Participant Roles](Room_Participant_Roles.md) (2 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (1 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/RoomPersistence.ts`
- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Audit Trail

- EXTRACTED: 23 (74%)
- INFERRED: 8 (26%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*