-- ADR-0005: パーティー単位の N 人チケットで成立した試合のレーティングです。
-- 1 対 1 の既存テーブル (0002_rating.sql) と API 契約は温存し、
-- チーム対応の試合は新しいテーブル群へ記録します。

CREATE TABLE IF NOT EXISTS flarelobby_team_rating_matches (
  match_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  region TEXT NOT NULL,
  team_a_id TEXT NOT NULL,
  team_b_id TEXT NOT NULL,
  result REAL NOT NULL CHECK (result IN (0, 0.5, 1)),
  created_at INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  FOREIGN KEY (game_id, season_id, pool_id)
    REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
);

CREATE TABLE IF NOT EXISTS flarelobby_team_rating_match_participants (
  match_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('A', 'B')),
  player_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  score REAL NOT NULL CHECK (score IN (0, 0.5, 1)),
  rating_before REAL NOT NULL,
  delta INTEGER NOT NULL,
  rating_after REAL NOT NULL,
  version_before INTEGER NOT NULL,
  version_after INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id)
    REFERENCES flarelobby_team_rating_matches (match_id)
);

CREATE INDEX IF NOT EXISTS idx_flarelobby_team_rating_matches_pool_time
  ON flarelobby_team_rating_matches (
    game_id, season_id, pool_id, applied_at DESC, match_id DESC
  );

CREATE INDEX IF NOT EXISTS idx_flarelobby_team_rating_match_participants_player
  ON flarelobby_team_rating_match_participants (
    player_id, match_id
  );
