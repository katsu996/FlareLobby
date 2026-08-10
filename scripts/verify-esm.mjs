const entryPoints = [
  new URL("../packages/core/dist/index.js", import.meta.url),
  // Cloudflare の Worker エントリーポイントは `cloudflare:workers` を使うため、
  // Node.js ではなく Miniflare 統合テストで読み込みます。ここでは Node.js でも
  // 利用可能な設定モジュールを検証します。
  new URL("../packages/cloudflare/dist/config.js", import.meta.url),
  new URL("../packages/client/dist/index.js", import.meta.url),
  new URL("../packages/testing/dist/index.js", import.meta.url),
];

await Promise.all(entryPoints.map((entryPoint) => import(entryPoint.href)));
