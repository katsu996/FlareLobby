import { parseStrictArgs } from "./package-verification.mjs";

const scriptArgs = parseStrictArgs(process.argv.slice(2), "verify-esm.mjs");
if (scriptArgs.help) {
  console.log("使い方: node scripts/verify-esm.mjs [--help]");
  process.exit(0);
}
if (scriptArgs.errors.length > 0) {
  for (const error of scriptArgs.errors) console.error(`- ${error}`);
  process.exit(1);
}

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
