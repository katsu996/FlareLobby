# Party Gateway Routes

> 47 nodes · cohesion 0.08

## Key Concepts

- **GatewayPrincipalEnvelope** (62 connections) — `packages/cloudflare/src/security.ts`
- **party-gateway.ts** (33 connections) — `packages/cloudflare/src/party-gateway.ts`
- **handlePartyRequest()** (19 connections) — `packages/cloudflare/src/party-gateway.ts`
- **party-gateway.test.ts** (16 connections) — `packages/cloudflare/test/party-gateway.test.ts`
- **PartyGatewayStub** (11 connections) — `packages/cloudflare/src/party-gateway.ts`
- **PartySnapshot** (9 connections) — `packages/cloudflare/src/party.ts`
- **upgradePartyEventsWebSocket()** (8 connections) — `packages/cloudflare/src/party-gateway.ts`
- **PartyOperationOptions** (7 connections) — `packages/cloudflare/src/party.ts`
- **PartyCreationOptions** (5 connections) — `packages/cloudflare/src/party.ts`
- **PartyInviteAcceptanceOptions** (5 connections) — `packages/cloudflare/src/party.ts`
- **PartyInviteOptions** (5 connections) — `packages/cloudflare/src/party.ts`
- **PartyLeadershipTransferOptions** (5 connections) — `packages/cloudflare/src/party.ts`
- **getPartyWebSocketRoute()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.acceptInvite()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.createParty()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.dissolveParty()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.getSnapshot()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.inviteMember()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.leaveParty()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.transferLeadership()** (4 connections) — `packages/cloudflare/src/party-gateway.ts`
- **PartyEvent** (4 connections) — `packages/cloudflare/src/party.ts`
- **PartyInvite** (4 connections) — `packages/cloudflare/src/party.ts`
- **.getTicketForPrincipal()** (3 connections) — `packages/cloudflare/src/match-pool/IMatchPool.ts`
- **normalizeGatewayError()** (3 connections) — `packages/cloudflare/src/party-gateway.ts`
- **.fetch()** (3 connections) — `packages/cloudflare/src/party-gateway.ts`
- *... and 22 more nodes in this community*

## Relationships

- [Custom Room Gateway](Custom_Room_Gateway.md) (19 shared connections)
- [Party Durable Object](Party_Durable_Object.md) (16 shared connections)
- [Match Ticket Queue](Match_Ticket_Queue.md) (15 shared connections)
- [Room Interface Types](Room_Interface_Types.md) (8 shared connections)
- [Security Auth Hooks](Security_Auth_Hooks.md) (6 shared connections)
- [Gateway Configuration](Gateway_Configuration.md) (5 shared connections)
- [Gateway Principal Helpers](Gateway_Principal_Helpers.md) (4 shared connections)
- [Room Durable Object](Room_Durable_Object.md) (4 shared connections)
- [Matchmaking Gateway Routes](Matchmaking_Gateway_Routes.md) (3 shared connections)
- [Rate Limit Durable Object](Rate_Limit_Durable_Object.md) (3 shared connections)
- [Room Auth Checks](Room_Auth_Checks.md) (2 shared connections)
- [Match Settlement Tests](Match_Settlement_Tests.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool/IMatchPool.ts`
- `packages/cloudflare/src/party-gateway.ts`
- `packages/cloudflare/src/party.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/party-gateway.test.ts`

## Audit Trail

- EXTRACTED: 184 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*