---
type: "query"
date: "2026-10-07T07:23:14.314122+00:00"
question: "How does purge expired processed commands cleanup and synchronizeAlarm TTL work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["NextAlarmRow", "ScheduledOperationRow"]
---

# Q: How does purge expired processed commands cleanup and synchronizeAlarm TTL work

## Answer

Expanded via vocab room alarm sync schedule operation. purgeExpiredProcessedCommands room.ts L3095 calls alarm L2188; scheduleProcessedCommandCleanup L3075 schedules next purge; synchronizeAlarm L3513 multiplexes alarm cancel schedule close leave; getNextAlarm contract in 6 files; NextAlarmRow L519 ScheduledOperationRow L493 single Alarm multiplex.

## Outcome

- Signal: useful

## Source Nodes

- NextAlarmRow
- ScheduledOperationRow