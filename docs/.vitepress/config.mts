import { defineConfig } from "vitepress";
import { MermaidMarkdown, MermaidPlugin } from "vitepress-plugin-mermaid";

export default defineConfig({
  lang: "ja",
  title: "FlareLobby",
  description:
    "Cloudflare Workers と Durable Objects 向けゲームロビーライブラリ",
  base: "/FlareLobby/",
  head: [["link", { rel: "describedby", href: "/FlareLobby/llms.txt" }]],
  locales: {
    root: { label: "日本語", lang: "ja" },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      title: "FlareLobby",
      description:
        "Game lobbies and connection boundaries for Cloudflare Workers and Durable Objects",
      themeConfig: {
        nav: [
          { text: "Quick Start", link: "/en/getting-started" },
          { text: "Japanese: API Reference", link: "/api-reference" },
          { text: "llms.txt", link: "/FlareLobby/llms.txt" },
        ],
        sidebar: [
          {
            text: "Start here",
            items: [
              { text: "English home", link: "/en/" },
              { text: "Quick Start", link: "/en/getting-started" },
            ],
          },
          {
            text: "Japanese: Feature guides",
            items: [
              { text: "Japanese: Client SDK", link: "/client" },
              { text: "Japanese: Custom rooms", link: "/custom-room-guide" },
              {
                text: "Japanese: Room participation",
                link: "/custom-room-participation",
              },
              { text: "Japanese: Public room list", link: "/custom-room-list" },
              { text: "Japanese: Matchmaking", link: "/matchmaking-guide" },
              { text: "Japanese: Match pool", link: "/match-pool" },
              { text: "Japanese: Rating", link: "/rating" },
            ],
          },
          {
            text: "Japanese: Reference",
            items: [
              { text: "Japanese: API Reference", link: "/api-reference" },
              { text: "Japanese: Domain model", link: "/domain-model" },
              { text: "Japanese: Protocol", link: "/protocol" },
            ],
          },
          {
            text: "Japanese: Operations",
            items: [
              {
                text: "Japanese: Cloudflare configuration",
                link: "/cloudflare-configuration",
              },
              { text: "Japanese: Security", link: "/security" },
              { text: "Japanese: Observability", link: "/observability" },
              { text: "Japanese: Testing", link: "/testing" },
              { text: "Japanese: Architecture", link: "/architecture" },
            ],
          },
          {
            text: "Japanese: Design decisions",
            collapsed: true,
            items: [
              {
                text: "Japanese: ADR 0001 Durable Object and SQLite",
                link: "/adr/0001-durable-object-sqlite",
              },
              {
                text: "Japanese: ADR 0002 Reconnect and revision",
                link: "/adr/0002-reconnect-and-revision",
              },
              {
                text: "Japanese: ADR 0003 Public room list",
                link: "/adr/0003-public-room-index",
              },
              {
                text: "Japanese: ADR 0004 Match result trust boundary",
                link: "/adr/0004-match-result-trust-boundary",
              },
              {
                text: "Japanese: ADR 0005 Parties and teams",
                link: "/adr/0005-party-matching-and-team-composition",
              },
              {
                text: "Japanese: ADR 0006 Glicko-2",
                link: "/adr/0006-rating-strategy-and-glicko2",
              },
            ],
          },
          {
            text: "Japanese: Releases",
            items: [
              {
                text: "Japanese: v0.1.0 release notes",
                link: "/releases/v0.1.0",
              },
              {
                text: "Japanese: Changelog",
                link: "https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md",
              },
            ],
          },
        ],
        outline: { level: [2, 3], label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
        sidebarMenuLabel: "Menu",
        returnToTopLabel: "Back to top",
        darkModeSwitchLabel: "Toggle dark mode",
        skipToContentLabel: "Skip to content",
        langMenuLabel: "Change language",
        editLink: {
          pattern:
            "https://github.com/katsu996/FlareLobby/edit/main/docs/:path",
          text: "Edit this page on GitHub",
        },
        footer: { message: "MIT License · FlareLobby" },
      },
    },
  },
  outDir: "../dist/docs",
  markdown: { config: (md) => md.use(MermaidMarkdown) },
  vite: {
    plugins: [MermaidPlugin({ themeCSS: "p { line-height: 1.5; }" })],
    optimizeDeps: { include: ["mermaid"] },
  },
  themeConfig: {
    i18nRouting: false,
    nav: [
      { text: "ガイド", link: "/getting-started" },
      { text: "API リファレンス", link: "/api-reference" },
      { text: "llms.txt", link: "/FlareLobby/llms.txt" },
    ],
    sidebar: [
      {
        text: "はじめに",
        items: [
          { text: "導入とローカルサンプル", link: "/getting-started" },
          { text: "じゃんけんデモ", link: "/local-demo" },
          { text: "Client SDK", link: "/client" },
        ],
      },
      {
        text: "機能ガイド",
        items: [
          { text: "カスタムルーム", link: "/custom-room-guide" },
          { text: "参加・退出・観戦", link: "/custom-room-participation" },
          { text: "公開ルーム一覧", link: "/custom-room-list" },
          { text: "マッチメイキング", link: "/matchmaking-guide" },
          { text: "マッチングプール", link: "/match-pool" },
          { text: "レーティング", link: "/rating" },
        ],
      },
      {
        text: "リファレンス",
        items: [
          { text: "API リファレンス", link: "/api-reference" },
          { text: "ドメインモデル", link: "/domain-model" },
          { text: "通信プロトコル", link: "/protocol" },
        ],
      },
      {
        text: "構成と運用",
        items: [
          { text: "Cloudflare 設定", link: "/cloudflare-configuration" },
          { text: "セキュリティ", link: "/security" },
          { text: "観測基盤", link: "/observability" },
          { text: "テストと検証", link: "/testing" },
          { text: "アーキテクチャ", link: "/architecture" },
        ],
      },
      {
        text: "設計判断（ADR）",
        collapsed: true,
        items: [
          {
            text: "0001: Durable Object と SQLite",
            link: "/adr/0001-durable-object-sqlite",
          },
          {
            text: "0002: 再接続と revision",
            link: "/adr/0002-reconnect-and-revision",
          },
          {
            text: "0003: 公開ルーム一覧",
            link: "/adr/0003-public-room-index",
          },
          {
            text: "0004: 試合結果の信頼境界",
            link: "/adr/0004-match-result-trust-boundary",
          },
          {
            text: "0005: パーティーとチーム編成",
            link: "/adr/0005-party-matching-and-team-composition",
          },
          {
            text: "0006: Glicko-2",
            link: "/adr/0006-rating-strategy-and-glicko2",
          },
        ],
      },
      {
        text: "リリース",
        items: [
          { text: "v0.1.0 リリースノート", link: "/releases/v0.1.0" },
          {
            text: "変更履歴",
            link: "https://github.com/katsu996/FlareLobby/blob/main/CHANGELOG.md",
          },
        ],
      },
    ],
    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "検索",
            buttonAriaLabel: "ドキュメントを検索",
          },
          modal: {
            displayDetails: "詳細を表示",
            resetButtonTitle: "検索をクリア",
            backButtonTitle: "検索を閉じる",
            noResultsText: "検索結果がありません",
            footer: {
              selectText: "選択",
              navigateText: "移動",
              closeText: "閉じる",
            },
          },
        },
        locales: {
          en: {
            translations: {
              button: {
                buttonText: "Search",
                buttonAriaLabel: "Search",
              },
              modal: {
                displayDetails: "Display detailed results",
                resetButtonTitle: "Clear search",
                backButtonTitle: "Close search",
                noResultsText: "No results",
                footer: {
                  selectText: "select",
                  navigateText: "navigate",
                  closeText: "close",
                },
              },
            },
          },
        },
      },
    },
    outline: { level: [2, 3], label: "このページの内容" },
    docFooter: { prev: "前のページ", next: "次のページ" },
    sidebarMenuLabel: "メニュー",
    langMenuLabel: "言語",
    returnToTopLabel: "トップへ戻る",
    darkModeSwitchLabel: "表示モード",
    skipToContentLabel: "本文へスキップ",
    editLink: {
      pattern: "https://github.com/katsu996/FlareLobby/edit/main/docs/:path",
      text: "GitHub でこのページを編集",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/katsu996/FlareLobby" },
    ],
    footer: { message: "MIT License · FlareLobby" },
  },
});
