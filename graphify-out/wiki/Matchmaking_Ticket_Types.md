# Matchmaking Ticket Types

> 37 nodes · cohesion 0.10

## Key Concepts

- **PartyImpl** (38 connections) — `packages/client/src/party.ts`
- **.attachConnection()** (8 connections) — `packages/client/src/party.ts`
- **.connect()** (8 connections) — `packages/client/src/party.ts`
- **.handlePayload()** (7 connections) — `packages/client/src/party.ts`
- **.settle()** (7 connections) — `packages/client/src/party.ts`
- **.stopConnection()** (7 connections) — `packages/client/src/party.ts`
- **RawJsonEventConnection** (7 connections) — `packages/client/src/party.ts`
- **MatchmakingTicketCancelOptions** (6 connections) — `packages/client/src/matchmaking.ts`
- **.attemptReconnect()** (6 connections) — `packages/client/src/party.ts`
- **.joinRankedQueue()** (6 connections) — `packages/client/src/party.ts`
- **.setConnectionStatus()** (6 connections) — `packages/client/src/party.ts`
- **MatchmakingTicketSnapshot** (5 connections) — `packages/client/src/matchmaking.ts`
- **normalizeClientError()** (5 connections) — `packages/client/src/party.ts`
- **.cancelQueue()** (5 connections) — `packages/client/src/party.ts`
- **.handleConnectionClosed()** (5 connections) — `packages/client/src/party.ts`
- **.scheduleReconnect()** (5 connections) — `packages/client/src/party.ts`
- **.close()** (4 connections) — `packages/client/src/party.ts`
- **isRetryableReconnectError()** (3 connections) — `packages/client/src/party.ts`
- **isTerminalQueueStatus()** (3 connections) — `packages/client/src/party.ts`
- **.cancelQueue()** (3 connections) — `packages/client/src/party.ts`
- **.createEventPath()** (3 connections) — `packages/client/src/party.ts`
- **.dispose()** (3 connections) — `packages/client/src/party.ts`
- **.requestResync()** (3 connections) — `packages/client/src/party.ts`
- **.start()** (3 connections) — `packages/client/src/party.ts`
- **.unsubscribeClose()** (3 connections) — `packages/client/src/party.ts`
- *... and 12 more nodes in this community*

## Relationships

- [Matchmaking Reconnection](Matchmaking_Reconnection.md) (24 shared connections)
- [Client Find Match](Client_Find_Match.md) (6 shared connections)
- [Client Library](Client_Library.md) (4 shared connections)
- [Client Request/Command Types](Client_Request-Command_Types.md) (2 shared connections)
- [Custom Room Client Types](Custom_Room_Client_Types.md) (2 shared connections)
- [Request ID Creation](Request_ID_Creation.md) (2 shared connections)

## Source Files

- `packages/client/src/matchmaking.ts`
- `packages/client/src/party.ts`

## Audit Trail

- EXTRACTED: 107 (98%)
- INFERRED: 2 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*