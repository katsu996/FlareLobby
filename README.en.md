# FlareLobby

[日本語 README](./README.md)

FlareLobby is a game-lobby library for Cloudflare Workers and Durable Objects.
It provides custom rooms, parties, matchmaking, reconnectable real-time room
connections, and ELO/Glicko-2 rating storage through TypeScript APIs.

It owns the lobby and the connection boundary after a match is formed. Your
game still owns authoritative game-state synchronization, physics, voice/video,
and WebRTC.

## Install

For a published release, install the packages in your Worker project:

```sh
pnpm add @flarelobby/cloudflare @flarelobby/core @flarelobby/client
pnpm add -D wrangler vite typescript @types/node
```

The official standalone starting point is
[`templates/standalone`](./templates/standalone/README.md). Copy it into your
project, run its setup commands, and connect your application authentication
before using protected operations. The template shows the required Worker,
Durable Object, D1, secret, CORS, and browser entry points.

If the package versions are not available from your registry yet, use the
tarball verification steps in the [English Quick Start](./docs/en/getting-started.md)
instead of assuming that `pnpm add` can resolve them.

## Minimal client code

`getAccessToken` must return a token issued by your application authentication
service. Do not use an arbitrary Bearer string as user authentication.

```ts
import { createFlareLobbyClient } from "@flarelobby/client";

declare const auth: { getAccessToken(): Promise<string> };

const lobby = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
});

await lobby.createCustomRoom({
  name: "My room",
  visibility: "unlisted",
  joinMethod: "invitation",
});
```

## Try the local demo

The repository includes a runnable local demo with invitation rooms, ready
state, a 1v1 queue, reconnect, and rating results. From the repository root:

```sh
cp examples/local-demo/.dev.vars.example examples/local-demo/.dev.vars
pnpm --filter @flarelobby/example-local-demo dev
```

Open `http://localhost:8787/` in two browser windows. Create an invitation
room in the first window, enter its invitation code in the second, and confirm
that both players can connect and become ready. The demo authentication is for
local use only. See the [Japanese local-demo guide](./docs/local-demo.md) for
the full flow.

## Documentation

- [English home](https://katsu996.github.io/FlareLobby/en/)
- [English Quick Start](./docs/en/getting-started.md)
- [Japanese documentation](https://katsu996.github.io/FlareLobby/)
- [llms.txt](https://katsu996.github.io/FlareLobby/llms.txt)
- [Standalone template](./templates/standalone/README.md)
- [Supabase starter template](./templates/supabase/README.md)

The detailed API and feature guides remain Japanese for now. The English
pages identify those links as Japanese so you can choose the right entry point
before opening them.

## Packages

| Package                  | Role                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `@flarelobby/core`       | Platform-independent domain types, protocol, matchmaking, and ratings |
| `@flarelobby/cloudflare` | Cloudflare Worker gateway, Durable Objects, D1, and auth boundary     |
| `@flarelobby/client`     | Browser HTTP/WebSocket Client SDK                                     |
| `@flarelobby/testing`    | Deterministic clocks, random sources, and matchmaking simulation      |

## Scope

FlareLobby targets Cloudflare Workers and Durable Objects. It provides the
lobby and the connection boundary around a match. It does not provide the
authoritative game server, game-state synchronization, physics, voice/video,
WebRTC, an admin console, or a generic authentication service.
