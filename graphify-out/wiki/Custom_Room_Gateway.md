# Custom Room Gateway

> 74 nodes · cohesion 0.07

## Key Concepts

- **cloudflare/src/index.ts** (276 connections) — `packages/cloudflare/src/index.ts`
- **cloudflare/src/custom-room.ts** (86 connections) — `packages/cloudflare/src/custom-room.ts`
- **createCustomRoom()** (22 connections) — `packages/cloudflare/src/custom-room.ts`
- **joinCustomRoom()** (20 connections) — `packages/cloudflare/src/custom-room.ts`
- **FlareLobbyBindings** (17 connections) — `packages/cloudflare/src/config.ts`
- **leaveCustomRoom()** (15 connections) — `packages/cloudflare/src/custom-room.ts`
- **isNonEmptyString()** (12 connections) — `packages/cloudflare/src/custom-room.ts`
- **normalizeCustomRoomCreationInput()** (11 connections) — `packages/cloudflare/src/custom-room.ts`
- **RoomProcessedCommand** (11 connections) — `packages/cloudflare/src/room.ts`
- **isJsonObject()** (10 connections) — `packages/cloudflare/src/custom-room.ts`
- **normalizeCustomRoomJoinInput()** (10 connections) — `packages/cloudflare/src/custom-room.ts`
- **AuthenticatedGatewayRequest** (10 connections) — `packages/cloudflare/src/security.ts`
- **.join()** (7 connections) — `packages/cloudflare/src/custom-room.ts`
- **normalizeCustomRoomLeaveInput()** (7 connections) — `packages/cloudflare/src/custom-room.ts`
- **consumeRoomCreationRateLimit()** (6 connections) — `packages/cloudflare/src/config.ts`
- **CustomRoomGatewayStub** (6 connections) — `packages/cloudflare/src/custom-room.ts`
- **normalizeGatewayError()** (6 connections) — `packages/cloudflare/src/custom-room.ts`
- **parseJoinResult()** (6 connections) — `packages/cloudflare/src/custom-room.ts`
- **RoomProcessedCommandOptions** (6 connections) — `packages/cloudflare/src/room.ts`
- **verifyJoinToken()** (6 connections) — `packages/cloudflare/src/security.ts`
- **.getProcessedCommand()** (5 connections) — `packages/cloudflare/src/custom-room.ts`
- **.recordProcessedCommand()** (5 connections) — `packages/cloudflare/src/custom-room.ts`
- **parseCreationResult()** (5 connections) — `packages/cloudflare/src/custom-room.ts`
- **parseRoomParticipantLeaveResult()** (5 connections) — `packages/cloudflare/src/custom-room.ts`
- **RoomParticipantRole** (5 connections) — `packages/cloudflare/src/room.ts`
- *... and 49 more nodes in this community*

## Relationships

- [Gateway Configuration](Gateway_Configuration.md) (43 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (42 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (37 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (25 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (21 shared connections)
- [Observability Logging](Observability_Logging.md) (21 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (19 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (17 shared connections)
- [Rating History Storage](Rating_History_Storage.md) (15 shared connections)
- [Match Intent Records](Match_Intent_Records.md) (13 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (11 shared connections)
- [Room Index Sync](Room_Index_Sync.md) (8 shared connections)

## Source Files

- `packages/cloudflare/src/config.ts`
- `packages/cloudflare/src/custom-room.ts`
- `packages/cloudflare/src/index.ts`
- `packages/cloudflare/src/observability.ts`
- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/IRoom.ts`
- `packages/cloudflare/src/security.ts`

## Audit Trail

- EXTRACTED: 517 (99%)
- INFERRED: 3 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*