---
type: "query"
date: "2026-10-07T07:05:31.111141+00:00"
question: "Why does RoomDurableObject connect Room Durable Object to Rate Limit Durable Object, Room Normalization Logic, Custom Room Gateway, Gateway Configuration, Demo Auth Gateway, Room Interface Types, Room Index Sync, Hosted RPS Game Logic, Custom Room API Tests, Room Supplement Tests, Client Integration Tests, WebSocket Test Harness?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["RoomDurableObject", "RateLimitDurableObject", "RoomPersistence", "RoomIndexSync", "IRoomDurableObject"]
---

# Q: Why does RoomDurableObject connect Room Durable Object to Rate Limit Durable Object, Room Normalization Logic, Custom Room Gateway, Gateway Configuration, Demo Auth Gateway, Room Interface Types, Room Index Sync, Hosted RPS Game Logic, Custom Room API Tests, Room Supplement Tests, Client Integration Tests, WebSocket Test Harness?

## Answer

Expanded from original query via vocab: [room, durable, object, rate, limit, gateway, persistence, websocket, participant, index, sync, normalization]. Traversed from RoomDurableObject (packages/cloudflare/src/room.ts L570, degree 94). It is a bridge because room.ts hosts 70 methods, implements IRoomDurableObject, imports config FlareLobbyBindings, re-exported via index/durable-objects/demo indexes, and imported by 7 test suites.

## Outcome

- Signal: useful

## Source Nodes

- RoomDurableObject
- RateLimitDurableObject
- RoomPersistence
- RoomIndexSync
- IRoomDurableObject