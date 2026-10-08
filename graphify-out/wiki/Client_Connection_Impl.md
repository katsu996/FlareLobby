# Client Connection Impl

> 60 nodes · cohesion 0.07

## Key Concepts

- **client.ts** (76 connections) — `packages/client/src/client.ts`
- **FlareLobbyClientImpl** (21 connections) — `packages/client/src/client.ts`
- **.connectWithToken()** (12 connections) — `packages/client/src/client.ts`
- **.connectEventStream()** (10 connections) — `packages/client/src/client.ts`
- **.constructor()** (9 connections) — `packages/client/src/client.ts`
- **.request()** (8 connections) — `packages/client/src/client.ts`
- **.requestWithoutTimeout()** (8 connections) — `packages/client/src/client.ts`
- **.close()** (8 connections) — `packages/client/src/client.ts`
- **createWebSocketProtocols()** (7 connections) — `packages/client/src/client.ts`
- **.connectEventStreamWithTimeout()** (7 connections) — `packages/client/src/client.ts`
- **.requestWithTimeout()** (7 connections) — `packages/client/src/client.ts`
- **.send()** (7 connections) — `packages/client/src/client.ts`
- **normalizeHttpError()** (7 connections) — `packages/client/src/client.ts`
- **.waitForOpen()** (7 connections) — `packages/client/src/client.ts`
- **CustomRoomClientApi** (7 connections) — `packages/client/src/custom-room.ts`
- **.connectWithTimeout()** (6 connections) — `packages/client/src/client.ts`
- **throwIfAborted()** (6 connections) — `packages/client/src/client.ts`
- **isNonEmptyString()** (5 connections) — `packages/client/src/client.ts`
- **isRecord()** (5 connections) — `packages/client/src/client.ts`
- **normalizeClientError()** (5 connections) — `packages/client/src/client.ts`
- **normalizeTimeoutOption()** (5 connections) — `packages/client/src/client.ts`
- **CustomRoomListPage** (5 connections) — `packages/client/src/custom-room.ts`
- **CustomRoomListQuery** (5 connections) — `packages/client/src/custom-room.ts`
- **createErrorWithRequestId()** (4 connections) — `packages/client/src/client.ts`
- **isAbortError()** (4 connections) — `packages/client/src/client.ts`
- *... and 35 more nodes in this community*

## Relationships

- [Client SDK Entry](Client_SDK_Entry.md) (27 shared connections)
- [Client WebSocket Impl](Client_WebSocket_Impl.md) (10 shared connections)
- [Custom Room Client Types](Custom_Room_Client_Types.md) (7 shared connections)
- [Room Subscription API](Room_Subscription_API.md) (7 shared connections)
- [Client Party API](Client_Party_API.md) (6 shared connections)
- [Client Matchmaking API](Client_Matchmaking_API.md) (4 shared connections)
- [Client SDK Tests](Client_SDK_Tests.md) (3 shared connections)
- [Client Transport Types](Client_Transport_Types.md) (2 shared connections)
- [Room Ready Operations](Room_Ready_Operations.md) (1 shared connections)
- [Room WebSocket Client](Room_WebSocket_Client.md) (1 shared connections)

## Source Files

- `@flarelobby/core`
- `packages/client/src/client.ts`
- `packages/client/src/custom-room.ts`

## Audit Trail

- EXTRACTED: 198 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*