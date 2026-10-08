# Operation Result Store

> 4 nodes · cohesion 0.50

## Key Concepts

- **NormalizedOperationRequest** (7 connections) — `packages/cloudflare/src/room.ts`
- **.readProcessedCommand()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.restoreOperationResult()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`
- **.storeOperationResult()** (2 connections) — `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Relationships

- [Room WebSocket Handler](Room_WebSocket_Handler.md) (3 shared connections)
- [Room Persistence Layer](Room_Persistence_Layer.md) (2 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (1 shared connections)
- [Room Normalization Logic](Room_Normalization_Logic.md) (1 shared connections)

## Source Files

- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/room/RoomWebSocketHandler.ts`

## Audit Trail

- EXTRACTED: 10 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*