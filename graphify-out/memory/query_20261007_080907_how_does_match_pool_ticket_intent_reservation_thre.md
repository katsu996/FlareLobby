---
type: "query"
date: "2026-10-07T08:09:07.055409+00:00"
question: "How does match pool ticket intent reservation three stage work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["MatchPoolDurableObject"]
---

# Q: How does match pool ticket intent reservation three stage work

## Answer

Expanded via vocab match ticket pool intent reserve candidate. MatchPoolDurableObject L536 deg91 implements IMatchPool L32; processPendingMatches L807 deg20 drives search reserve claim; reserveCandidateRows L1937 reserves then ensureMatchIntent L2048 creates room record; claim L2188 processes claimed intent.

## Outcome

- Signal: useful

## Source Nodes

- MatchPoolDurableObject