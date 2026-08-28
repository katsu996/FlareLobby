# Matchmaking Retry Logic

> 38 nodes · cohesion 0.11

## Key Concepts

- **MatchmakingTicketImpl** (49 connections) — `packages/client/src/matchmaking.ts`
- **.waitForMatch()** (10 connections) — `packages/client/src/matchmaking.ts`
- **isTerminalStatus()** (8 connections) — `packages/client/src/matchmaking.ts`
- **.attachConnection()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.attemptReconnect()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.connect()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.ensureMatchRoom()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.handleConnectionClosed()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.resolveWaiters()** (7 connections) — `packages/client/src/matchmaking.ts`
- **.setConnectionStatus()** (6 connections) — `packages/client/src/matchmaking.ts`
- **.stopConnection()** (6 connections) — `packages/client/src/matchmaking.ts`
- **.handleTerminalState()** (5 connections) — `packages/client/src/matchmaking.ts`
- **.rejectWaiters()** (5 connections) — `packages/client/src/matchmaking.ts`
- **.scheduleReconnect()** (5 connections) — `packages/client/src/matchmaking.ts`
- **.cancelForAbort()** (4 connections) — `packages/client/src/matchmaking.ts`
- **.cancelIfNoWaiters()** (4 connections) — `packages/client/src/matchmaking.ts`
- **.rejectWaitersForTerminal()** (4 connections) — `packages/client/src/matchmaking.ts`
- **.removeWaiter()** (4 connections) — `packages/client/src/matchmaking.ts`
- **.start()** (4 connections) — `packages/client/src/matchmaking.ts`
- **isRetryableReconnectError()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.createEventPath()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.requestResync()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.unsubscribeConnectionClose()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.unsubscribeConnectionEvents()** (3 connections) — `packages/client/src/matchmaking.ts`
- **.waitingTimeMs()** (3 connections) — `packages/client/src/matchmaking.ts`
- *... and 13 more nodes in this community*

## Relationships

- [Custom Room Client Types](Custom_Room_Client_Types.md) (26 shared connections)
- [Custom Room Transport](Custom_Room_Transport.md) (5 shared connections)
- [Custom Room Player Types](Custom_Room_Player_Types.md) (4 shared connections)
- [Client Library](Client_Library.md) (2 shared connections)
- [Client Find Match](Client_Find_Match.md) (1 shared connections)
- [Client Request/Command Types](Client_Request-Command_Types.md) (1 shared connections)

## Source Files

- `packages/client/src/matchmaking.ts`

## Audit Trail

- EXTRACTED: 113 (99%)
- INFERRED: 1 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*