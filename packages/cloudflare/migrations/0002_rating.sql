-- レーティング、シーズン、試合履歴を保存する D1 Schema です。
CREATE TABLE IF NOT EXISTS flarelobby_rating_seasons (
  game_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  initial_rating REAL NOT NULL,
  k_factor REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, season_id, pool_id)
);

CREATE TABLE IF NOT EXISTS flarelobby_ratings (
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  region TEXT NOT NULL,
  rating_value REAL NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, game_id, season_id, pool_id, mode, region),
  FOREIGN KEY (game_id, season_id, pool_id)
    REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
);

CREATE TABLE IF NOT EXISTS flarelobby_rating_matches (
  match_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  region TEXT NOT NULL,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  result REAL NOT NULL CHECK (result IN (0, 0.5, 1)),
  rating_a_before REAL NOT NULL,
  rating_b_before REAL NOT NULL,
  delta_a INTEGER NOT NULL,
  delta_b INTEGER NOT NULL,
  rating_a_after REAL NOT NULL,
  rating_b_after REAL NOT NULL,
  created_at INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  FOREIGN KEY (game_id, season_id, pool_id)
    REFERENCES flarelobby_rating_seasons (game_id, season_id, pool_id)
);

CREATE TABLE IF NOT EXISTS flarelobby_rating_match_participants (
  match_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('A', 'B')),
  player_id TEXT NOT NULL,
  score REAL NOT NULL CHECK (score IN (0, 0.5, 1)),
  rating_before REAL NOT NULL,
  delta INTEGER NOT NULL,
  rating_after REAL NOT NULL,
  version_before INTEGER NOT NULL,
  version_after INTEGER NOT NULL,
  PRIMARY KEY (match_id, slot),
  UNIQUE (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES flarelobby_rating_matches (match_id)
);

CREATE INDEX IF NOT EXISTS idx_flarelobby_ratings_pool_player
  ON flarelobby_ratings (game_id, season_id, pool_id, player_id);

CREATE INDEX IF NOT EXISTS idx_flarelobby_rating_matches_pool_time
  ON flarelobby_rating_matches (
    game_id, season_id, pool_id, applied_at DESC, match_id DESC
  );

CREATE INDEX IF NOT EXISTS idx_flarelobby_rating_matches_player_a_time
  ON flarelobby_rating_matches (
    game_id, season_id, pool_id, player_a_id,
    applied_at DESC, match_id DESC
  );

CREATE INDEX IF NOT EXISTS idx_flarelobby_rating_matches_player_b_time
  ON flarelobby_rating_matches (
    game_id, season_id, pool_id, player_b_id,
    applied_at DESC, match_id DESC
  );
