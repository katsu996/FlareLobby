import { FlareLobbyError } from "@flarelobby/core";
import type { JsonObject, RoomStatus } from "@flarelobby/core";

/** 公開ルーム一覧へ投影できるカスタムルームの参加方式です。 */
export type CustomRoomIndexJoinMethod = "public" | "invitation" | "password";

/** 公開ルーム一覧へ反映する、秘密情報を含まない派生レコードです。 */
export interface CustomRoomIndexRecord extends JsonObject {
  readonly roomId: string;
  readonly name: string;
  readonly mode: string | null;
  readonly region: string | null;
  readonly state: RoomStatus;
  readonly joinMethod: CustomRoomIndexJoinMethod;
  readonly maxPlayers: number;
  readonly playerCount: number;
  readonly availableSlots: number;
  readonly maxSpectators: number;
  readonly spectatorCount: number;
  readonly availableSpectatorSlots: number;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Room 内の公開一覧同期を識別する固定キーです。 */
export const CUSTOM_ROOM_INDEX_SYNC_OPERATION_ID =
  "__flarelobby_custom_room_index_sync__";

/** D1 障害時に次回同期を再試行するまでの待機時間です。 */
export const CUSTOM_ROOM_INDEX_RETRY_DELAY_MS = 1_000;

const CUSTOM_ROOM_INDEX_TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS flarelobby_custom_room_index (
    room_id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    mode TEXT,
    region TEXT,
    visibility TEXT NOT NULL CHECK (visibility = 'public'),
    join_method TEXT NOT NULL CHECK (join_method IN ('public', 'invitation', 'password')),
    state TEXT NOT NULL CHECK (state IN ('waiting', 'preparing', 'in_progress', 'finished')),
    max_players INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    available_slots INTEGER NOT NULL,
    max_spectators INTEGER NOT NULL,
    spectator_count INTEGER NOT NULL,
    available_spectator_slots INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CUSTOM_ROOM_INDEX_FILTER_INDEX_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_flarelobby_custom_room_index_filters
    ON flarelobby_custom_room_index (visibility, state, mode, region, created_at DESC, room_id DESC)
`;

const CUSTOM_ROOM_INDEX_CAPACITY_INDEX_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_flarelobby_custom_room_index_capacity
    ON flarelobby_custom_room_index (available_slots, state, created_at DESC, room_id DESC)
`;

const INVITATION_INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS flarelobby_custom_room_invitations (
    invitation_code TEXT PRIMARY KEY,
    room_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )
`;

// Worker インスタンスごとに作成済みの初期化を記憶し、同一 D1 Binding への
// 繰り返し呼び出しで DDL を再実行しないようにします。失敗時はキャッシュを
// 破棄して次回呼び出しで再試行できるようにします。
const initializedCustomRoomIndexes = new WeakMap<D1Database, Promise<void>>();
const initializedCustomRoomInvitationIndexes = new WeakMap<
  D1Database,
  Promise<void>
>();

function ensureOnce(
  cache: WeakMap<D1Database, Promise<void>>,
  database: D1Database,
  initialize: () => Promise<void>,
): Promise<void> {
  let ready = cache.get(database);

  if (ready === undefined) {
    ready = initialize();
    ready.catch(() => {
      cache.delete(database);
    });
    cache.set(database, ready);
  }

  return ready;
}

/** 公開ルーム検索用の D1 派生テーブルを作成します。実行は冪等で、Worker ごとに 1 回だけ DDL を実行します。 */
export function ensureCustomRoomIndex(database: D1Database): Promise<void> {
  return ensureOnce(initializedCustomRoomIndexes, database, async () => {
    try {
      await database.batch([
        database.prepare(CUSTOM_ROOM_INDEX_TABLE_SCHEMA),
        database.prepare(CUSTOM_ROOM_INDEX_FILTER_INDEX_SCHEMA),
        database.prepare(CUSTOM_ROOM_INDEX_CAPACITY_INDEX_SCHEMA),
      ]);
    } catch {
      throw new FlareLobbyError("CONNECTION_FAILED");
    }
  });
}

/** 公開ルームの秘密情報を含まない派生レコードを D1 へ反映します。 */
export async function upsertCustomRoomIndex(
  database: D1Database,
  record: CustomRoomIndexRecord,
): Promise<void> {
  await ensureCustomRoomIndex(database);

  try {
    await database
      .prepare(
        `INSERT INTO flarelobby_custom_room_index (
          room_id,
          room_name,
          mode,
          region,
          visibility,
          join_method,
          state,
          max_players,
          player_count,
          available_slots,
          max_spectators,
          spectator_count,
          available_spectator_slots,
          revision,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          room_name = excluded.room_name,
          mode = excluded.mode,
          region = excluded.region,
          visibility = excluded.visibility,
          join_method = excluded.join_method,
          state = excluded.state,
          max_players = excluded.max_players,
          player_count = excluded.player_count,
          available_slots = excluded.available_slots,
          max_spectators = excluded.max_spectators,
          spectator_count = excluded.spectator_count,
          available_spectator_slots = excluded.available_spectator_slots,
          revision = excluded.revision,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE excluded.revision >= flarelobby_custom_room_index.revision`,
      )
      .bind(
        record.roomId,
        record.name,
        record.mode,
        record.region,
        record.joinMethod,
        record.state,
        record.maxPlayers,
        record.playerCount,
        record.availableSlots,
        record.maxSpectators,
        record.spectatorCount,
        record.availableSpectatorSlots,
        record.revision,
        record.createdAt,
        record.updatedAt,
      )
      .run();
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

/** 公開ルーム一覧からルームを削除します。再実行しても成功します。 */
export async function deleteCustomRoomIndex(
  database: D1Database,
  roomId: string,
): Promise<void> {
  if (!isNonEmptyString(roomId)) {
    throw new FlareLobbyError("INVALID_PAYLOAD");
  }

  await ensureCustomRoomIndex(database);

  try {
    await database
      .prepare("DELETE FROM flarelobby_custom_room_index WHERE room_id = ?")
      .bind(roomId)
      .run();
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

interface CustomRoomIndexRow extends Record<string, SqlStorageValue> {
  roomId: string;
  name: string;
  mode: string | null;
  region: string | null;
  state: RoomStatus;
  joinMethod: CustomRoomIndexJoinMethod;
  maxPlayers: number;
  playerCount: number;
  availableSlots: number;
  maxSpectators: number;
  spectatorCount: number;
  availableSpectatorSlots: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** 検索条件へ一致する公開一覧の行を取得します。 */
export async function queryCustomRoomIndex(
  database: D1Database,
  options: {
    readonly mode?: string;
    readonly region?: string;
    readonly states?: readonly RoomStatus[];
    readonly requireAvailable?: boolean;
    readonly minAvailableSlots?: number;
    readonly cursor?: { readonly createdAt: number; readonly roomId: string };
    readonly limit: number;
  },
): Promise<readonly CustomRoomIndexRecord[]> {
  await ensureCustomRoomIndex(database);

  const where: string[] = ["visibility = 'public'"];
  const values: unknown[] = [];

  if (options.mode !== undefined) {
    where.push("mode = ?");
    values.push(options.mode);
  }

  if (options.region !== undefined) {
    where.push("region = ?");
    values.push(options.region);
  }

  if (options.states !== undefined && options.states.length > 0) {
    where.push(`state IN (${options.states.map(() => "?").join(", ")})`);
    values.push(...options.states);
  }

  if (options.requireAvailable === true) {
    where.push("available_slots > 0");
  }

  if (options.minAvailableSlots !== undefined) {
    where.push("available_slots >= ?");
    values.push(options.minAvailableSlots);
  }

  if (options.cursor !== undefined) {
    where.push("(created_at < ? OR (created_at = ? AND room_id < ?))");
    values.push(
      options.cursor.createdAt,
      options.cursor.createdAt,
      options.cursor.roomId,
    );
  }

  values.push(options.limit);

  try {
    const result = await database
      .prepare(
        `SELECT
           room_id AS roomId,
           room_name AS name,
           mode,
           region,
           state,
           join_method AS joinMethod,
           max_players AS maxPlayers,
           player_count AS playerCount,
           available_slots AS availableSlots,
           max_spectators AS maxSpectators,
           spectator_count AS spectatorCount,
           available_spectator_slots AS availableSpectatorSlots,
           revision,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM flarelobby_custom_room_index
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, room_id DESC
         LIMIT ?`,
      )
      .bind(...values)
      .all<CustomRoomIndexRow>();

    return result.results.map((row) => ({
      roomId: row.roomId,
      name: row.name,
      mode: row.mode,
      region: row.region,
      state: row.state,
      joinMethod: row.joinMethod,
      maxPlayers: row.maxPlayers,
      playerCount: row.playerCount,
      availableSlots: row.availableSlots,
      maxSpectators: row.maxSpectators,
      spectatorCount: row.spectatorCount,
      availableSpectatorSlots: row.availableSpectatorSlots,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

/** 招待コード解決用の小さな D1 索引を作成します。実行は冪等で、Worker ごとに 1 回だけ DDL を実行します。 */
export function ensureCustomRoomInvitationIndex(
  database: D1Database,
): Promise<void> {
  return ensureOnce(
    initializedCustomRoomInvitationIndexes,
    database,
    async () => {
      try {
        await database.prepare(INVITATION_INDEX_SCHEMA).run();
      } catch {
        throw new FlareLobbyError("CONNECTION_FAILED");
      }
    },
  );
}

/** 招待方式の Room をコードから解決できるように登録します。 */
export async function registerCustomRoomInvitation(
  database: D1Database,
  invitationCode: string,
  roomId: string,
): Promise<void> {
  await ensureCustomRoomInvitationIndex(database);

  try {
    await database
      .prepare(
        `INSERT OR IGNORE INTO flarelobby_custom_room_invitations
          (invitation_code, room_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(invitationCode, roomId, Date.now())
      .run();

    const row = await database
      .prepare(
        `SELECT room_id AS roomId
         FROM flarelobby_custom_room_invitations
         WHERE invitation_code = ?`,
      )
      .bind(invitationCode)
      .first<{ roomId: string }>();

    if (row?.roomId !== roomId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "招待コードが既存の Room と競合しました。",
      });
    }
  } catch (error) {
    if (error instanceof FlareLobbyError) {
      throw error;
    }

    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

/** 招待コードから Room ID を解決します。 */
export async function resolveCustomRoomInvitation(
  database: D1Database,
  invitationCode: string,
): Promise<string | null> {
  await ensureCustomRoomInvitationIndex(database);

  try {
    const row = await database
      .prepare(
        `SELECT room_id AS roomId
         FROM flarelobby_custom_room_invitations
         WHERE invitation_code = ?`,
      )
      .bind(invitationCode)
      .first<{ roomId: string }>();

    return row?.roomId ?? null;
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
