# Room Participant Roles

> 6 nodes · cohesion 0.33

## Key Concepts

- **FlareLobbyRoomParticipantRole** (12 connections) — `packages/cloudflare/src/security.ts`
- **.internalJoinParticipant()** (6 connections) — `packages/cloudflare/src/room/IRoom.ts`
- **.joinParticipant()** (6 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.createRoomSnapshotEvent()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.issueResumeToken()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.isRoomParticipantRole()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Relationships

- [Room WebSocket Handler](Room_WebSocket_Handler.md) (4 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (3 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (2 shared connections)
- [Room Persistence Layer](Room_Persistence_Layer.md) (2 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (2 shared connections)
- [WebSocket Attachment Store](WebSocket_Attachment_Store.md) (2 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (2 shared connections)
- [Custom Room Gateway](Custom_Room_Gateway.md) (2 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (1 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (1 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room/IRoom.ts`
- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 25 (93%)
- INFERRED: 2 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*