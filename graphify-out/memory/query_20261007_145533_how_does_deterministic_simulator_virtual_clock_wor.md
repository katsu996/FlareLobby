---
type: "query"
date: "2026-10-07T14:55:33.695001+00:00"
question: "How does deterministic simulator virtual clock work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["VirtualClock"]
---

# Q: How does deterministic simulator virtual clock work

## Answer

Expanded via vocab clock simulation random player. VirtualClock L28 implements AdvancingClock L15 with advanceBy advanceTo; SeededRandom L22 gives deterministic next; SimulationConfig L78 binds seed players; replay L507 re-runs simulateMatchmaking.

## Outcome

- Signal: useful

## Source Nodes

- VirtualClock