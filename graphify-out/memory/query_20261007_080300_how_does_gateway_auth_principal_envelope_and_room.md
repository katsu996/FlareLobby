---
type: "query"
date: "2026-10-07T08:03:00.544057+00:00"
question: "How does gateway auth principal envelope and room token conversion work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["GatewayPrincipalEnvelope"]
---

# Q: How does gateway auth principal envelope and room token conversion work

## Answer

Expanded via vocab auth gateway principal token security. authenticateGatewayRequest L252 fans to matchmaking party WS upgrades and createGatewayPrincipalEnvelope L563; envelope L130 degree 62 referenced by all operation options; createSignedToken L888 signs via signTokenSegment; verify purpose L504 splits join resume; normalizePrincipal L221 verifies both envelope and room token.

## Outcome

- Signal: useful

## Source Nodes

- GatewayPrincipalEnvelope