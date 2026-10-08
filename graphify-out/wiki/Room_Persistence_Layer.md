# Room Persistence Layer

> 57 nodes · cohesion 0.05

## Key Concepts

- **RoomPersistence** (40 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **RoomPersistence.ts** (24 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **ParticipantRow** (23 connections) — `packages/cloudflare/src/room.ts`
- **room-persistence.test.ts** (15 connections) — `packages/cloudflare/test/room-persistence.test.ts`
- **.readRoomRow()** (7 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.readSnapshot()** (6 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **RoomScheduledOperationKind** (6 connections) — `packages/cloudflare/src/room.ts`
- **.readProcessedCommand()** (5 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.recordProcessedCommand()** (5 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.scheduleOperation()** (5 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **createRoomState()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.scheduleParticipantDisconnect()** (4 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **deepFreeze()** (3 connections) — `packages/cloudflare/src/room.ts`
- **.insertScheduledOperation()** (3 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.markWebSocketDisconnected()** (3 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.readRoomConnection()** (3 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.restoreOperationResult()** (3 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.readParticipantById()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **NextAlarmRow** (2 connections) — `packages/cloudflare/src/room.ts`
- **ProcessedCommandRow** (2 connections) — `packages/cloudflare/src/room.ts`
- **RoomEventRow** (2 connections) — `packages/cloudflare/src/room.ts`
- **.parseRoomSnapshotResult()** (2 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.purgeExpiredProcessedCommands()** (2 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.readOldestPlayerParticipant()** (2 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- **.readParticipantById()** (2 connections) — `packages/cloudflare/src/room/RoomPersistence.ts`
- *... and 32 more nodes in this community*

## Relationships

- [Room Normalization Logic](Room_Normalization_Logic.md) (13 shared connections)
- [Room Index Sync](Room_Index_Sync.md) (10 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (6 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (6 shared connections)
- [Room Operations](Room_Operations.md) (5 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (4 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (3 shared connections)
- [WebSocket Attachment Store](WebSocket_Attachment_Store.md) (3 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (2 shared connections)
- [Room Ready Operations](Room_Ready_Operations.md) (2 shared connections)
- [Room Participant Roles](Room_Participant_Roles.md) (2 shared connections)
- [Operation Result Store](Operation_Result_Store.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/RoomPersistence.ts`
- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- `packages/cloudflare/test/room-persistence.test.ts`

## Audit Trail

- EXTRACTED: 137 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*