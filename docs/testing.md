# 決定論的シミュレーターとテスト補助

`@flarelobby/testing` は、Cloudflare Binding、実時間、外部乱数へ依存せずに
FlareLobby のマッチング方針を再現するためのパッケージです。候補の成立可否と
品質比較は `@flarelobby/core` の `selectMatchCandidates()` へ委譲するため、
本番の候補評価とシミュレーションの評価規則が分かれません。

## 実行

```sh
pnpm --filter @flarelobby/testing run test:unit
pnpm --filter @flarelobby/testing run typecheck
```

## 固定時計と固定乱数

```ts
import {
  SeededRandom,
  VirtualClock,
  generateSimulationPlayers
} from "@flarelobby/testing";

const clock = new VirtualClock("2026-08-11T00:00:00.000Z");
clock.advanceBy(20_000);

const players = generateSimulationPlayers(
  {
    count: 100,
    rating: {
      kind: "normal",
      mean: 1_500,
      standardDeviation: 120,
      min: 800,
      max: 2_200
    },
    joinedAt: {
      kind: "uniform",
      from: "2026-08-11T00:00:00.000Z",
      to: "2026-08-11T00:05:00.000Z"
    }
  },
  new SeededRandom("example-seed")
);
```

固定乱数は `mulberry32-v1` として版を固定しています。乱数実装を変更して
過去の結果を意図的に更新する場合は `SEEDED_RANDOM_ALGORITHM` の値も更新し、
結果の `randomAlgorithm` とリプレイ情報から差異を識別します。

数値分布は固定値、一様分布、正規分布に対応します。正規分布では Box-Muller
法の結果を `min` と `max` で切り詰められます。参加時刻の一様分布はミリ秒単位
の整数として生成します。

## シミュレーション

```ts
import {
  formatSimulationOutput,
  simulateMatchmaking
} from "@flarelobby/testing";

const result = simulateMatchmaking({
  seed: "nightly-2026-08-11",
  playerGeneration: {
    count: 1_000,
    rating: { kind: "uniform", min: 1_200, max: 1_800 },
    joinedAt: {
      kind: "uniform",
      from: "2026-08-11T00:00:00.000Z",
      to: "2026-08-11T00:10:00.000Z"
    }
  },
  startAt: "2026-08-11T00:00:00.000Z",
  durationMs: 10 * 60_000,
  tickMs: 1_000,
  cancellation: {
    probability: 0.1,
    afterMs: { kind: "uniform", min: 5_000, max: 120_000 }
  }
});

const output = formatSimulationOutput(result);
console.log(output.summary);
console.log(output.json);
```

固定シナリオを検証する場合は `playerGeneration` の代わりに `players` を指定
します。両方は同時に指定できません。シミュレーションは参加、キャンセル、
期限切れ、検索幅の切り替え、成立をイベント時刻順に処理します。同じ時刻では
参加、キャンセルまたは期限切れ、成立の順です。キャンセルと期限切れが同時に
発生した場合はキャンセルを先に適用します。

## 統計と丸め

`result.statistics` には、次の値が含まれます。

- `waitTimeMs`：成立チケットの待機時間の平均、p50、p95、p99、最小、最大
- `ratingDifference`：成立候補のレート差の平均、p50、p95、p99、最小、最大
- `unmatchedRate`：参加済みチケットのうち成立しなかった割合
- 待機、キャンセル、期限切れ、未参加の件数

百分位は昇順値列に対する線形補間で計算します。時間とレート差は小数点以下
3 桁、未成立率は小数点以下 6 桁へ四捨五入します。統計の値が存在しない場合
（例：成立が 0 件）の平均と百分位は `null` です。未成立率の分母は実際に参加
したチケットで、シミュレーション期間終了後に参加予定のプレイヤーは
`notJoinedPlayerCount` として別集計します。

## 検索幅の比較と失敗ケースの再現

```ts
import {
  compareSearchPolicies,
  replaySimulation
} from "@flarelobby/testing";

const comparison = compareSearchPolicies(config, narrow, wide);
// comparison.delta は wide - narrow の差分
const rerun = replaySimulation(result.replay);
```

`result.replay` には乱数種、乱数アルゴリズム、正規化済み設定が含まれます。
失敗したシナリオの JSON を保存して `replaySimulation()` へ渡すことで、同じ
プレイヤー生成、時刻、キャンセル、候補選択を再実行できます。

## Workers 横断統合テスト

`packages/cloudflare` の統合テストは `@cloudflare/vitest-pool-workers` で
Workers Runtime、Durable Objects、D1 を同じテスト環境へ接続します。D1 は
`migrations/` の SQL をテストファイル開始時に `applyD1Migrations()` で適用し、
Durable Objects は `wrangler.jsonc` の SQLite migration と同じ Binding を使います。

Client SDK からの実行経路は `test/client-integration.test.ts` に集約しています。
テスト名と完了条件の対応は次のとおりです。

| テスト名 | 検証内容 |
| --- | --- |
| `Client SDKからカスタムルームの作成、参加、準備、開始、退出を完了できる` | 2クライアントの主要導線と状態同期 |
| `満員直前の同時参加で定員を超えず、同じチケット作成要求を重複処理しない` | 同時参加の定員競合とチケット冪等性 |
| `WebSocket切断後に再接続し、切断中のSnapshotを復元できる` | 再開トークン、revision、切断猶予、復元 |
| `2クライアントのランクキューを成立させ、対戦ルームへ接続できる` | Client SDKのキュー参加、成立、対戦Room接続 |
| `同じ試合結果を同時登録してもELO更新を一度だけ適用する` | 結果識別子、D1、ELO、二重登録防止 |
| `Alarm実行後とDurable Object再生成後も状態変更を継続できる` | 単一Alarm、SQLite復元、DO再生成 |

各テストはテストファイル間で状態を共有せず、ルーム・プール・主体へ一意な
識別子を使います。`pnpm test:integration` を複数回実行し、競合テストを含めて
同じ結果が得られることを確認してください。意図的な不具合の検出確認では、
定員判定、再接続のrevision適用、結果登録の重複排除のいずれかを一時的に壊し、
対応テストが失敗することを確認します。

## 文書コード例と公開契約の検証

README、利用ガイド、API リファレンスのコード例は、動作説明だけの貼り付けに
せず、次のファイルへ実行可能な TypeScript 例として集約しています。

| 例 | 検証内容 |
| --- | --- |
| `docs/examples/core-api.ts` | 公開型、ELO、検索幅、Protocol の引数と戻り値 |
| `docs/examples/client-api.ts` | Client、Room、購読、型付きゲームメッセージ |
| `docs/examples/cloudflare-config.ts` | Gateway 設定、認証 Hook、Binding 契約 |
| `examples/local-demo/src/index.ts` | ローカル Worker、Room/Pool/Rate Limit Binding |

`pnpm check:docs` は `scripts/verify-docs.mjs` で次を確認した後、
`docs/tsconfig.json` を TypeScript で検査します。

- Issue #26 の必須文書、ADR、テンプレート、ローカルサンプルが存在する
- 各パッケージの `src/index.ts` が公開する Export が API リファレンスへ掲載されている
- core と Cloudflare のエラーコード、Room/Ticket の状態名が API リファレンスへ掲載されている
- 文書内の相対リンクが存在する
- コード例とローカルサンプルの型が現行ソースの型と一致する

## Issue #26 完了条件と検証先

| 完了条件 | 検証先 |
| --- | --- |
| 文書だけでサンプルを起動できる | `docs/getting-started.md`、`examples/local-demo/` |
| 設計の正本の公開 API を説明する | `docs/api-reference.md`、`scripts/verify-docs.mjs` |
| 全エラーコードと対処を説明する | `docs/api-reference.md#エラーコード` |
| 状態遷移と再接続を図または表で理解できる | `docs/architecture.md`、`docs/custom-room-guide.md` |
| コード例を型検査する | `docs/examples/`、`pnpm check:docs` |
| Issue/PR Template が日本語である | `.github/ISSUE_TEMPLATE/`、`.github/pull_request_template.md` |
| 未実装機能を利用可能と誤認させない | `README.md` の対象範囲、各ガイドの対象外記載 |
