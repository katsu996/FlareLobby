---
type: "query"
date: "2026-10-07T14:56:16.043473+00:00"
question: "How does Supabase JWKS auth work"
contributor: "graphify"
outcome: "useful"
source_nodes: ["SupabasePrincipal"]
---

# Q: How does Supabase JWKS auth work

## Answer

Expanded via vocab supabase auth token jwks principal. authenticateSupabaseRequest L13 verifies via verifySupabaseAccessToken L24 which reads bearer L63 normalizes URL L68 fetches JWKS L88; SupabasePrincipal L4 maps to gateway principal.

## Outcome

- Signal: useful

## Source Nodes

- SupabasePrincipal