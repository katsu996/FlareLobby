---
type: "query"
date: "2026-10-07T07:22:43.561900+00:00"
question: "How does store read processed command revision idempotency work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["NormalizedOperationRequest", "RoomProcessedCommand"]
---

# Q: How does store read processed command revision idempotency work

## Answer

Expanded via vocab room operation revision normalization. NormalizedOperationRequest room.ts L4243 is key; readProcessedCommand Persistence L703 restores via restoreOperationResult L754; recordProcessedCommand room.ts L1893 executes then storeOperationResult L3188 records; incrementRevision L3337 bumps only on success.

## Outcome

- Signal: useful

## Source Nodes

- NormalizedOperationRequest
- RoomProcessedCommand