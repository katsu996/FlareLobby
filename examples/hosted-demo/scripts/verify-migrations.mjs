/**
 * 専用マイグレーションと元ファイルの照合です。
 *
 * `pnpm verify:migrations` で実行します。配布4本とデモ RPS の SQL 本文が
 * 元ファイルと一致すること、package の配布 migration へデモ table が
 * 混入していないことを確認します。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostedDir = resolve(demoRoot, "migrations");
const packageDir = resolve(demoRoot, "../../packages/cloudflare/migrations");

const normalize = (value) => value.replaceAll("\r\n", "\n").trim();
const read = (directory, file) =>
  normalize(readFileSync(resolve(directory, file), "utf8"));

const pairs = [
  ["0001_base_custom_room_index.sql", "0001_custom_room_index.sql"],
  ["0002_base_rating.sql", "0002_rating.sql"],
  ["0003_base_team_rating.sql", "0004_team_rating.sql"],
  ["0004_base_rating_algorithm.sql", "0005_rating_algorithm.sql"],
  ["0005_hosted_demo_rps.sql", "0003_local_demo_rps.sql"],
];

let failed = false;
for (const [hosted, original] of pairs) {
  if (read(hostedDir, hosted) !== read(packageDir, original)) {
    console.error(`mismatch: ${hosted} != ${original}`);
    failed = true;
  }
}

for (const file of readdirSync(packageDir)) {
  if (file === "0003_local_demo_rps.sql" || !file.endsWith(".sql")) {
    continue;
  }
  if (read(packageDir, file).includes("flarelobby_demo_rps")) {
    console.error(`demo table mixed into package migration: ${file}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  "migrations: 5 files collated, no demo table in package migrations",
);
