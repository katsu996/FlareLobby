import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    errors.push(
      `${message}: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
    );
  }
}

const rootManifest = readJson("package.json");
const changesetConfig = readJson(".changeset/config.json");
const rootLicense = read("LICENSE");
const changelog = read("CHANGELOG.md");
const releaseNote = read("docs/releases/v0.1.0.md");
const changeset = read(".changeset/v0-1-0-release.md");

requireEqual(
  rootManifest.version,
  "0.1.0",
  "ルートの release version が不正です",
);
requireEqual(rootManifest.license, "MIT", "ルートの license が不正です");
requireEqual(
  changesetConfig.access,
  "public",
  "Changesets の公開範囲が不正です",
);

for (const [path, content, required] of [
  ["CHANGELOG.md", changelog, "## 0.1.0 - 2026-08-12"],
  ["docs/releases/v0.1.0.md", releaseNote, "## 既知の制限"],
  ["docs/releases/v0.1.0.md", releaseNote, "## 対象外"],
  ["docs/releases/v0.1.0.md", releaseNote, "pnpm release:check"],
  [".changeset/v0-1-0-release.md", changeset, "empty\nChangeset"],
]) {
  if (!content.includes(required)) {
    errors.push(`${path} に必要な記載がありません: ${required}`);
  }
}

for (const packageDefinition of packages) {
  const manifestPath = `${packageDefinition.directory}/package.json`;
  const manifest = readJson(manifestPath);
  const packageLicense = read(`${packageDefinition.directory}/LICENSE`);
  const packageReadme = read(`${packageDefinition.directory}/README.md`);

  requireEqual(
    manifest.name,
    packageDefinition.name,
    `${manifestPath} の name が不正です`,
  );
  requireEqual(
    manifest.version,
    "0.1.0",
    `${manifestPath} の version が不正です`,
  );
  requireEqual(
    manifest.license,
    "MIT",
    `${manifestPath} の license が不正です`,
  );
  requireEqual(
    manifest.type,
    "module",
    `${manifestPath} は ES Modules ではありません`,
  );
  requireEqual(manifest.private, undefined, `${manifestPath} を公開できません`);
  requireEqual(
    manifest.publishConfig?.access,
    "public",
    `${manifestPath} の scoped package access が不正です`,
  );
  requireEqual(
    manifest.repository?.url,
    "git+https://github.com/katsu996/FlareLobby.git",
    `${manifestPath} の repository が不正です`,
  );
  requireEqual(
    manifest.repository?.directory,
    packageDefinition.directory,
    `${manifestPath} の repository.directory が不正です`,
  );
  requireEqual(
    manifest.homepage,
    "https://github.com/katsu996/FlareLobby#readme",
    `${manifestPath} の homepage が不正です`,
  );
  requireEqual(
    manifest.bugs?.url,
    "https://github.com/katsu996/FlareLobby/issues",
    `${manifestPath} の bugs URL が不正です`,
  );

  if (
    typeof manifest.description !== "string" ||
    manifest.description.trim() === ""
  ) {
    errors.push(`${manifestPath} の description がありません`);
  }
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
    errors.push(`${manifestPath} の keywords がありません`);
  }
  if (packageLicense !== rootLicense) {
    errors.push(
      `${packageDefinition.directory}/LICENSE がルートの MIT License と一致しません`,
    );
  }
  if (
    !packageReadme.includes(packageDefinition.name) ||
    !packageReadme.includes("pnpm add")
  ) {
    errors.push(
      `${packageDefinition.directory}/README.md に package 名または導入例がありません`,
    );
  }

  const exportDefinition = manifest.exports?.["."];
  requireEqual(
    exportDefinition?.types,
    "./dist/index.d.ts",
    `${manifestPath} の型 Entry Point が不正です`,
  );
  requireEqual(
    exportDefinition?.import,
    "./dist/index.js",
    `${manifestPath} の ESM Entry Point が不正です`,
  );
  requireEqual(
    manifest.types,
    "./dist/index.d.ts",
    `${manifestPath} の types が不正です`,
  );

  for (const entry of [exportDefinition?.types, exportDefinition?.import]) {
    if (
      typeof entry === "string" &&
      !existsSync(resolve(root, packageDefinition.directory, entry))
    ) {
      errors.push(
        `${manifestPath} の Entry Point が build 成果物にありません: ${entry}`,
      );
    }
  }

  const filePatterns = new Set(
    Array.isArray(manifest.files) ? manifest.files : [],
  );
  for (const pattern of [
    "dist",
    "!dist/.tsbuildinfo",
    "README.md",
    "LICENSE",
  ]) {
    if (!filePatterns.has(pattern)) {
      errors.push(
        `${manifestPath} の files に必要な許可パターンがありません: ${pattern}`,
      );
    }
  }

  const dependencyNames = Object.keys(manifest.dependencies ?? {}).sort();
  const expectedDependencyNames = [...packageDefinition.dependencies].sort();
  if (
    JSON.stringify(dependencyNames) !== JSON.stringify(expectedDependencyNames)
  ) {
    errors.push(
      `${manifestPath} の runtime 依存関係が想定外です: ${JSON.stringify(dependencyNames)}`,
    );
  }
  for (const dependencyName of dependencyNames) {
    if (manifest.dependencies?.[dependencyName] !== "workspace:*") {
      errors.push(
        `${manifestPath} の内部依存が workspace protocol ではありません: ${dependencyName}`,
      );
    }
  }

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

  requireEqual(
    publishReport?.name,
    packageDefinition.name,
    `${packageDefinition.name} の dry-run package 名が不正です`,
  );
  requireEqual(
    publishReport?.version,
    "0.1.0",
    `${packageDefinition.name} の dry-run version が不正です`,
  );

  const packedFiles = (publishReport?.files ?? []).map((file) => file.path);
  for (const requiredPath of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!packedFiles.includes(requiredPath)) {
      errors.push(
        `${packageDefinition.name} の npm package に必要なファイルがありません: ${requiredPath}`,
      );
    }
  }

  for (const packedPath of packedFiles) {
    const allowedRootFile = ["LICENSE", "README.md", "package.json"].includes(
      packedPath,
    );
    const allowedDistFile = packedPath.startsWith("dist/");
    if (!allowedRootFile && !allowedDistFile) {
      errors.push(
        `${packageDefinition.name} の npm package に不要なファイルがあります: ${packedPath}`,
      );
    }
    if (
      packedPath.endsWith(".tsbuildinfo") ||
      /(^|\/)(src|test)(\/|$)/u.test(packedPath) ||
      /(^|\/)(\.env|\.dev\.vars)/u.test(packedPath)
    ) {
      errors.push(
        `${packageDefinition.name} の npm package に内部・秘密ファイルがあります: ${packedPath}`,
      );
    }
  }

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

  if (JSON.stringify(packedManifest).includes("workspace:")) {
    errors.push(
      `${packageDefinition.name} の tarball manifest に workspace protocol が残っています`,
    );
  }
  for (const dependencyName of packageDefinition.dependencies) {
    requireEqual(
      packedManifest.dependencies?.[dependencyName],
      "0.1.0",
      `${packageDefinition.name} の公開用内部依存 version が不正です: ${dependencyName}`,
    );
  }

  reports.push({
    name: packageDefinition.name,
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
      `${report.name}@0.1.0: npm publish dry-run 成功 ` +
        `(${report.files} files, ${report.size} bytes, unpacked ${report.unpackedSize} bytes)`,
    );
  }
  console.log(
    "package metadata、Entry Point、型定義、依存関係、MIT License、公開内容の検証に成功しました。",
  );
}
