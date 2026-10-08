---
type: "query"
date: "2026-10-07T08:06:15.893944+00:00"
question: "How does rate limit durable object principal shard work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["RateLimitDurableObject"]
---

# Q: How does rate limit durable object principal shard work

## Answer

Expanded via vocab rate limit durable principal gateway. RateLimitDurableObject L31 consume L44 resolves principal L112 verifies envelope then claimPrincipalShard L121; allowed denied decisions L130 L134; WS path consumeWebSocketMessageRateLimit Handler L799 room L2700 gates handleWebSocketMessage.

## Outcome

- Signal: useful

## Source Nodes

- RateLimitDurableObject