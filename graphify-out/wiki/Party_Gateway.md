# Party Gateway

> 47 nodes · cohesion 0.08

## Key Concepts

- **GatewayPrincipalEnvelope** (43 connections) — `packages/cloudflare/src/security.ts`
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
- **MatchmakingTicketCancellationOptions** (4 connections) — `packages/cloudflare/src/match-pool.ts`
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
- **RoomParticipantDisconnectOptions** (4 connections) — `packages/cloudflare/src/room.ts`
- **normalizeGatewayError()** (3 connections) — `packages/cloudflare/src/party-gateway.ts`
- *... and 22 more nodes in this community*

## Relationships

- [RPS Game Client Types](RPS_Game_Client_Types.md) (26 shared connections)
- [Party System Core](Party_System_Core.md) (15 shared connections)
- [Matchmaking Gateway Tests](Matchmaking_Gateway_Tests.md) (6 shared connections)
- [FlareLobby Configuration](FlareLobby_Configuration.md) (5 shared connections)
- [Match Pool Durable Object](Match_Pool_Durable_Object.md) (4 shared connections)
- [Matchmaking with ADR 0004](Matchmaking_with_ADR_0004.md) (3 shared connections)
- [Room Management](Room_Management.md) (3 shared connections)
- [Match Pool Tests](Match_Pool_Tests.md) (3 shared connections)
- [Durable Objects Rate Limiting](Durable_Objects_Rate_Limiting.md) (3 shared connections)
- [Room Lifecycle](Room_Lifecycle.md) (3 shared connections)
- [Match Pool & Matchmaking](Match_Pool_&_Matchmaking.md) (2 shared connections)
- [Type Testing](Type_Testing.md) (2 shared connections)

## Source Files

- `packages/cloudflare/src/match-pool.ts`
- `packages/cloudflare/src/party-gateway.ts`
- `packages/cloudflare/src/party.ts`
- `packages/cloudflare/src/room.ts`
- `packages/cloudflare/src/security.ts`
- `packages/cloudflare/test/party-gateway.test.ts`

## Audit Trail

- EXTRACTED: 168 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*