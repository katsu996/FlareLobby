import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/rating.ts の RATING_SCHEMA_STATEMENTS と migrations/0002_rating.sql は
// 同じ D1 スキーマを 2 箇所に記述している。どちらか片方だけが更新された場合に
// ドリフトを検出するため、両者を解析して一致を検証する。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const ratingSource = readFileSync(
  resolve(root, "packages/cloudflare/src/rating.ts"),
  "utf8",
);
const migrationSql = readFileSync(
  resolve(root, "packages/cloudflare/migrations/0002_rating.sql"),
  "utf8",
);

function normalize(statement) {
  return statement.replace(/\s+/gu, " ").trim();
}

const statementsBlock = ratingSource.match(
  /const RATING_SCHEMA_STATEMENTS = Object\.freeze\(\[([\s\S]*?)\] as const\)/u,
);

if (statementsBlock === null) {
  errors.push(
    "src/rating.ts で RATING_SCHEMA_STATEMENTS 定義を検出できませんでした。",
  );
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
