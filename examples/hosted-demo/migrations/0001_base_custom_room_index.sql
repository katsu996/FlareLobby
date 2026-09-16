-- 公開カスタムルーム一覧の検索用派生テーブルです。
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
);

CREATE INDEX IF NOT EXISTS idx_flarelobby_custom_room_index_filters
  ON flarelobby_custom_room_index (visibility, state, mode, region, created_at DESC, room_id DESC);

CREATE INDEX IF NOT EXISTS idx_flarelobby_custom_room_index_capacity
  ON flarelobby_custom_room_index (available_slots, state, created_at DESC, room_id DESC);
