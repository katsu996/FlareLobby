# レーティングエンジン

`@flarelobby/core` の `RatingEngine` は、Cloudflare、D1、時刻、乱数、外部状態へ依存しない、2 人分のレーティング更新契約です。アルゴリズムを差し替える利用者はこの契約を実装でき、標準の 1 対 1 ELO は `elo()` で作成できます。

## ELO の利用

```ts
import { elo } from "@flarelobby/core";

const engine = elo();
const calculation = engine.calculate({
  ratingA: 1_500,
  ratingB: 1_500,
  // A の勝利: 1、引き分け: 0.5、敗北: 0
  result: 1
});

calculation.updatedRatingA; // 1512
calculation.updatedRatingB; // 1488
calculation.deltaA; // 12
calculation.deltaB; // -12
```

既定値は初期レーティング `1500`、K 係数 `24` です。変更する場合は `elo({ initialRating, kFactor })` を指定します。`initialRating` は新規プレイヤーへ適用する値として公開され、計算入力の省略値にはなりません。

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

ELO エンジンは試合結果の正当性、認証、D1 への保存を行いません。それらは後続のマッチ成立・結果確定処理の責務です。
