-- レーティング方式の Strategy 化に伴う列追加です。
-- 既存の行はすべて ELO の Pool/プレイヤーとして扱われます。
ALTER TABLE flarelobby_rating_seasons ADD COLUMN algorithm TEXT NOT NULL DEFAULT 'elo';
ALTER TABLE flarelobby_ratings ADD COLUMN rating_deviation REAL;
ALTER TABLE flarelobby_ratings ADD COLUMN rating_volatility REAL;
