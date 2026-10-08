---
type: "query"
date: "2026-10-07T14:55:13.964812+00:00"
question: "How does client reconnect resume handshake work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["FlareLobbyClient"]
---

# Q: How does client reconnect resume handshake work

## Answer

Expanded via vocab client room reconnect resume websocket. FlareLobbyClient L177 delegates to Impl L249; RoomImpl L607 deg44 handles reconnectDelay L1037 scheduleReconnect resync L1129 replaceSnapshot; WS Impl L1150 handles open message close; PendingCommand L1142 queues.

## Outcome

- Signal: useful

## Source Nodes

- FlareLobbyClient