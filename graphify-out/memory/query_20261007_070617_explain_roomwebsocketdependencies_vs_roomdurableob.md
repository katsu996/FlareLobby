---
type: "explain"
date: "2026-10-07T07:06:17.486981+00:00"
question: "Explain RoomWebSocketDependencies vs RoomDurableObject responsibility boundary"
contributor: "graphify"
outcome: "useful"
source_nodes: ["RoomWebSocketDependencies", "RoomDurableObject", "RoomWebSocketHandler"]
---

# Q: Explain RoomWebSocketDependencies vs RoomDurableObject responsibility boundary

## Answer

Expanded via vocab: [room, websocket, handler, durable, object]. RoomDurableObject room.ts L570 degree 94 is entry/auth/dispatch; RoomWebSocketDependencies RoomWebSocketHandler.ts L64 degree 67 is protocol/validation/send; 30 overlapping methods show delegation; path is 3 hops via durable-objects.ts re-export, no direct edge.

## Outcome

- Signal: useful

## Source Nodes

- RoomWebSocketDependencies
- RoomDurableObject
- RoomWebSocketHandler