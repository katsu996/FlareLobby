import { DurableObject } from "cloudflare:workers";
export { RoomDurableObject } from "./room.js";
import {
  FLARE_LOBBY_RATE_LIMIT_SCOPES,
  verifyGatewayPrincipalEnvelope
} from "./security.js";
import type {
  FlareLobbyRateLimitDecision,
  FlareLobbyRateLimitScope,
  GatewayPrincipalEnvelope
} from "./security.js";
import type { Principal } from "@flarelobby/core";

const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitRow extends Record<string, SqlStorageValue> {
  windowStartedAt: number;
  count: number;
}

interface RateLimitOwnerRow extends Record<string, SqlStorageValue> {
  principalId: string;
}

/**
 * 1 マッチングプール単位の待機チケットを保持する Durable Object です。
 *
 * プールの候補探索と成立処理は後続 Issue で実装します。
 */
export class MatchPoolDurableObject extends DurableObject<Env> {
  /** Gateway の署名済み主体だけを受け入れます。 */
  public async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope
  ): Promise<Principal | null> {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal
    );
  }
}

/**
 * 認証済み主体ごとに利用制限を保持する Durable Object です。
 *
 * Gateway は `principal.id` を DO の分割キーにし、クライアント申告値ではなく
 * Secret で署名済みの内部証明だけを `consume()` へ渡します。
 */
export class RateLimitDurableObject extends DurableObject<Env> {
  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS flarelobby_rate_limit_owner (
          principal_id TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS flarelobby_rate_limits (
          scope TEXT PRIMARY KEY,
          window_started_at INTEGER NOT NULL,
          count INTEGER NOT NULL
        );
      `);
    });
  }

  /**
   * 1 分間の操作回数を原子的に消費します。署名済み主体を検証できない要求は、
   * 制限超過と同じ安全な結果として拒否します。
   */
  public async consume(
    gatewayPrincipal: GatewayPrincipalEnvelope,
    scope: FlareLobbyRateLimitScope,
    limit: number
  ): Promise<FlareLobbyRateLimitDecision> {
    const principal = await this.resolveGatewayPrincipal(gatewayPrincipal);

    if (
      principal === null ||
      !isRateLimitScope(scope) ||
      !isPositiveSafeInteger(limit)
    ) {
      return deniedRateLimitDecision();
    }

    if (!this.claimPrincipalShard(principal)) {
      return deniedRateLimitDecision();
    }

    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec<RateLimitRow>(
        `SELECT
          window_started_at AS windowStartedAt,
          count
         FROM flarelobby_rate_limits
         WHERE scope = ?`,
        scope
      )
      .toArray()[0];

    if (
      row === undefined ||
      row.windowStartedAt + RATE_LIMIT_WINDOW_MS <= now
    ) {
      this.ctx.storage.sql.exec(
        `INSERT INTO flarelobby_rate_limits (scope, window_started_at, count)
         VALUES (?, ?, 1)
         ON CONFLICT(scope) DO UPDATE SET
           window_started_at = excluded.window_started_at,
           count = excluded.count`,
        scope,
        now
      );

      return allowedRateLimitDecision();
    }

    if (row.count >= limit) {
      return Object.freeze({
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((row.windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1_000)
        )
      });
    }

    this.ctx.storage.sql.exec(
      "UPDATE flarelobby_rate_limits SET count = count + 1 WHERE scope = ?",
      scope
    );

    return allowedRateLimitDecision();
  }

  private async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope
  ): Promise<Principal | null> {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal
    );
  }

  private claimPrincipalShard(principal: Principal): boolean {
    const owner = this.ctx.storage.sql
      .exec<RateLimitOwnerRow>(
        "SELECT principal_id AS principalId FROM flarelobby_rate_limit_owner LIMIT 1"
      )
      .toArray()[0];

    if (owner === undefined) {
      this.ctx.storage.sql.exec(
        "INSERT INTO flarelobby_rate_limit_owner (principal_id) VALUES (?)",
        principal.id
      );
      return true;
    }

    return owner.principalId === principal.id;
  }
}

function allowedRateLimitDecision(): FlareLobbyRateLimitDecision {
  return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
}

function deniedRateLimitDecision(): FlareLobbyRateLimitDecision {
  return Object.freeze({ allowed: false, retryAfterSeconds: 60 });
}

function isRateLimitScope(value: unknown): value is FlareLobbyRateLimitScope {
  return (
    typeof value === "string" &&
    FLARE_LOBBY_RATE_LIMIT_SCOPES.some((scope) => scope === value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
