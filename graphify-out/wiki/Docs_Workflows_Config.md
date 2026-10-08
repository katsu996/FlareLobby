# Docs Workflows Config

> 28 nodes · cohesion 0.08

## Key Concepts

- **D1 migrations 0001, 0002, 0004, 0005 public with 0003 local-demo excluded** (5 connections) — `docs/cloudflare-configuration.md`
- **Required Binding and Secret validation with RATE_LIMIT binding and 500 rejection** (3 connections) — `.changeset/issue-81-binding-validation.md`
- **Browser Client SDK with fetch, WebSocket, custom rooms, matchmaking, and parties** (3 connections) — `docs/client.md`
- **Error display recipe branching only on FlareLobbyError.code** (3 connections) — `docs/client.md`
- **Required Cloudflare bindings including FLARE_LOBBY_RATE_LIMITS and DO namespaces** (3 connections) — `docs/cloudflare-configuration.md`
- **CORS principle: exact origin match, 204 preflight first, not a substitute for authorization** (3 connections) — `docs/cloudflare-configuration.md`
- **FlareLobby game-lobby library for Cloudflare Workers and Durable Objects** (3 connections) — `README.md`
- **TIMEOUT stable error with requestId, no auto-retry; CANCELLED for AbortSignal/dispose** (2 connections) — `.changeset/client-timeout.md`
- **Sec-WebSocket-Protocol flarelobby.v1 for MatchPool and Party ticket/party event WebSockets** (2 connections) — `.changeset/consumer-ws-subprotocol.md`
- **Gateway cors.allowedOrigins and CORS preflight 204 handling** (2 connections) — `.changeset/cors-allowed-origins.md`
- **SDK HTTP error httpStatus and retryAfterSeconds metadata** (2 connections) — `.changeset/issue-87-http-error-metadata.md`
- **client.dispose/destroy local termination of matchmaking tickets with CANCELLED** (2 connections) — `.changeset/matchmaking-client-dispose.md`
- **CHANGELOG Unreleased section with user-facing changes** (2 connections) — `CHANGELOG.md`
- **defineFlareLobby gateway configuration with bindings, CORS, and observability** (2 connections) — `docs/api-reference.md`
- **FlareLobbyError with code, requestId, httpStatus, retryAfterSeconds, and toJSON** (2 connections) — `docs/api-reference.md`
- **Timeout mechanism with undefined inheritance, null infinite, and TIMEOUT no-retry rule** (2 connections) — `docs/client.md`
- **FLARE_LOBBY_TOKEN_SECRET signing key with TOKEN_SECRET_MISSING validation** (2 connections) — `docs/cloudflare-configuration.md`
- **npm user installation from standalone template without cloning repo** (2 connections) — `docs/getting-started.md`
- **Repository developer local sample with local-demo Worker and x-demo-player auth** (2 connections) — `docs/getting-started.md`
- **Public hosted RPS demo with invite links and dedicated staging resources** (2 connections) — `docs/hosted-demo.md`
- **Supabase anonymous login with CAPTCHA and JWKS verification for hosted demo** (2 connections) — `docs/hosted-demo.md`
- **FlareLobbyClientOptions timeout options (requestTimeoutMs, connectionTimeoutMs, commandTimeoutMs, timeoutMs)** (1 connections) — `.changeset/client-timeout.md`
- **INVALID_CORS_CONFIGURATION error code** (1 connections) — `.changeset/cors-allowed-origins.md`
- **D1 migrations bundled in published package for external Wrangler** (1 connections) — `.changeset/d1-migrations-package.md`
- **Continuous Verification workflow (build, test, coverage, ESM, deploy dry-run, consumer E2E)** (1 connections) — `.github/workflows/continuous-verification.yml`
- *... and 3 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `.changeset/client-timeout.md`
- `.changeset/consumer-ws-subprotocol.md`
- `.changeset/cors-allowed-origins.md`
- `.changeset/d1-migrations-package.md`
- `.changeset/issue-81-binding-validation.md`
- `.changeset/issue-87-http-error-metadata.md`
- `.changeset/matchmaking-client-dispose.md`
- `.github/workflows/continuous-verification.yml`
- `.github/workflows/docs-pages.yml`
- `CHANGELOG.md`
- `README.md`
- `docs/api-reference.md`
- `docs/client.md`
- `docs/cloudflare-configuration.md`
- `docs/getting-started.md`
- `docs/hosted-demo.md`

## Audit Trail

- EXTRACTED: 18 (62%)
- INFERRED: 11 (38%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*