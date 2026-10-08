---
type: "query"
date: "2026-10-07T07:24:32.653295+00:00"
question: "How does HMAC signed cursor paging for custom room list work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["CursorPayload", "CustomRoomListResult"]
---

# Q: How does HMAC signed cursor paging for custom room list work

## Answer

Expanded via vocab room custom list cursor query. listCustomRooms L93 normalizes L240 decodes L474 verifies via signCursor L551 constantTimeEqual L608; encode L455 signs; fingerprint L413 binds query to cursor; CURSOR_VERSION L16 versions.

## Outcome

- Signal: useful

## Source Nodes

- CursorPayload
- CustomRoomListResult