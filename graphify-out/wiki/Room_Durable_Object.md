# Room Durable Object

> 81 nodes · cohesion 0.08

## Key Concepts

- **RoomDurableObject** (94 connections) — `packages/cloudflare/src/room.ts`
- **.fetch()** (27 connections) — `packages/cloudflare/src/room.ts`
- **.leave()** (20 connections) — `packages/cloudflare/src/room.ts`
- **.readRoomRow()** (18 connections) — `packages/cloudflare/src/room.ts`
- **normalizeOperationRequest()** (17 connections) — `packages/cloudflare/src/room.ts`
- **.readSnapshot()** (17 connections) — `packages/cloudflare/src/room.ts`
- **.kick()** (16 connections) — `packages/cloudflare/src/room.ts`
- **.broadcastRoomSnapshot()** (15 connections) — `packages/cloudflare/src/room.ts`
- **.close()** (15 connections) — `packages/cloudflare/src/room.ts`
- **.dispatchWebSocketCommand()** (15 connections) — `packages/cloudflare/src/room.ts`
- **assertWaitingRoom()** (14 connections) — `packages/cloudflare/src/room.ts`
- **.join()** (14 connections) — `packages/cloudflare/src/room.ts`
- **.enqueueCustomRoomIndexSync()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.transferHost()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.updateSettings()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.expireDisconnectedParticipant()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.selectTeam()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.startMatch()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.handleWebSocketMessage()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.setReady()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.synchronizeAlarm()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.readRequiredSnapshot()** (10 connections) — `packages/cloudflare/src/room.ts`
- **.recordProcessedCommand()** (10 connections) — `packages/cloudflare/src/room.ts`
- **.restoreOperationResult()** (10 connections) — `packages/cloudflare/src/room.ts`
- **.storeOperationResult()** (10 connections) — `packages/cloudflare/src/room.ts`
- *... and 56 more nodes in this community*

## Relationships

- [Room Normalization Logic](Room_Normalization_Logic.md) (40 shared connections)
- [Room Index Sync](Room_Index_Sync.md) (23 shared connections)
- [Room Operations](Room_Operations.md) (13 shared connections)
- [Match Settlement Helpers](Match_Settlement_Helpers.md) (5 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (5 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (4 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (4 shared connections)
- [Room Ready Operations](Room_Ready_Operations.md) (3 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (3 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (3 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (2 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/test/worker.integration.test.ts`

## Audit Trail

- EXTRACTED: 390 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*