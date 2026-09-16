CREATE TABLE IF NOT EXISTS flarelobby_demo_rps_matches (
  match_id TEXT PRIMARY KEY,
  player_a_id TEXT NOT NULL,
  player_b_id TEXT NOT NULL,
  move_a TEXT CHECK (move_a IN ('rock', 'paper', 'scissors')),
  move_b TEXT CHECK (move_b IN ('rock', 'paper', 'scissors')),
  result REAL CHECK (result IN (0, 0.5, 1)),
  result_id TEXT UNIQUE,
  applied_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flarelobby_demo_rps_matches_players
  ON flarelobby_demo_rps_matches (player_a_id, player_b_id, match_id);
