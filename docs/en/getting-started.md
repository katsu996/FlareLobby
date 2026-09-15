# English Quick Start

[日本語トップ](/) · [日本語の導入ガイド](/getting-started)

This page is the small English entry point for installing FlareLobby, wiring
authentication, and checking two connected players. Detailed API and feature
guides remain Japanese and are marked as `Japanese` below.

## 1. Requirements

For an application project, use Node.js `>=22.12.0` and pnpm `11.21.0`.
Cloudflare Workers and Durable Objects are the supported runtime. You need an
application authentication service that can issue and verify a token for each
player.

## 2. Get the standalone template

The official starting point is the
[standalone template on GitHub](https://github.com/katsu996/FlareLobby/tree/main/templates/standalone).
Copy `templates/standalone` into your own project, or clone the repository and
copy it:

```sh
git clone https://github.com/katsu996/FlareLobby.git
cp -R FlareLobby/templates/standalone my-flarelobby
cd my-flarelobby
```

The template uses published package versions and does not depend on the
repository workspace. If those versions are not on your registry yet, wait for
the package release or follow the [Japanese tarball verification steps](/getting-started#npm-利用者向け導入)
before treating this as an npm installation.

## 3. Install and configure the local secret

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

Replace `FLARE_LOBBY_TOKEN_SECRET` in `.dev.vars` with a long random value.
Keep `database_id` unset for local use and never commit `.dev.vars`.

## 4. Connect application authentication

The template deliberately rejects protected operations until authentication is
connected. Replace `verifyApplicationToken()` in `src/index.ts` with your
application's token verification and return a verified subject as `{ id,
playerId }`. The `authenticate` hook must never treat an arbitrary Bearer
string as proof of identity. Add an explicit `authorization` hook for the
operations your application permits.

In `src/browser.ts`, replace `getAccessToken()` with the function that returns
the logged-in player's issued token. Do not put access, join, or reconnect
tokens in URLs or logs.

The typed Worker connection example is
[`docs/examples/npm-standalone-worker.ts`](https://github.com/katsu996/FlareLobby/blob/main/docs/examples/npm-standalone-worker.ts).
The configuration example is
[`docs/examples/cloudflare-config.ts`](https://github.com/katsu996/FlareLobby/blob/main/docs/examples/cloudflare-config.ts).

## 5. Worker and database setup

The template declares five Durable Object namespaces and one D1 binding. Its
required bindings are `FLARE_LOBBY_ROOMS`, `FLARE_LOBBY_MATCH_POOLS`,
`FLARE_LOBBY_PARTIES`, `FLARE_LOBBY_PARTY_MEMBERSHIPS`, `FLARE_LOBBY_RATE_LIMITS`,
`FLARE_LOBBY_DB`, and `FLARE_LOBBY_TOKEN_SECRET`.

The D1 configuration points `migrations_dir` at
`node_modules/@flarelobby/cloudflare/migrations`. Do not copy migrations into
the application. Generate Worker types before checking the application:

```sh
pnpm generate:types
pnpm typecheck
```

## 6. Run the template

Apply local D1 migrations and start the Worker:

```sh
pnpm db:apply:local
pnpm dev:worker
```

In another terminal, start the browser:

```sh
pnpm dev:browser
```

The Worker is at `http://localhost:8787` and the browser is at
`http://localhost:5173`. The template allows the local browser origin through
CORS. Replace that origin with your production origin when deploying.

## 7. Minimal Client SDK code

The same example is type-checked as
[`docs/examples/english-quick-start.ts`](../examples/english-quick-start.ts):

```ts
<<< ../examples/english-quick-start.ts
```

The client uses the application token for HTTP and WebSocket requests. The
server still decides whether the authenticated player may create, join, or
operate a room.

## 8. Check with two players

After authentication is connected:

1. Open the browser URL in two browser windows or profiles and sign in as two
   different players.
2. In the first window, create an invitation room and copy its invitation code.
3. In the second window, enter the code and join as a player.
4. Confirm that both windows show the same room and that the server accepts
   both authenticated connections.

For the repository's full ready-state and 1v1 flow, run the
[Japanese local demo guide](/local-demo) and repeat the invitation flow in two
browser windows. The demo's player-name authentication is local-only and must
not be used in a deployed Worker.

## Terms

| Term        | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| room        | A Durable Object-backed lobby for players and spectators     |
| party       | A group that queues or joins together                        |
| matchmaking | The process that searches a pool and forms a match           |
| ticket      | A player's or party's waiting request in a matchmaking pool  |
| ready       | A player's explicit readiness state in a room                |
| reconnect   | Restoring a room connection from a resume token and revision |
| rating      | Season-scoped ELO or Glicko-2 match results stored in D1     |

## Japanese detailed guides

- [Japanese: API Reference](/api-reference)
- [Japanese: Client SDK](/client)
- [Japanese: Custom rooms](/custom-room-guide)
- [Japanese: Matchmaking](/matchmaking-guide)
- [Japanese: Cloudflare configuration](/cloudflare-configuration)
- [Japanese: Security](/security)
- [Japanese: Testing and verification](/testing)
