# ADR-0006: レーティング計算を Strategy として差し替え可能にし Glicko-2 を追加する

- 状態: 採用
- 日付: 2026-08-25
- 対象: `@flarelobby/core`、`@flarelobby/cloudflare`、D1 レーティング

## 背景

v0.1.0 のレーティングは 1 対 1 ELO のみで、`RatingEngine` 契約は存在するものの
公開実装は `elo()` だけだった。RD(レーティング偏差)を持つ Glicko-2 を使いたい
需要に対して、利用者が毎回自前実装を書く状態だった。

D1 側の結果登録は [ADR-0004](./0004-match-result-trust-boundary.md) のとおり、
試合行・参加者履歴・2 人の Rating 更新を 1 回の batch にまとめ、`version` 条件付き
更新と `matchId` / `resultId` の存在確認で冪等性と同時更新安全性を確保している。
アルゴリズムを差し替えるとき、この永続化プロトコルを変えてはいけない。

## 決定

### Strategy 境界

レーティング計算は既存の `RatingEngine<TCalculation>` 契約(`initialRating` と
`calculate()`)を境界とする。core は標準実装として `elo()` に加え `glicko2()` を
公開する。どちらも時刻・乱数・外部状態へ依存しない純関数であり、同じ入力に対して
常に同じ結果を返す。

Glicko-2 は各プレイヤーの RD とボラティリティを状態として持つため、契約を次のよう
に拡張する。

- `calculate()` の入力へ `deviationA` / `deviationB`(省略時は設定済み初期 RD)を
  追加できる。ELO 実装はこれらを無視する。
- 計算結果は両側の `deltaA` / `deltaB` / 更新後レートに加え、Glicko-2 実装は
  更新後 RD とボラティリティも返す。`deltaA + deltaB = 0` は ELO 固有の性質とし、
  契約からは外す(Glicko-2 では各側の不確実性に応じて独立に決まる)。
- 丸めは ELO と同じ「0.5 はゼロから遠い方向」規則を使い、D1 へ保存する差分を
  整数に固定する。

### D1 永続化との整合

Strategy が変わっても D1 プロトコルは不変である。変わるのは「どの数値を書くか」
だけで、読込 → 計算 → version 条件付き batch 書込 → 競合時の有界再試行という
流れは同一である。

- `flarelobby_ratings` へ `rating_deviation` と `rating_volatility` 列を追加し、
  Glicko-2 のプレイヤー状態を同一行に保存する。UPDATE 文は同じ `version` 条件と
  試合行存在条件を保ったまま SET 句へ列を加えるだけである。
- `flarelobby_rating_seasons` へ `algorithm` 列を追加し、Season 作成時の方式を
  記録する。以後の呼び出しが異なる方式を指定すると `CONFLICT` で拒否し、同一
  Season 内での方式混在を防ぐ。旧環境の既存行は `DEFAULT 'elo'` により ELO と
  して扱われる。
- 列追加は `migrations/0005_rating_algorithm.sql` として提供し、Worker の実行時
  スキーマ準備(`ensureRatingSchema`)も PRAGMA による列検出のうえ同一の ALTER を
  冪等へ適用する。両者は `pnpm check:rating-schema` で一致を検証する。
- 数値パラメータ(K 係数・初期 RD・tau・ボラティリティ)は Season に固定せず、
  呼び出し時の Pool 設定に従う。運用上は Worker 設定が不変であるため、Season
  作成時と同じ値が使われる。
- 冪等性は計算内容に依存しない。`matchId` / `resultId` の再送は、適用済みの
  試合行が存在する限り再計算されず `applied: false` を返す。これは ELO でも
  Glicko-2 でも同じである。

### チーム対応の試合結果

[ADR-0005](./0005-party-matching-and-team-composition.md) のチーム編成試合でも、
構成員ごとの対戦相手を「相手チーム平均レート・平均 RD の仮想 1 人」として
同じ Strategy で計算する。ELO の場合も既存どおり K 係数と期待勝率から構成員ごとの
差分を求め、数値挙動は変わらない。

### 設定

Pool 設定の `rating` に `algorithm: "glicko-2"` を指定すると Glicko-2 になる。
省略時は `"elo"` で、後方互換を維持する。`kFactor` は ELO 専用、
`initialRatingDeviation` / `tau` / `volatility` は Glicko-2 専用のパラメータで、
アルゴリズムごとに不要なキーは無視される(正規化は冪等である)。

## 代替案

- 各プレイヤーの RD を別テーブルへ保存する: 試合行と Rating 行の 2 重管理になり、
  ADR-0004 の 1 batch 確定を壊すため不採用。
- 方式ごとに UPDATE 文を完全に分岐させる: 条件付き更新の冪等プロトコルが重複し、
  ドリフトの温床になるため不採用。SET 句の差分だけをヘルパーに閉じ込める。
- Season に tau・ボラティリティなどの数値パラメータも保存する: Season 作成後に
  パラメータ変更を拒否する堅牢性と引き換えにスキーマと正規化が複雑になるため、
  本リリースでは見送る(必要になった時点で列追加で拡張できる)。
- Glicko-2 のレートを Glickman スケール(μ・φ)のまま保存する: 公開 API と履歴の
  単位が ELO と揃わなくなるため不採用。内部計算のみスケール変換を行う。

## 結果

利用者は `RatingEngine` を実装した独自エンジンを差し込めるほか、設定 1 つで
標準の Glicko-2(RD・ボラティリティ付き)を選択できる。D1 の冪等結果登録と
version 条件付き更新はアルゴリズム非依存のまま保たれ、既存 ELO Pool は移行なしで
動作し続ける。
