import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/rating.ts の RATING_SCHEMA_STATEMENTS と migrations/0002_rating.sql、
// migrations/0004_team_rating.sql は同じ D1 スキーマを複数箇所に記述している。
// どれか片方だけが更新された場合にドリフトを検出するため、一致を検証する。
// さらに src/rating.ts の RATING_SCHEMA_UPGRADES（列追加）と
// migrations/0005_rating_algorithm.sql の一致も検証する。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const ratingSource = readFileSync(
  resolve(root, "packages/cloudflare/src/rating.ts"),
  "utf8",
);
const migrationSql = ["0002_rating.sql", "0004_team_rating.sql"]
  .map((file) =>
    readFileSync(resolve(root, "packages/cloudflare/migrations", file), "utf8"),
  )
  .join("\n");
const upgradeSql = readFileSync(
  resolve(root, "packages/cloudflare/migrations", "0005_rating_algorithm.sql"),
  "utf8",
);

function normalize(statement) {
  return statement.replace(/\s+/gu, " ").trim();
}

const statementsBlock = ratingSource.match(
  /const RATING_SCHEMA_STATEMENTS = Object\.freeze\(\[([\s\S]*?)\] as const\)/u,
);
const upgradesBlock = ratingSource.match(
  /const RATING_SCHEMA_UPGRADES = Object\.freeze\(\[([\s\S]*?)\] as const\)/u,
);

if (upgradesBlock === null) {
  errors.push(
    "src/rating.ts で RATING_SCHEMA_UPGRADES 定義を検出できませんでした。",
  );
}

const upgradeSourceStatements =
  upgradesBlock === null
    ? []
    : [...upgradesBlock[1].matchAll(/statement:\s*\n?\s*"([^"]*)"/gu)].map(
        (match) => normalize(match[1]),
      );

const upgradeMigrationStatements = upgradeSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map(normalize)
  .filter((statement) => statement.length > 0);

if (upgradeSourceStatements.length === 0) {
  errors.push(
    "src/rating.ts の RATING_SCHEMA_UPGRADES に列追加が含まれていません。",
  );
}

if (
  upgradeSourceStatements.length > 0 &&
  upgradeMigrationStatements.length > 0 &&
  upgradeSourceStatements.length !== upgradeMigrationStatements.length
) {
  errors.push(
    `列追加のステートメント数が一致しません: src/rating.ts=${upgradeSourceStatements.length}, migrations/0005_rating_algorithm.sql=${upgradeMigrationStatements.length}`,
  );
}

for (
  let index = 0;
  index <
  Math.min(upgradeSourceStatements.length, upgradeMigrationStatements.length);
  index += 1
) {
  if (upgradeSourceStatements[index] !== upgradeMigrationStatements[index]) {
    errors.push(
      `${index + 1} 番目の列追加ステートメントが一致しません:\n  src/rating.ts: ${upgradeSourceStatements[index]}\n  migration : ${upgradeMigrationStatements[index]}`,
    );
  }
}
const sourceStatements =
  statementsBlock === null
    ? []
    : [...statementsBlock[1].matchAll(/`([^`]*)`/gu)].map((match) =>
        normalize(match[1]),
      );

const migrationStatements = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map(normalize)
  .filter((statement) => statement.length > 0);

if (sourceStatements.length === 0) {
  errors.push(
    "src/rating.ts の RATING_SCHEMA_STATEMENTS に CREATE 文が含まれていません。",
  );
}

if (migrationStatements.length === 0) {
  errors.push("migrations/0002_rating.sql に CREATE 文が含まれていません。");
}

if (
  sourceStatements.length > 0 &&
  migrationStatements.length > 0 &&
  sourceStatements.length !== migrationStatements.length
) {
  errors.push(
    `ステートメント数が一致しません: src/rating.ts=${sourceStatements.length}, migrations/0002_rating.sql=${migrationStatements.length}`,
  );
}

const statementCount = Math.min(
  sourceStatements.length,
  migrationStatements.length,
);
for (let index = 0; index < statementCount; index += 1) {
  if (sourceStatements[index] !== migrationStatements[index]) {
    errors.push(
      `${index + 1} 番目のステートメントが一致しません:\n  src/rating.ts: ${sourceStatements[index]}\n  migration : ${migrationStatements[index]}`,
    );
  }
}

if (errors.length > 0) {
  console.error("レーティングスキーマの整合性検証に失敗しました。");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "RATING_SCHEMA_STATEMENTS と migrations/0002_rating.sql は一致しています。",
  );
}
