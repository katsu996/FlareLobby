---
type: "query"
date: "2026-10-07T08:09:35.825089+00:00"
question: "How does Elo Glicko2 rating registration idempotency work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["RatingEngine"]
---

# Q: How does Elo Glicko2 rating registration idempotency work

## Answer

Expanded via vocab rating elo glicko engine match result. RatingEngine core L27 with Elo L66 Glicko2 L210; registerMatchResult cloudflare L534 deg24 normalizes ensures rows finds existing match reads state creates engine writes SQL; findExistingMatch L1903 gives idempotency.

## Outcome

- Signal: useful

## Source Nodes

- RatingEngine