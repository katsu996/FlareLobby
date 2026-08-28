# WebSocket Testing

> 35 nodes · cohesion 0.08

## Key Concepts

- **websocket.test.ts** (33 connections) — `packages/cloudflare/test/websocket.test.ts`
- **cloudflare/test/custom-room.test.ts** (13 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **RoomScheduledOperation** (5 connections) — `packages/cloudflare/src/room.ts`
- **connectWithToken()** (4 connections) — `packages/cloudflare/test/websocket.test.ts`
- **operationRequest()** (3 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **connectViaStub()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **createDirectUpgradeRequest()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **createWebSocketRequest()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **encodeWebSocketToken()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **fetchUpgrade()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **registerSocketInbox()** (3 connections) — `packages/cloudflare/test/websocket.test.ts`
- **createRequest()** (2 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **createRoom()** (2 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **joinRoom()** (2 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **leaveRoom()** (2 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **connect()** (2 connections) — `packages/cloudflare/test/websocket.test.ts`
- **createPrincipalEnvelope()** (2 connections) — `packages/cloudflare/test/websocket.test.ts`
- **issuePlayerJoinToken()** (2 connections) — `packages/cloudflare/test/websocket.test.ts`
- **fetchRestricted()** (1 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **testLobby** (1 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **testWorker** (1 connections) — `packages/cloudflare/test/custom-room.test.ts`
- **closeSocket()** (1 connections) — `packages/cloudflare/test/websocket.test.ts`
- **createRoom()** (1 connections) — `packages/cloudflare/test/websocket.test.ts`
- **DirectUpgradeOptions** (1 connections) — `packages/cloudflare/test/websocket.test.ts`
- **initializeDirectRoom()** (1 connections) — `packages/cloudflare/test/websocket.test.ts`
- *... and 10 more nodes in this community*

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (7 shared connections)
- [Custom Room Creation](Custom_Room_Creation.md) (3 shared connections)
- [Room Management](Room_Management.md) (2 shared connections)
- [Type Testing](Type_Testing.md) (2 shared connections)
- [Room Lifecycle](Room_Lifecycle.md) (2 shared connections)
- [Party Gateway](Party_Gateway.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/test/custom-room.test.ts`
- `packages/cloudflare/test/websocket.test.ts`

## Audit Trail

- EXTRACTED: 62 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*