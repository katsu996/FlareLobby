# Changesets

このディレクトリでは、公開パッケージに影響する変更の履歴と次回リリース時のバージョン更新を管理します。

変更対象のパッケージとバージョン種別を記録するには、リポジトリのルートで次を実行します。

```sh
pnpm changeset
```

リリース準備で保留中の Changeset をパッケージのバージョンと変更履歴へ反映するには、次を実行します。

```sh
pnpm version-packages
```

公開 package は public scoped package として設定しています。ただし、この基盤と CI は
npm への公開を実行しません。version 反映後も `pnpm release:check` の npm publish
dry-run、変更履歴、所有者の最終承認を確認してから、認証済み環境で公開してください。
