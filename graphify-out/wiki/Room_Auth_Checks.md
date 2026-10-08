# Room Auth Checks

> 18 nodes · cohesion 0.19

## Key Concepts

- **RoomRow** (27 connections) — `packages/cloudflare/src/room.ts`
- **RoomAuth.ts** (20 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **room-auth.test.ts** (20 connections) — `packages/cloudflare/test/room-auth.test.ts`
- **authenticateParticipant()** (7 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **resolveGatewayPrincipal()** (5 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **assertWaitingRoom()** (4 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **AuthenticatedRoomActor** (4 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **authenticateHost()** (4 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **readRequiredSnapshot()** (4 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **assertActiveRoom()** (3 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **assertInitializedRoom()** (3 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **assertPlayerRole()** (3 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **RoomAuthConfig** (2 connections) — `packages/cloudflare/src/room/RoomAuth.ts`
- **createGatewayPrincipal()** (2 connections) — `packages/cloudflare/test/room-auth.test.ts`
- **expectSyncErrorCode()** (1 connections) — `packages/cloudflare/test/room-auth.test.ts`
- **participantRow()** (1 connections) — `packages/cloudflare/test/room-auth.test.ts`
- **roomRow()** (1 connections) — `packages/cloudflare/test/room-auth.test.ts`
- **tamperedEnvelope()** (1 connections) — `packages/cloudflare/test/room-auth.test.ts`

## Relationships

- [Room Normalization Logic](Room_Normalization_Logic.md) (13 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (6 shared connections)
- [Room Persistence Layer](Room_Persistence_Layer.md) (6 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (5 shared connections)
- [Room Index Sync](Room_Index_Sync.md) (4 shared connections)
- [Room Ready Operations](Room_Ready_Operations.md) (3 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (3 shared connections)
- [Room Operations](Room_Operations.md) (3 shared connections)
- [Room State Machine](Room_State_Machine.md) (3 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (2 shared connections)
- [Room Participant Roles](Room_Participant_Roles.md) (2 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/RoomAuth.ts`
- `packages/cloudflare/test/room-auth.test.ts`

## Audit Trail

- EXTRACTED: 83 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*