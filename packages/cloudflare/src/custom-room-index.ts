import { FlareLobbyError } from "@flarelobby/core";

const INVITATION_INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS flarelobby_custom_room_invitations (
    invitation_code TEXT PRIMARY KEY,
    room_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )
`;

/** 招待コード解決用の小さな D1 索引を作成します。実行は冪等です。 */
export async function ensureCustomRoomInvitationIndex(
  database: D1Database
): Promise<void> {
  try {
    await database.prepare(INVITATION_INDEX_SCHEMA).run();
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}

/** 招待方式の Room をコードから解決できるように登録します。 */
export async function registerCustomRoomInvitation(
  database: D1Database,
  invitationCode: string,
  roomId: string
): Promise<void> {
  await ensureCustomRoomInvitationIndex(database);

  try {
    await database
      .prepare(
        `INSERT OR IGNORE INTO flarelobby_custom_room_invitations
          (invitation_code, room_id, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(invitationCode, roomId, Date.now())
      .run();

    const row = await database
      .prepare(
        `SELECT room_id AS roomId
         FROM flarelobby_custom_room_invitations
         WHERE invitation_code = ?`
      )
      .bind(invitationCode)
      .first<{ roomId: string }>();

    if (row?.roomId !== roomId) {
      throw new FlareLobbyError("CONFLICT", {
        message: "招待コードが既存の Room と競合しました。"
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
  invitationCode: string
): Promise<string | null> {
  await ensureCustomRoomInvitationIndex(database);

  try {
    const row = await database
      .prepare(
        `SELECT room_id AS roomId
         FROM flarelobby_custom_room_invitations
         WHERE invitation_code = ?`
      )
      .bind(invitationCode)
      .first<{ roomId: string }>();

    return row?.roomId ?? null;
  } catch {
    throw new FlareLobbyError("CONNECTION_FAILED");
  }
}
