// scripts/package-verification.mjs
//
// verify-packages.mjs から利用する副作用のない検証ヘルパー。
// ファイル読み取り・pnpm 実行・tarball 生成などの副作用は呼び出し側で行い、
// ここでは受け取った内容の判定だけを行う。実 manifest を書き換えずに
// fixture で検証できるよう、判定に必要な値はすべて引数で受け取る。

export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export function isValidSemver(version) {
  return typeof version === "string" && SEMVER_PATTERN.test(version);
}

function formatDiff(expected, actual) {
  return `expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`;
}

function requireEqual(errors, actual, expected, message) {
  if (actual !== expected) {
    errors.push(`${message}: ${formatDiff(expected, actual)}`);
  }
}

// ルート manifest の検証。各 package のバージョンとの一致は要求しない。
// Changesets の fixed/linked は空であり、全 package の同時更新を仮定しない。
export function checkRootManifest(rootManifest, changesetConfig) {
  const errors = [];
  if (!isValidSemver(rootManifest?.version)) {
    errors.push(
      `ルートの version が semver ではありません: ${JSON.stringify(rootManifest?.version)}`,
    );
  }
  requireEqual(
    errors,
    rootManifest?.private,
    true,
    "ルートが private ではありません",
  );
  requireEqual(
    errors,
    rootManifest?.license,
    "MIT",
    "ルートの license が不正です",
  );
  requireEqual(
    errors,
    changesetConfig?.access,
    "public",
    "Changesets の公開範囲が不正です",
  );
  return errors;
}

// 歴史的な v0.1.0 文書は保存するが、初回日付・空 Changeset の文言に
// 現在の公開可否を依存させない。存在と最小限の体裁だけを確認する。
export function checkHistoricalDocuments({
  changelog,
  releaseNote,
  changeset,
}) {
  const errors = [];
  if (typeof changelog !== "string" || changelog.trim() === "") {
    errors.push("CHANGELOG.md が空です");
  } else if (!/^## \d+\.\d+\.\d+/mu.test(changelog)) {
    errors.push("CHANGELOG.md にバージョン見出しがありません");
  }
  if (typeof releaseNote !== "string" || releaseNote.trim() === "") {
    errors.push("docs/releases/v0.1.0.md が空です");
  }
  if (typeof changeset !== "string" || changeset.trim() === "") {
    errors.push(".changeset/v0-1-0-release.md が空です");
  }
  return errors;
}

export function checkSourceManifest(manifest, definition) {
  const manifestPath = `${definition.directory}/package.json`;
  const errors = [];
  requireEqual(
    errors,
    manifest?.name,
    definition.name,
    `${manifestPath} の name が不正です`,
  );
  if (!isValidSemver(manifest?.version)) {
    errors.push(
      `${manifestPath} の version が semver ではありません: ${JSON.stringify(manifest?.version)}`,
    );
  }
  requireEqual(
    errors,
    manifest?.license,
    "MIT",
    `${manifestPath} の license が不正です`,
  );
  requireEqual(
    errors,
    manifest?.type,
    "module",
    `${manifestPath} は ES Modules ではありません`,
  );
  requireEqual(
    errors,
    manifest?.private,
    undefined,
    `${manifestPath} を公開できません`,
  );
  requireEqual(
    errors,
    manifest?.publishConfig?.access,
    "public",
    `${manifestPath} の scoped package access が不正です`,
  );
  requireEqual(
    errors,
    manifest?.repository?.url,
    "git+https://github.com/katsu996/FlareLobby.git",
    `${manifestPath} の repository が不正です`,
  );
  requireEqual(
    errors,
    manifest?.repository?.directory,
    definition.directory,
    `${manifestPath} の repository.directory が不正です`,
  );
  requireEqual(
    errors,
    manifest?.homepage,
    "https://github.com/katsu996/FlareLobby#readme",
    `${manifestPath} の homepage が不正です`,
  );
  requireEqual(
    errors,
    manifest?.bugs?.url,
    "https://github.com/katsu996/FlareLobby/issues",
    `${manifestPath} の bugs URL が不正です`,
  );

  if (
    typeof manifest?.description !== "string" ||
    manifest.description.trim() === ""
  ) {
    errors.push(`${manifestPath} の description がありません`);
  }
  if (!Array.isArray(manifest?.keywords) || manifest.keywords.length === 0) {
    errors.push(`${manifestPath} の keywords がありません`);
  }

  const filePatterns = new Set(
    Array.isArray(manifest?.files) ? manifest.files : [],
  );
  for (const pattern of [
    "dist",
    "!.tsbuildinfo",
    "README.md",
    "LICENSE",
    ...(definition.requiredManifestPatterns ?? []),
  ]) {
    if (!filePatterns.has(pattern)) {
      errors.push(
        `${manifestPath} の files に必要な許可パターンがありません: ${pattern}`,
      );
    }
  }

  const dependencyNames = Object.keys(manifest?.dependencies ?? {}).sort();
  const expectedDependencyNames = [...definition.dependencies].sort();
  if (
    JSON.stringify(dependencyNames) !== JSON.stringify(expectedDependencyNames)
  ) {
    errors.push(
      `${manifestPath} の runtime 依存関係が想定外です: ${JSON.stringify(dependencyNames)}`,
    );
  }
  for (const dependencyName of dependencyNames) {
    if (manifest?.dependencies?.[dependencyName] !== "workspace:*") {
      errors.push(
        `${manifestPath} の内部依存が workspace protocol ではありません: ${dependencyName}`,
      );
    }
  }
  return errors;
}

export function checkSupplementalFiles({
  definition,
  rootLicense,
  packageLicense,
  packageReadme,
}) {
  const errors = [];
  if (packageLicense !== rootLicense) {
    errors.push(
      `${definition.directory}/LICENSE がルートの MIT License と一致しません`,
    );
  }
  if (
    typeof packageReadme !== "string" ||
    !packageReadme.includes(definition.name) ||
    !packageReadme.includes("pnpm add")
  ) {
    errors.push(
      `${definition.directory}/README.md に package 名または導入例がありません`,
    );
  }
  return errors;
}

export function checkEntryPoints(manifest, definition, exists) {
  const manifestPath = `${definition.directory}/package.json`;
  const errors = [];
  const exportDefinition = manifest?.exports?.["."];
  requireEqual(
    errors,
    exportDefinition?.types,
    "./dist/index.d.ts",
    `${manifestPath} の型 Entry Point が不正です`,
  );
  requireEqual(
    errors,
    exportDefinition?.import,
    "./dist/index.js",
    `${manifestPath} の ESM Entry Point が不正です`,
  );
  requireEqual(
    errors,
    manifest?.types,
    "./dist/index.d.ts",
    `${manifestPath} の types が不正です`,
  );

  for (const entry of [exportDefinition?.types, exportDefinition?.import]) {
    if (typeof entry === "string" && !exists(entry)) {
      errors.push(
        `${manifestPath} の Entry Point が build 成果物にありません: ${entry}`,
      );
    }
  }
  return errors;
}

// publish dry-run の報告は、その package 自身の manifest と突き合わせる。
// private なルートのバージョンとの一致は要求しない。
export function checkPublishReport(publishReport, definition, manifest) {
  const errors = [];
  requireEqual(
    errors,
    publishReport?.name,
    definition.name,
    `${definition.name} の dry-run package 名が不正です`,
  );
  requireEqual(
    errors,
    publishReport?.version,
    manifest?.version,
    `${definition.name} の dry-run version が package manifest と一致しません`,
  );
  return errors;
}

export function checkPackedFiles(packedFiles, definition) {
  const errors = [];
  for (const requiredPath of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    ...(definition.requiredPackedFiles ?? []),
  ]) {
    if (!packedFiles.includes(requiredPath)) {
      errors.push(
        `${definition.name} の npm package に必要なファイルがありません: ${requiredPath}`,
      );
    }
  }

  for (const packedPath of packedFiles) {
    const allowedRootFile = ["LICENSE", "README.md", "package.json"].includes(
      packedPath,
    );
    const allowedDistFile = packedPath.startsWith("dist/");
    const allowedMigrationFile =
      definition.requiredPackedFiles?.some((requiredPath) =>
        packedPath.startsWith(
          `${requiredPath.slice(0, requiredPath.indexOf("/") + 1)}`,
        ),
      ) && packedPath.endsWith(".sql");
    if (!allowedRootFile && !allowedDistFile && !allowedMigrationFile) {
      errors.push(
        `${definition.name} の npm package に不要なファイルがあります: ${packedPath}`,
      );
    }
    if (definition.forbiddenPackedFiles?.includes(packedPath)) {
      errors.push(
        `${definition.name} の npm package に除外対象のファイルがあります: ${packedPath}`,
      );
    }
    if (
      packedPath.endsWith(".tsbuildinfo") ||
      /(^|\/)(src|test)(\/|$)/u.test(packedPath) ||
      /(^|\/)(\.env|\.dev\.vars)/u.test(packedPath)
    ) {
      errors.push(
        `${definition.name} の npm package に内部・秘密ファイルがあります: ${packedPath}`,
      );
    }
  }
  return errors;
}

// tarball 内の公開用内部依存は、参照先 package の manifest バージョンへ
// 変換されていることを検証する。異なる package バージョンの組合せは正常とする。
export function checkPackedManifest(
  packedManifest,
  definition,
  versionsByName,
) {
  const errors = [];
  if (JSON.stringify(packedManifest).includes("workspace:")) {
    errors.push(
      `${definition.name} の tarball manifest に workspace protocol が残っています`,
    );
  }
  for (const dependencyName of definition.dependencies) {
    const expected = versionsByName.get(dependencyName);
    if (expected === undefined) {
      errors.push(
        `${definition.name} の内部依存先が不明です: ${dependencyName}`,
      );
      continue;
    }
    requireEqual(
      errors,
      packedManifest?.dependencies?.[dependencyName],
      expected,
      `${definition.name} の公開用内部依存 version が参照先 manifest と一致しません: ${dependencyName}`,
    );
  }
  return errors;
}

// tarball 検証の期待値は各 package の manifest から導出する。
export function collectPublishedVersions(definitions, manifestsByDirectory) {
  const versionsByName = new Map();
  for (const definition of definitions) {
    const manifest = manifestsByDirectory.get(definition.directory);
    if (
      typeof manifest?.name === "string" &&
      typeof manifest?.version === "string"
    ) {
      versionsByName.set(manifest.name, manifest.version);
    }
  }
  return versionsByName;
}
