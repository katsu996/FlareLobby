import { DurableObject } from "cloudflare:workers";
export type { IRoomDurableObject } from "./room.js";
export { RoomDurableObject } from "./room.js";
export type { IMatchPoolDurableObject } from "./match-pool.js";
export { MatchPoolDurableObject } from "./match-pool.js";
export { PartyDurableObject, PartyMembershipDurableObject } from "./party.js";
import {
  FLARE_LOBBY_RATE_LIMIT_SCOPES,
  verifyGatewayPrincipalEnvelope,
} from "./security.js";
import type {
  FlareLobbyRateLimitDecision,
  FlareLobbyRateLimitScope,
  GatewayPrincipalEnvelope,
} from "./security.js";
import type { Principal } from "@flarelobby/core";

const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitRow extends Record<string, SqlStorageValue> {
  windowStartedAt: number;
  count: number;
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
      migrateRateLimitSchema(this.ctx.storage.sql);
    });
  }

  /**
   * 1 分間の操作回数を原子的に消費します。署名済み主体を検証できない要求は、
   * 制限超過と同じ安全な結果として拒否します。
   */
  public async consume(
    gatewayPrincipal: GatewayPrincipalEnvelope,
    scope: FlareLobbyRateLimitScope,
    limit: number,
  ): Promise<FlareLobbyRateLimitDecision> {
    const principalResult =
      await this.resolveGatewayPrincipal(gatewayPrincipal);

    if (principalResult === null) {
      return deniedRateLimitDecision();
    }

    const principal = principalResult;
    const shardId = this.claimPrincipalShard(principal);

    const row = this.ctx.storage.sql
      .exec<RateLimitRow>(
        `SELECT window_started_at AS windowStartedAt, count
         FROM flarelobby_rate_limits
         WHERE scope = ? AND shard_id = ?`,
        scope,
        shardId,
      )
      .toArray()[0];

    const now = Date.now();
    const windowStartedAt = row?.windowStartedAt ?? now;
    const count = (row?.count ?? 0) + 1;

    if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      this.ctx.storage.sql.exec(
        `INSERT INTO flarelobby_rate_limits (scope, shard_id, window_started_at, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(scope, shard_id) DO UPDATE SET
           window_started_at = excluded.window_started_at,
           count = excluded.count`,
        scope,
        shardId,
        now,
      );
      return allowedRateLimitDecision();
    }

    if (count > limit) {
      const retryAfterSeconds = Math.ceil(
        (windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1000,
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      };
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO flarelobby_rate_limits (scope, shard_id, window_started_at, count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, shard_id) DO UPDATE SET
         window_started_at = excluded.window_started_at,
         count = excluded.count`,
      scope,
      shardId,
      windowStartedAt,
      count,
    );

    return allowedRateLimitDecision();
  }

  private async resolveGatewayPrincipal(
    gatewayPrincipal: GatewayPrincipalEnvelope,
  ): Promise<Principal | null> {
    return verifyGatewayPrincipalEnvelope(
      this.env.FLARE_LOBBY_TOKEN_SECRET,
      gatewayPrincipal,
    );
  }

  private claimPrincipalShard(principal: Principal): number {
    let hash = 0;
    for (let i = 0; i < principal.id.length; i++) {
      hash = (hash * 31 + principal.id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % FLARE_LOBBY_RATE_LIMIT_SCOPES.length;
  }
}

function allowedRateLimitDecision(): FlareLobbyRateLimitDecision {
  return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
}

function deniedRateLimitDecision(): FlareLobbyRateLimitDecision {
  return Object.freeze({ allowed: false, retryAfterSeconds: 60 });
}

function migrateRateLimitSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS flarelobby_rate_limits (
      scope TEXT NOT NULL,
      shard_id INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (scope, shard_id)
    )
  `);
}
