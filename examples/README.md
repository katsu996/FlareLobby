# Examples

ローカルでカスタムルームと 1 対 1 マッチングを確認する最小 Worker は
[`local-demo`](./local-demo/) です。起動手順は [導入とローカルサンプル](../docs/getting-started.md)
を参照してください。

サンプルの認証は `x-demo-player` または `Authorization: Bearer <player>` を
受け取るローカル専用実装です。本番へ流用せず、必ずアプリケーションの認証 Hook
へ置き換えてください。
