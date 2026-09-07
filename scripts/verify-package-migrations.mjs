import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageMigrationDirectory =
  "node_modules/@flarelobby/cloudflare/migrations";
const sourceMigrationDirectory = resolve(
  root,
  "packages/cloudflare/migrations",
);
const migrationFiles = [
  "0001_custom_room_index.sql",
  "0002_rating.sql",
  "0003_local_demo_rps.sql",
  "0004_team_rating.sql",
  "0005_rating_algorithm.sql",
];
const publishedMigrationNames = migrationFiles.filter(
  (file) => file !== "0003_local_demo_rps.sql",
);
const expectedTables = [
  "flarelobby_custom_room_index",
  "flarelobby_rating_matches",
  "flarelobby_rating_match_participants",
  "flarelobby_rating_seasons",
  "flarelobby_ratings",
  "flarelobby_team_rating_matches",
  "flarelobby_team_rating_match_participants",
];
const expectedIndexes = [
  "idx_flarelobby_custom_room_index_capacity",
  "idx_flarelobby_custom_room_index_filters",
  "idx_flarelobby_rating_matches_player_a_time",
  "idx_flarelobby_rating_matches_player_b_time",
  "idx_flarelobby_rating_matches_pool_time",
  "idx_flarelobby_ratings_pool_player",
  "idx_flarelobby_team_rating_match_participants_player",
  "idx_flarelobby_team_rating_matches_pool_time",
];
const runtimeInitializedMigrationNames = [
  "0002_rating.sql",
  "0004_team_rating.sql",
  "0005_rating_algorithm.sql",
];
const runtimeSchemaTables = [
  "flarelobby_rating_matches",
  "flarelobby_rating_match_participants",
  "flarelobby_rating_seasons",
  "flarelobby_ratings",
  "flarelobby_team_rating_matches",
  "flarelobby_team_rating_match_participants",
];
const runtimeSchemaColumns = {
  flarelobby_rating_seasons: ["algorithm"],
  flarelobby_ratings: ["rating_deviation", "rating_volatility"],
};
const demoTable = "flarelobby_demo_rps_matches";
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const tar = process.platform === "win32" ? "tar.exe" : "tar";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const temporaryRoot = mkdtempSync(
  join(tmpdir(), "flarelobby-package-migrations-"),
);
const archiveDirectory = join(temporaryRoot, "archive");
const consumerDirectory = join(temporaryRoot, "consumer");
const packageDirectory = join(
  consumerDirectory,
  "node_modules/@flarelobby/cloudflare",
);
const legacyMigrationDirectory = join(consumerDirectory, "legacy-migrations");
const configurationPath = join(consumerDirectory, "wrangler.jsonc");
const packageStateDirectory = join(temporaryRoot, "package-state");
const legacyStateDirectory = join(temporaryRoot, "legacy-state");
const runtimeStateDirectory = join(temporaryRoot, "runtime-state");
const runtimeSchemaPath = join(temporaryRoot, "runtime-schema.sql");

mkdirSync(archiveDirectory, { recursive: true });
mkdirSync(consumerDirectory, { recursive: true });
mkdirSync(packageStateDirectory, { recursive: true });
mkdirSync(legacyStateDirectory, { recursive: true });
mkdirSync(runtimeStateDirectory, { recursive: true });
mkdirSync(legacyMigrationDirectory, { recursive: true });

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${message}: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
    );
  }
}

function parseJsonOutput(output, description) {
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index] !== "[" && output[index] !== "{") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // Wrangler may write progress output before the JSON payload.
    }
  }
  fail(`${description} の JSON 出力を読めません: ${output}`);
}

function run(command, args, cwd = consumerDirectory) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      WRANGLER_SEND_METRICS: "false",
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} が失敗しました (status=${result.status}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function writeConfiguration(migrationsDirectory) {
  writeFileSync(
    configurationPath,
    `${JSON.stringify(
      {
        name: "flarelobby-package-migration-verification",
        d1_databases: [
          {
            binding: "FLARE_LOBBY_DB",
            database_name: "flarelobby-package-migration-verification",
            migrations_dir: migrationsDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function applyMigrations(stateDirectory) {
  run(process.execPath, [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "FLARE_LOBBY_DB",
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    configurationPath,
  ]);
}

function execute(stateDirectory, sql) {
  const output = run(process.execPath, [
    wrangler,
    "d1",
    "execute",
    "FLARE_LOBBY_DB",
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    configurationPath,
    "--command",
    sql,
    "--json",
  ]);
  return parseJsonOutput(output, `D1 SQL (${sql})`);
}

function queryRows(stateDirectory, sql) {
  const payload = execute(stateDirectory, sql);
  const statement = Array.isArray(payload) ? payload[0] : payload;
  return statement?.results ?? [];
}

function migrationHistory(stateDirectory) {
  const hasHistoryTable = queryRows(
    stateDirectory,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
  );
  if (hasHistoryTable.length === 0) return [];
  return queryRows(
    stateDirectory,
    "SELECT name FROM d1_migrations ORDER BY id",
  ).map((row) => String(row.name));
}

function databaseObjects(stateDirectory) {
  return queryRows(
    stateDirectory,
    "SELECT type, name, tbl_name, sql FROM sqlite_master " +
      "WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' " +
      "ORDER BY type, name",
  ).filter((object) => !String(object.name).startsWith("_cf_"));
}

function tableColumns(stateDirectory, table) {
  return queryRows(stateDirectory, `PRAGMA table_info(${table})`).map((row) =>
    String(row.name),
  );
}

function schemaSnapshot(stateDirectory) {
  const objects = databaseObjects(stateDirectory);
  const tables = objects
    .filter((object) => object.type === "table")
    .map((object) => object.name)
    .filter((name) => name !== "d1_migrations");
  const indexes = objects
    .filter((object) => object.type === "index")
    .map((object) => object.name);
  const columns = Object.fromEntries(
    expectedTables.map((table) => [table, tableColumns(stateDirectory, table)]),
  );
  return { tables, indexes, columns };
}

function countRows(stateDirectory, table) {
  const rows = queryRows(
    stateDirectory,
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return Number(rows[0]?.count ?? 0);
}

function packCloudflarePackage() {
  const output = run(
    pnpm,
    [
      "--filter",
      "@flarelobby/cloudflare",
      "pack",
      "--pack-destination",
      archiveDirectory,
      "--json",
    ],
    root,
  );
  const report = parseJsonOutput(output, "@flarelobby/cloudflare pack");
  assert(
    typeof report.filename === "string",
    "pack 結果に tarball path がありません",
  );
  return report.filename;
}

function extractPackage(archivePath) {
  mkdirSync(join(consumerDirectory, "node_modules/@flarelobby"), {
    recursive: true,
  });
  run(tar, ["-xzf", archivePath, "-C", consumerDirectory], root);
  renameSync(join(consumerDirectory, "package"), packageDirectory);
}

function createLegacyMigrations() {
  for (const file of migrationFiles.slice(0, 4)) {
    copyFileSync(
      join(sourceMigrationDirectory, file),
      join(legacyMigrationDirectory, file),
    );
  }
}

function createRuntimeSchemaFile() {
  writeFileSync(
    runtimeSchemaPath,
    ["0002_rating.sql", "0004_team_rating.sql", "0005_rating_algorithm.sql"]
      .map((file) => readFileSync(join(sourceMigrationDirectory, file), "utf8"))
      .join("\n"),
  );
}

function executeFile(stateDirectory, filePath) {
  const output = run(process.execPath, [
    wrangler,
    "d1",
    "execute",
    "FLARE_LOBBY_DB",
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    configurationPath,
    "--file",
    filePath,
  ]);
  return output;
}

const sampleDataSql = `
INSERT INTO flarelobby_rating_seasons
  (game_id, season_id, pool_id, initial_rating, k_factor, created_at, updated_at)
VALUES ('game-79', 'season-79', 'pool-79', 1500, 32, 1, 1);
INSERT INTO flarelobby_ratings
  (player_id, game_id, season_id, pool_id, mode, region, rating_value, version, created_at, updated_at)
VALUES ('player-79', 'game-79', 'season-79', 'pool-79', 'ranked', 'jp', 1512, 1, 1, 1);
INSERT INTO flarelobby_rating_matches
  (match_id, result_id, game_id, season_id, pool_id, mode, region,
   player_a_id, player_b_id, result, rating_a_before, rating_b_before,
   delta_a, delta_b, rating_a_after, rating_b_after, created_at, applied_at)
VALUES ('match-79', 'result-79', 'game-79', 'season-79', 'pool-79', 'ranked', 'jp',
        'player-79', 'player-80', 1, 1500, 1500, 12, -12, 1512, 1488, 1, 1);
INSERT INTO flarelobby_rating_match_participants
  (match_id, slot, player_id, score, rating_before, delta, rating_after, version_before, version_after)
VALUES ('match-79', 'A', 'player-79', 1, 1500, 12, 1512, 0, 1);
INSERT INTO flarelobby_demo_rps_matches
  (match_id, player_a_id, player_b_id, move_a, move_b, result, result_id, applied_at)
VALUES ('demo-79', 'player-79', 'player-80', 'rock', 'scissors', 1, 'demo-result-79', 1);
`;

const runtimeSampleDataSql = sampleDataSql.replace(
  /INSERT INTO flarelobby_demo_rps_matches[\s\S]*?;\n/u,
  "",
);

const runtimeAdoptionSql = `
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO d1_migrations (name)
SELECT '0002_rating.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0002_rating.sql');
INSERT INTO d1_migrations (name)
SELECT '0004_team_rating.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0004_team_rating.sql');
INSERT INTO d1_migrations (name)
SELECT '0005_rating_algorithm.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0005_rating_algorithm.sql');
`;

try {
  const archivePath = packCloudflarePackage();
  extractPackage(archivePath);
  createLegacyMigrations();
  createRuntimeSchemaFile();

  writeConfiguration(packageMigrationDirectory);
  applyMigrations(packageStateDirectory);
  const freshSnapshot = schemaSnapshot(packageStateDirectory);
  assertEqual(
    migrationHistory(packageStateDirectory),
    publishedMigrationNames,
    "配布 Migration の適用履歴が不正です",
  );
  assertEqual(
    freshSnapshot.tables.sort(),
    expectedTables.slice().sort(),
    "空 DB の本体テーブルが不正です",
  );
  assertEqual(
    freshSnapshot.indexes.sort(),
    expectedIndexes.slice().sort(),
    "空 DB の本体索引が不正です",
  );
  assert(
    !freshSnapshot.tables.includes(demoTable),
    "配布 package にローカルデモ用テーブルが作成されています",
  );
  assert(
    freshSnapshot.columns.flarelobby_rating_seasons.includes("algorithm"),
    "0005 の algorithm 列が空 DB にありません",
  );
  assert(
    freshSnapshot.columns.flarelobby_ratings.includes("rating_deviation") &&
      freshSnapshot.columns.flarelobby_ratings.includes("rating_volatility"),
    "0005 の Glicko-2 列が空 DB にありません",
  );

  applyMigrations(packageStateDirectory);
  assertEqual(
    schemaSnapshot(packageStateDirectory),
    freshSnapshot,
    "同じ配布 Migration の再適用でスキーマが変わりました",
  );

  writeConfiguration("legacy-migrations");
  applyMigrations(legacyStateDirectory);
  execute(legacyStateDirectory, sampleDataSql);
  const legacyBefore = schemaSnapshot(legacyStateDirectory);
  assert(
    !legacyBefore.columns.flarelobby_rating_seasons.includes("algorithm"),
    "旧スキーマに新しい algorithm 列があります",
  );
  assertEqual(
    migrationHistory(legacyStateDirectory),
    migrationFiles.slice(0, 4),
    "旧環境の Migration 履歴が不正です",
  );

  writeConfiguration(packageMigrationDirectory);
  applyMigrations(legacyStateDirectory);
  const legacyAfter = schemaSnapshot(legacyStateDirectory);
  assertEqual(
    migrationHistory(legacyStateDirectory),
    migrationFiles,
    "旧環境へ配布 Migration を適用した履歴が不正です",
  );
  assertEqual(
    legacyAfter.tables.sort(),
    legacyBefore.tables.slice().sort(),
    "旧環境のテーブル構成が更新前後で変わりました",
  );
  assertEqual(
    legacyAfter.indexes.sort(),
    legacyBefore.indexes.slice().sort(),
    "旧環境の索引構成が更新前後で変わりました",
  );
  assertEqual(
    countRows(legacyStateDirectory, "flarelobby_rating_seasons"),
    1,
    "旧レーティング Season のデータが失われました",
  );
  assertEqual(
    countRows(legacyStateDirectory, "flarelobby_rating_matches"),
    1,
    "旧試合履歴が失われました",
  );
  assertEqual(
    countRows(legacyStateDirectory, demoTable),
    1,
    "既存のローカルデモデータが失われました",
  );
  const preservedRating = queryRows(
    legacyStateDirectory,
    "SELECT rating_value, version, rating_deviation, rating_volatility " +
      "FROM flarelobby_ratings WHERE player_id = 'player-79'",
  )[0];
  assertEqual(
    preservedRating,
    {
      rating_value: 1512,
      version: 1,
      rating_deviation: null,
      rating_volatility: null,
    },
    "旧レーティング行が更新後も保持されていません",
  );
  assert(
    legacyAfter.columns.flarelobby_rating_seasons.includes("algorithm") &&
      legacyAfter.columns.flarelobby_ratings.includes("rating_deviation") &&
      legacyAfter.columns.flarelobby_ratings.includes("rating_volatility"),
    "旧スキーマへ 0005 の列追加が適用されていません",
  );

  writeConfiguration(packageMigrationDirectory);
  executeFile(runtimeStateDirectory, runtimeSchemaPath);
  execute(runtimeStateDirectory, runtimeSampleDataSql);
  const runtimeObjects = databaseObjects(runtimeStateDirectory);
  assert(
    !runtimeObjects.some((object) => object.name === "d1_migrations"),
    "実行時初期化だけの DB に Wrangler 履歴が先に作られています",
  );
  const detectedRuntimeTables = runtimeSchemaTables.filter((table) =>
    runtimeObjects.some(
      (object) => object.type === "table" && object.name === table,
    ),
  );
  const detectedRuntimeColumns = Object.entries(runtimeSchemaColumns)
    .filter(([table, columns]) =>
      columns.every((column) =>
        tableColumns(runtimeStateDirectory, table).includes(column),
      ),
    )
    .map(([table]) => table);
  const missingRuntimeHistory = runtimeInitializedMigrationNames.filter(
    (migration) => !migrationHistory(runtimeStateDirectory).includes(migration),
  );
  assertEqual(
    missingRuntimeHistory,
    runtimeInitializedMigrationNames,
    "実行時初期化済み DB と Wrangler 履歴の差を検出できません",
  );
  assertEqual(
    detectedRuntimeTables.length,
    runtimeSchemaTables.length,
    "実行時初期化済み DB の本体テーブルを検出できません",
  );
  assertEqual(
    detectedRuntimeColumns.length,
    Object.keys(runtimeSchemaColumns).length,
    "実行時初期化済み DB の追加列を検出できません",
  );

  execute(runtimeStateDirectory, runtimeAdoptionSql);
  applyMigrations(runtimeStateDirectory);
  assertEqual(
    migrationHistory(runtimeStateDirectory),
    [...runtimeInitializedMigrationNames, "0001_custom_room_index.sql"],
    "実行時初期化済み DB の履歴補正後に不要な Migration が適用されました",
  );
  assertEqual(
    countRows(runtimeStateDirectory, "flarelobby_rating_seasons"),
    1,
    "履歴補正後に実行時初期化済み DB のデータが失われました",
  );

  console.log(
    "配布 tarball の外部プロジェクト解決、空 DB/再適用、旧スキーマ更新、実行時初期化済み DB の履歴補正を検証しました。",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (existsSync(temporaryRoot)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
