# Room Lifecycle

> 48 nodes · cohesion 0.08

## Key Concepts

- **RoomDurableObject** (88 connections) — `packages/cloudflare/src/room.ts`
- **.readRoomRow()** (17 connections) — `packages/cloudflare/src/room.ts`
- **.readSnapshot()** (16 connections) — `packages/cloudflare/src/room.ts`
- **.join()** (14 connections) — `packages/cloudflare/src/room.ts`
- **.handleWebSocketMessage()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.synchronizeAlarm()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.recordProcessedCommand()** (10 connections) — `packages/cloudflare/src/room.ts`
- **.initialize()** (9 connections) — `packages/cloudflare/src/room.ts`
- **.transition()** (9 connections) — `packages/cloudflare/src/room.ts`
- **.dispatchGameMessage()** (8 connections) — `packages/cloudflare/src/room.ts`
- **.readProcessedCommand()** (7 connections) — `packages/cloudflare/src/room.ts`
- **.resolveGatewayPrincipal()** (7 connections) — `packages/cloudflare/src/room.ts`
- **.broadcastProtocolMessage()** (6 connections) — `packages/cloudflare/src/room.ts`
- **.disconnect()** (6 connections) — `packages/cloudflare/src/room.ts`
- **.scheduleOperation()** (6 connections) — `packages/cloudflare/src/room.ts`
- **.scheduleParticipantDisconnect()** (6 connections) — `packages/cloudflare/src/room.ts`
- **closeWebSocketSafely()** (5 connections) — `packages/cloudflare/src/room.ts`
- **.broadcastGameMessage()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.getProcessedCommand()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.purgeExpiredProcessedCommands()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.sendProtocolMessage()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.sendWebSocketFailure()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.writeParticipantDisconnectOperation()** (4 connections) — `packages/cloudflare/src/room.ts`
- **assertActiveRoom()** (3 connections) — `packages/cloudflare/src/room.ts`
- **deleteRoomState()** (3 connections) — `packages/cloudflare/src/room.ts`
- *... and 23 more nodes in this community*

## Relationships

- [Room Waiting State](Room_Waiting_State.md) (59 shared connections)
- [Custom Room Index Types](Custom_Room_Index_Types.md) (15 shared connections)
- [Room Management](Room_Management.md) (13 shared connections)
- [Room Snapshot Events](Room_Snapshot_Events.md) (13 shared connections)
- [Room JSON Types](Room_JSON_Types.md) (7 shared connections)
- [RPS Game Client Types](RPS_Game_Client_Types.md) (6 shared connections)
- [Match Pool Durable Object Alarm](Match_Pool_Durable_Object_Alarm.md) (4 shared connections)
- [Party Gateway](Party_Gateway.md) (3 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (2 shared connections)
- [WebSocket Testing](WebSocket_Testing.md) (2 shared connections)
- [Durable Objects Rate Limiting](Durable_Objects_Rate_Limiting.md) (2 shared connections)
- [Observability](Observability.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/test/worker.integration.test.ts`

## Audit Trail

- EXTRACTED: 225 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*