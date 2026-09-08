import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkEntryPoints,
  checkHistoricalDocuments,
  checkPackedFiles,
  checkPackedManifest,
  checkPublishReport,
  checkRootManifest,
  checkSourceManifest,
  checkSupplementalFiles,
  collectPublishedVersions,
} from "./package-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const tar = process.platform === "win32" ? "tar.exe" : "tar";
const archiveDirectory = mkdtempSync(
  join(tmpdir(), "flarelobby-package-audit-"),
);
const errors = [];
const reports = [];

const packages = [
  {
    directory: "packages/core",
    name: "@flarelobby/core",
    dependencies: [],
  },
  {
    directory: "packages/cloudflare",
    name: "@flarelobby/cloudflare",
    dependencies: ["@flarelobby/core"],
    requiredManifestPatterns: [
      "migrations",
      "!migrations/0003_local_demo_rps.sql",
    ],
    requiredPackedFiles: [
      "migrations/0001_custom_room_index.sql",
      "migrations/0002_rating.sql",
      "migrations/0004_team_rating.sql",
      "migrations/0005_rating_algorithm.sql",
    ],
    forbiddenPackedFiles: ["migrations/0003_local_demo_rps.sql"],
  },
  {
    directory: "packages/client",
    name: "@flarelobby/client",
    dependencies: ["@flarelobby/core"],
  },
  {
    directory: "packages/testing",
    name: "@flarelobby/testing",
    dependencies: ["@flarelobby/core"],
  },
];

function read(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`必須ファイルがありません: ${relativePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function readJson(relativePath) {
  const content = read(relativePath);
  if (content === "") return {};
  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`${relativePath} を JSON として読めません: ${String(error)}`);
    return {};
  }
}

const rootManifest = readJson("package.json");
const changesetConfig = readJson(".changeset/config.json");
const rootLicense = read("LICENSE");
const changelog = read("CHANGELOG.md");
const releaseNote = read("docs/releases/v0.1.0.md");
const changeset = read(".changeset/v0-1-0-release.md");

errors.push(...checkRootManifest(rootManifest, changesetConfig));
errors.push(...checkHistoricalDocuments({ changelog, releaseNote, changeset }));

// tarball 内の公開用内部依存の期待値は各 package の manifest から導出する。
// private なルートのバージョンとの一致は要求しない。
const manifestsByDirectory = new Map();
for (const packageDefinition of packages) {
  manifestsByDirectory.set(
    packageDefinition.directory,
    readJson(`${packageDefinition.directory}/package.json`),
  );
}
const versionsByName = collectPublishedVersions(packages, manifestsByDirectory);

for (const packageDefinition of packages) {
  const manifest = manifestsByDirectory.get(packageDefinition.directory);
  const packageLicense = read(`${packageDefinition.directory}/LICENSE`);
  const packageReadme = read(`${packageDefinition.directory}/README.md`);

  errors.push(...checkSourceManifest(manifest, packageDefinition));
  errors.push(
    ...checkSupplementalFiles({
      definition: packageDefinition,
      rootLicense,
      packageLicense,
      packageReadme,
    }),
  );
  errors.push(
    ...checkEntryPoints(manifest, packageDefinition, (entry) =>
      existsSync(resolve(root, packageDefinition.directory, entry)),
    ),
  );

  const result = spawnSync(
    pnpm,
    [
      "--filter",
      packageDefinition.name,
      "publish",
      "--dry-run",
      "--no-git-checks",
      "--json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    errors.push(
      `${packageDefinition.name} の npm publish dry-run が失敗しました:\n${result.stdout}${result.stderr}`,
    );
    continue;
  }
  if (result.stderr.trim() !== "") process.stderr.write(result.stderr);

  let publishReport;
  try {
    const parsed = JSON.parse(result.stdout);
    publishReport = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    errors.push(
      `${packageDefinition.name} の npm publish dry-run 結果を読めません: ${String(error)}`,
    );
    continue;
  }

  errors.push(
    ...checkPublishReport(publishReport, packageDefinition, manifest),
  );

  const packedFiles = (publishReport?.files ?? []).map((file) => file.path);
  errors.push(...checkPackedFiles(packedFiles, packageDefinition));

  const packResult = spawnSync(
    pnpm,
    [
      "--filter",
      packageDefinition.name,
      "pack",
      "--pack-destination",
      archiveDirectory,
      "--json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (packResult.status !== 0) {
    errors.push(
      `${packageDefinition.name} の tarball 生成が失敗しました:\n${packResult.stdout}${packResult.stderr}`,
    );
    continue;
  }
  if (packResult.stderr.trim() !== "") process.stderr.write(packResult.stderr);

  let archivePath;
  try {
    archivePath = JSON.parse(packResult.stdout).filename;
  } catch (error) {
    errors.push(
      `${packageDefinition.name} の pack 結果を読めません: ${String(error)}`,
    );
    continue;
  }
  if (typeof archivePath !== "string") {
    errors.push(
      `${packageDefinition.name} の pack 結果に tarball path がありません`,
    );
    continue;
  }

  const packedManifestResult = spawnSync(
    tar,
    ["-xOf", archivePath, "package/package.json"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (packedManifestResult.status !== 0) {
    errors.push(
      `${packageDefinition.name} の tarball manifest を読めません:\n` +
        `${packedManifestResult.stdout}${packedManifestResult.stderr}`,
    );
    continue;
  }

  let packedManifest;
  try {
    packedManifest = JSON.parse(packedManifestResult.stdout);
  } catch (error) {
    errors.push(
      `${packageDefinition.name} の tarball manifest が不正です: ${String(error)}`,
    );
    continue;
  }

  errors.push(
    ...checkPackedManifest(packedManifest, packageDefinition, versionsByName),
  );

  reports.push({
    name: packageDefinition.name,
    version: manifest?.version,
    files: packedFiles.length,
    size: publishReport?.size,
    unpackedSize: publishReport?.unpackedSize,
  });
}

rmSync(archiveDirectory, { recursive: true, force: true });

if (errors.length > 0) {
  console.error("公開 package 検証に失敗しました。");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  for (const report of reports) {
    console.log(
      `${report.name}@${report.version}: npm publish dry-run 成功 ` +
        `(${report.files} files, ${report.size} bytes, unpacked ${report.unpackedSize} bytes)`,
    );
  }
  console.log(
    "package metadata、Entry Point、型定義、依存関係、MIT License、公開内容の検証に成功しました。",
  );
}
