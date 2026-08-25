# レーティングエンジン

`@flarelobby/core` の `RatingEngine` は、Cloudflare、D1、時刻、乱数、外部状態へ依存しない、2 人分のレーティング更新契約です。アルゴリズムを差し替える利用者はこの契約を実装でき、標準の 1 対 1 ELO は `elo()`、RD(レーティング偏差)とボラティリティ付きの Glicko-2 は `glicko2()` で作成できます。設計判断の詳細は [ADR-0006](./adr/0006-rating-strategy-and-glicko2.md) を参照してください。

## ELO の利用

```ts
import { elo } from "@flarelobby/core";

const engine = elo();
const calculation = engine.calculate({
  ratingA: 1_500,
  ratingB: 1_500,
  // A の勝利: 1、引き分け: 0.5、敗北: 0
  result: 1,
});

calculation.updatedRatingA; // 1512
calculation.updatedRatingB; // 1488
calculation.deltaA; // 12
calculation.deltaB; // -12
```

既定値は初期レーティング `1500`、K 係数 `24` です。変更する場合は `elo({ initialRating, kFactor })` を指定します。`initialRating` は新規プレイヤーへ適用する値として公開され、計算入力の省略値にはなりません。

## Glicko-2 の利用

```ts
import { glicko2 } from "@flarelobby/core";

const engine = glicko2();
const calculation = engine.calculate({
  ratingA: 1_500,
  ratingB: 1_500,
  result: 0,
  // 省略時は初期 RD(既定 350)が使われます。
  deviationA: 200,
  deviationB: 30,
});

calculation.updatedRatingA; // 1387
calculation.updatedDeviationA; // 約 175.40
calculation.updatedVolatilityA; // 約 0.06
```

既定値は初期レーティング `1500`、初期 RD `350`、システム定数 tau `0.5`、初期ボラティリティ `0.06` です。変更する場合は `glicko2({ initialRating, initialRatingDeviation, tau, volatility })` を指定します。

ELO と異なり、Glicko-2 では両側の差分が正負対称になるとは限りません。各側の新レートは相手のレートと RD から Glicko-2 式で独立に求められ、丸めだけを ELO と同じ「0.5 はゼロから遠い方向」規則で行います。計算結果には両側の更新後 RD・ボラティリティ・期待勝率・未丸め差分が含まれます。連戦する場合は前回結果の `updatedRating*` / `updatedDeviation*` / `updatedVolatility*` を次の入力へ渡すことで不確実性が単調に縮みます。ボラティリティを省略した場合は設定済みの初期値が使われます。

## 計算式と丸め

A 側の期待勝率は次の標準式で求めます。

```text
expectedA = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
expectedB = 1 - expectedA
rawDeltaA = kFactor * (result - expectedA)
```

`rawDeltaA` を最近整数へ丸めた値を A 側の `deltaA` とします。ちょうど `0.5` の場合は絶対値が増える方向へ丸める（正の値は切り上げ、負の値は切り下げる）規則です。B 側には `deltaB = -deltaA` を適用します。したがって、浮動小数点計算の誤差や個別丸めによって 2 人の差分合計がずれることはありません。`-0` は `0` として返します。この規則は入力が同じなら常に同じ結果になるよう固定しています。

結果には期待勝率、未丸め差分、スコア、K 係数、更新前後のレーティングを含め、検証や試合履歴処理から計算過程を確認できます。

## 入力検証

- `ratingA` と `ratingB` は 0 以上の有限な数値である必要があります。
- `result` は `0`、`0.5`、`1` のいずれかである必要があります。
- `initialRating` は 0 以上の有限な数値である必要があります。
- `kFactor` は 0 より大きい有限な数値である必要があります。
- 設定や入力の型・値が不正な場合は `TypeError` または `RangeError` を送出します。

ELO エンジンは試合結果の正当性、認証、D1 への保存を行いません。それらは Gateway、Match Pool、D1 レーティング処理の境界で扱います。一般クライアントへ結果確定権限を与えない規則は [マッチメイキング利用ガイド](./matchmaking-guide.md) と [ADR-0004](./adr/0004-match-result-trust-boundary.md) を参照してください。

## D1 への永続化

`@flarelobby/cloudflare` は Pool・Season 単位で初期値、現在値、版番号、試合履歴を D1 に保存します。Glicko-2 を選択した Pool では同じ行に RD(`rating_deviation`)とボラティリティ(`rating_volatility`)も保存し、Season 行の `algorithm` 列に方式を記録します。`packages/cloudflare/migrations/0002_rating.sql` と `0005_rating_algorithm.sql` が本番用のスキーマで、Worker の公開関数も未適用のローカル D1 へ冪等にスキーマを準備します。既存環境へは `0005_rating_algorithm.sql` の適用で対応でき、既存の行はすべて ELO として扱われます。

Pool ごとのレーティング設定は `matchmakingPools` に指定します。`algorithm` を省略すると ELO になり、`"glicko-2"` を指定すると Glicko-2 になります。

```ts
matchmakingPools: [
  {
    id: "ranked-jp",
    gameId: "example-game",
    seasonId: "season-1",
    mode: "ranked-1v1",
    region: "jp",
    rating: {
      algorithm: "glicko-2",
      initialRating: 1_500,
    },
  },
];
```

ELO 専用の `kFactor` と、Glicko-2 専用の `initialRatingDeviation` / `tau` / `volatility` は、アルゴリズムごとに不要なキーとして無視されます。方式は Season 作成時に記録され、以後の呼び出しが異なる `algorithm` を指定すると `CONFLICT` エラーになります。同一 Season 内での方式混在は発生しません。

ELO のまま使う場合は `kFactor` だけを指定します。

```ts
rating: { initialRating: 1_500, kFactor: 24 }
```

`getRating(database, pool, playerId)` は初回参照時に設定済みの初期値を保存し、以後は確定済みの最新値を返します。試合結果の登録はサーバー側の認可済み処理から `registerMatchResult()` を呼ぶか、認可 Hook を設定した次の Gateway ルートを使います。

```text
POST /v1/matchmaking/pools/:poolId/matches/:matchId/result
{ "resultId": "result-123", "result": 1 }
```

この HTTP 本文にはプレイヤー ID を含めません。Gateway は `matchId` に対応する成立済み Match Pool チケットから参加者を復元し、`authorizeMatchResult` が許可した場合だけ結果を適用します。結果 ID と match ID は冪等性キーとして扱い、同じ結果の再送は再計算せず `applied: false` を返します。

試合行、2 人の参加者履歴、2 人のレーティング更新は 1 回の D1 batch へまとめます。レーティングの版番号を条件にした更新が競合した場合は再読込・再計算を有界回数だけ行うため、同時更新で片方の結果を失いません。`listMatchHistory()` / `getMatchHistory()` は Pool と任意の playerId で絞り込み、cursor と limit（最大 100）で新しい順に取得できます。

## チーム対応の試合結果

パーティー単位の N 人チケットで成立した試合は、`registerTeamMatchResult()`（別名 `recordTeamMatchResult()`）で記録します。入力は両チームのチーム ID と構成員プレイヤー ID、A 側チームの得点です。Gateway の公開結果 API では、これらも Match Pool チケットから復元します。

参照レートは各チーム構成員レートの算術平均とし、個々の構成員の更新差分は自分のレートと相手チーム平均(平均 RD・平均ボラティリティ)から Pool 設定の `algorithm` で計算します。ELO の場合は従来どおり K 係数による差分になります。丸めは 1 対 1 と同じ「0.5 はゼロから遠い方向」規則です。試合行、全構成員の参加者履歴、全構成員のレーティング更新(RD・ボラティリティを含む)を 1 回の D1 batch で確定し、`matchId` / `resultId` の再送は `applied: false` を返します。テーブルは `migrations/0004_team_rating.sql` として追加され、1 対 1 の既存テーブルと API 契約は変更されません。
