# Room Waiting State

> 26 nodes · cohesion 0.27

## Key Concepts

- **.leave()** (19 connections) — `packages/cloudflare/src/room.ts`
- **.kick()** (16 connections) — `packages/cloudflare/src/room.ts`
- **.broadcastRoomSnapshot()** (15 connections) — `packages/cloudflare/src/room.ts`
- **.close()** (15 connections) — `packages/cloudflare/src/room.ts`
- **.dispatchWebSocketCommand()** (15 connections) — `packages/cloudflare/src/room.ts`
- **.enqueueCustomRoomIndexSync()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.transferHost()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.updateSettings()** (13 connections) — `packages/cloudflare/src/room.ts`
- **.expireDisconnectedParticipant()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.selectTeam()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.startMatch()** (12 connections) — `packages/cloudflare/src/room.ts`
- **.setReady()** (11 connections) — `packages/cloudflare/src/room.ts`
- **.restoreOperationResult()** (10 connections) — `packages/cloudflare/src/room.ts`
- **.storeOperationResult()** (10 connections) — `packages/cloudflare/src/room.ts`
- **normalizeOperationRequest()** (9 connections) — `packages/cloudflare/src/room.ts`
- **.readRequiredSnapshot()** (9 connections) — `packages/cloudflare/src/room.ts`
- **.authenticateParticipant()** (8 connections) — `packages/cloudflare/src/room.ts`
- **.incrementRevision()** (8 connections) — `packages/cloudflare/src/room.ts`
- **.readParticipantById()** (8 connections) — `packages/cloudflare/src/room.ts`
- **assertWaitingRoom()** (7 connections) — `packages/cloudflare/src/room.ts`
- **.authenticateHost()** (7 connections) — `packages/cloudflare/src/room.ts`
- **.cancelDisconnectOperation()** (6 connections) — `packages/cloudflare/src/room.ts`
- **parseRoomSnapshotResult()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.invalidateResumeSessions()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.setHost()** (4 connections) — `packages/cloudflare/src/room.ts`
- *... and 1 more nodes in this community*

## Relationships

- [Room Lifecycle](Room_Lifecycle.md) (59 shared connections)
- [Room Management](Room_Management.md) (8 shared connections)
- [Room JSON Types](Room_JSON_Types.md) (8 shared connections)
- [Custom Room Index Types](Custom_Room_Index_Types.md) (8 shared connections)
- [Room Snapshot Events](Room_Snapshot_Events.md) (5 shared connections)
- [Party Gateway](Party_Gateway.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`

## Audit Trail

- EXTRACTED: 176 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*