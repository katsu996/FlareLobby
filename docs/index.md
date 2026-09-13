---
layout: home

hero:
  name: FlareLobby
  text: ゲームのロビーを、Cloudflare で。
  tagline: カスタムルーム、パーティー、マッチメイキングからレーティングまで。TypeScript でつなぐゲームロビーライブラリ。
  actions:
    - theme: brand
      text: はじめる
      link: /getting-started
    - theme: alt
      text: API リファレンス
      link: /api-reference
    - theme: alt
      text: GitHub
      link: https://github.com/katsu996/FlareLobby

features:
  - title: カスタムルーム
    details: 公開・招待コード・パスワードによる参加、観戦、準備、チーム選択、ホスト移譲に対応。
    link: /custom-room-guide
    linkText: ルームを作る
  - title: パーティーとマッチメイキング
    details: 1 対 1 からパーティー・チーム単位のマッチングまで。待機時間に応じて検索幅を拡大。
    link: /matchmaking-guide
    linkText: マッチングを設定する
  - title: 型付き Client SDK
    details: ブラウザ標準の HTTP / WebSocket で接続。状態通知と切断後の復元を SDK から利用。
    link: /client
    linkText: SDK を使う
  - title: ELO / Glicko-2
    details: シーズン別のレーティングと試合履歴を D1 へ保存。信頼できるサーバー側から結果を登録。
    link: /rating
    linkText: レーティングを理解する
  - title: Workers と Durable Objects
    details: ルームやプールごとに状態を保持。SQLite を正本に、D1 で公開一覧や履歴を管理。
    link: /architecture
    linkText: 構成を見る
  - title: 決定論的なテスト
    details: 仮想時計・固定乱数・マッチングシミュレーターと Workers 統合テストで挙動を検証。
    link: /testing
    linkText: テストする
---

## FlareLobby の担当範囲

FlareLobby は、ロビーと対戦成立後の接続境界を提供します。
ゲーム本体の権威同期、物理演算、ボイス・映像・WebRTC 本体は対象外です。

導入には [Standalone テンプレート](https://github.com/katsu996/FlareLobby/tree/main/templates/standalone)
を利用できます。npm の公開状態と公開前の tarball 検証手順は
[導入ガイド](./getting-started.md) を参照してください。
