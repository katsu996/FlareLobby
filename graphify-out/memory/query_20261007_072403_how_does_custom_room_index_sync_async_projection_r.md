---
type: "query"
date: "2026-10-07T07:24:03.991792+00:00"
question: "How does custom room index sync async projection revision guard work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["CustomRoomIndexRecord", "ScheduledOperationRow"]
---

# Q: How does custom room index sync async projection revision guard work

## Answer

Expanded via vocab room index sync custom operation. enqueue room.ts L2007 deg13 fans in from state mutators; process RoomIndexSync L116 deg10 parses and upserts L115 or deletes L184 with ScheduledOperationRow L493; operation ID L27 retry delay L31 single flight; query L223 reads via listCustomRooms.

## Outcome

- Signal: useful

## Source Nodes

- CustomRoomIndexRecord
- ScheduledOperationRow