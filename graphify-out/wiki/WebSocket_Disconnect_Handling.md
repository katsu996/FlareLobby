# WebSocket Disconnect Handling

> 17 nodes · cohesion 0.12

## Key Concepts

- **.handleFetch()** (29 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **RoomConnectionRow** (5 connections) — `packages/cloudflare/src/room.ts`
- **readPositiveHeader()** (4 connections) — `packages/cloudflare/src/room.ts`
- **.expireDisconnectedParticipant()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readRoomConnection()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readRoomRow()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.verifyWebSocketRoomToken()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.cancelDisconnectOperation()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.getDisconnectGracePeriodMs()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.getResumeTokenTtlMs()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.getWebSocketRoomId()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.hasWebSocketProtocol()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readLastRevision()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readResumeEvents()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readSnapshot()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.readWebSocketJoinToken()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.synchronizeAlarm()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Relationships

- [Room WebSocket Handler](Room_WebSocket_Handler.md) (15 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (3 shared connections)
- [Room Persistence Layer](Room_Persistence_Layer.md) (3 shared connections)
- [WebSocket Send Handler](WebSocket_Send_Handler.md) (3 shared connections)
- [WebSocket Attachment Store](WebSocket_Attachment_Store.md) (3 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (2 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (2 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (2 shared connections)
- [Room Participant Roles](Room_Participant_Roles.md) (2 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (1 shared connections)
- [Match Settlement Helpers](Match_Settlement_Helpers.md) (1 shared connections)
- [Observability Logging](Observability_Logging.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Audit Trail

- EXTRACTED: 32 (59%)
- INFERRED: 22 (41%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*