# WebSocket Send Handler

> 10 nodes · cohesion 0.24

## Key Concepts

- **.handleWebSocketMessageInternal()** (11 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **RoomWebSocketHandler** (10 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.normalizeWebSocketError()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.sendProtocolMessage()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.consumeWebSocketMessageRateLimit()** (3 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.closeWebSocketSafely()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.sendWebSocketFailure()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.validateWebSocketCommand()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.constructor()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.handleWebSocketMessage()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Relationships

- [Room WebSocket Handler](Room_WebSocket_Handler.md) (7 shared connections)
- [WebSocket Disconnect Handling](WebSocket_Disconnect_Handling.md) (3 shared connections)
- [WebSocket Attachment Store](WebSocket_Attachment_Store.md) (3 shared connections)
- [WebSocket Handler Tests](WebSocket_Handler_Tests.md) (1 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (1 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (1 shared connections)
- [Party Gateway Routes](Party_Gateway_Routes.md) (1 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Audit Trail

- EXTRACTED: 21 (72%)
- INFERRED: 8 (28%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*