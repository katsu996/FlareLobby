---
type: "query"
date: "2026-10-07T11:40:35.961802+00:00"
question: "How does party N-person ticket bundling queue work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["PartyDurableObject"]
---

# Q: How does party N-person ticket bundling queue work

## Answer

Expanded via vocab party member invite queue ticket. PartyDurableObject L186 deg47 manages members invites; beginQueueTicket L650 sorts memberIds bumps revision appends event synchronizes alarm; endQueueTicket L705 dissolves; PartyQueueStub bridges to match-pool createTicket.

## Outcome

- Signal: useful

## Source Nodes

- PartyDurableObject