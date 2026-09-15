---
layout: home

hero:
  name: FlareLobby
  text: Game lobbies on Cloudflare.
  tagline: Custom rooms, parties, matchmaking, and ratings through TypeScript APIs.
  actions:
    - theme: brand
      text: Quick Start
      link: /en/getting-started
    - theme: alt
      text: "Japanese: API Reference"
      link: /api-reference
    - theme: alt
      text: GitHub
      link: https://github.com/katsu996/FlareLobby

features:
  - title: Custom rooms
    details: Create invitation rooms, connect players, and restore room state after reconnects.
    link: /en/getting-started
    linkText: Start with the Quick Start
  - title: Parties and matchmaking
    details: Match individual players or parties with a Cloudflare Worker and Durable Objects.
    link: /matchmaking-guide
    linkText: "Japanese: Matchmaking guide"
  - title: Typed Client SDK
    details: Use browser HTTP and WebSocket APIs with typed room, party, ticket, and reconnect operations.
    link: /client
    linkText: "Japanese: Client SDK guide"
  - title: ELO and Glicko-2
    details: Store season ratings and match history in D1 from a trusted server boundary.
    link: /rating
    linkText: "Japanese: Rating guide"
---

## What FlareLobby covers

FlareLobby provides the lobby and the connection boundary around a match on
Cloudflare Workers and Durable Objects. Your game remains responsible for
authoritative game-state synchronization, physics, voice/video, and WebRTC.

Authentication is application-owned. Connect a verified token to the
template's `verifyApplicationToken()` and return the token from the browser's
`getAccessToken()` entry point before using protected operations.

## Start here

- [Quick Start](/en/getting-started)
- [Japanese: full documentation](/)
- [Japanese: API Reference](/api-reference)
- [Japanese: Security guide](/security)
- [llms.txt](/FlareLobby/llms.txt)
