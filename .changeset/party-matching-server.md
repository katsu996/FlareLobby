---
"@flarelobby/cloudflare": minor
---

ADR-0005 に基づくパーティーマッチングのサーバー側実装を追加しました。

- `PartyDurableObject` / `PartyMembershipDurableObject`: 作成、招待（単一用途トークン）、受諾、退出、リーダー移譲、解散、単調な `revision` とイベント同期。所属は主体ごとに 1 パーティーへ制限されます。
- Match Pool Durable Object をパーティー単位のチケットへ拡張: `MatchmakingPool` の `maxPartySize` / `teamSize` を尊重し、キュー投入時に Party 側の構成を凍結して二重キュー投入を防ぎます。
- Gateway へ `/v1/parties` HTTP API とチケット作成時の `partyId` を追加しました。
- D1 migration `0004_team_rating.sql` と `registerTeamMatchResult()` を追加し、試合結果登録の参加者復元を N 人へ対応させました。1 対 1 の既存 API 契約は変更されません。
