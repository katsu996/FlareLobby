// scripts/verify-packages.test.mjs
//
// package-verification.mjs の fixture 検証。実 manifest は書き換えない。
// 実行: node --test scripts/verify-packages.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  isValidSemver,
} from "./package-verification.mjs";

const CORE_DEFINITION = {
  directory: "packages/core",
  name: "@flarelobby/core",
  dependencies: [],
};

const CLOUDFLARE_DEFINITION = {
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
};

function sourceManifest(overrides = {}) {
  return {
    name: "@flarelobby/core",
    version: "0.1.0",
    license: "MIT",
    type: "module",
    publishConfig: { access: "public" },
    repository: {
      type: "git",
      url: "git+https://github.com/katsu996/FlareLobby.git",
      directory: "packages/core",
    },
    homepage: "https://github.com/katsu996/FlareLobby#readme",
    bugs: { url: "https://github.com/katsu996/FlareLobby/issues" },
    description: "fixture 用の説明文",
    keywords: ["cloudflare"],
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
    },
    types: "./dist/index.d.ts",
    files: ["dist", "!.tsbuildinfo", "README.md", "LICENSE"],
    ...overrides,
  };
}

function cloudflareManifest(overrides = {}) {
  return {
    ...sourceManifest(),
    name: "@flarelobby/cloudflare",
    repository: {
      type: "git",
      url: "git+https://github.com/katsu996/FlareLobby.git",
      directory: "packages/cloudflare",
    },
    files: [
      "dist",
      "!.tsbuildinfo",
      "migrations",
      "!migrations/0003_local_demo_rps.sql",
      "README.md",
      "LICENSE",
    ],
    dependencies: { "@flarelobby/core": "workspace:*" },
    ...overrides,
  };
}

const CORE_PACKED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
];

const BASE_PACKED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
  "migrations/0001_custom_room_index.sql",
  "migrations/0002_rating.sql",
  "migrations/0004_team_rating.sql",
  "migrations/0005_rating_algorithm.sql",
];

describe("isValidSemver", () => {
  it("通常のバージョンを受け付ける", () => {
    assert.equal(isValidSemver("0.1.0"), true);
    assert.equal(isValidSemver("0.2.0"), true);
    assert.equal(isValidSemver("1.10.3-alpha.1"), true);
  });

  it("非 semver を拒否する", () => {
    assert.equal(isValidSemver("workspace:*"), false);
    assert.equal(isValidSemver("0.1"), false);
    assert.equal(isValidSemver("v1.0.0"), false);
    assert.equal(isValidSemver(""), false);
    assert.equal(isValidSemver(undefined), false);
  });
});

describe("現在の 0.1.0 構成", () => {
  it("ルートと 0.1.0 の package 構成で成功する", () => {
    const rootManifest = {
      name: "flarelobby",
      version: "0.1.0",
      private: true,
      license: "MIT",
    };
    assert.deepEqual(checkRootManifest(rootManifest, { access: "public" }), []);
    assert.deepEqual(
      checkSourceManifest(sourceManifest(), CORE_DEFINITION),
      [],
    );
    assert.deepEqual(
      checkSourceManifest(cloudflareManifest(), CLOUDFLARE_DEFINITION),
      [],
    );
    assert.deepEqual(checkPackedFiles(CORE_PACKED_FILES, CORE_DEFINITION), []);
    assert.deepEqual(
      checkPackedFiles(BASE_PACKED_FILES, CLOUDFLARE_DEFINITION),
      [],
    );
  });

  it("歴史的な初回日付・空 Changeset の文言が残っていても成功する", () => {
    const errors = checkHistoricalDocuments({
      changelog: "## 0.1.0 - 2026-08-12\n\n- 初回公開\n",
      releaseNote: "# FlareLobby v0.1.0 Release Note\n\n本文\n",
      changeset:
        "---\n---\n\nこの empty\nChangeset では追加の bump を行いません。\n",
    });
    assert.deepEqual(errors, []);
  });
});

describe("バージョン変更の fixture", () => {
  it("ルートを変更せず一部 package だけ別バージョンでも成功する", () => {
    const manifestsByDirectory = new Map([
      ["packages/core", sourceManifest({ version: "0.1.0" })],
      ["packages/cloudflare", cloudflareManifest({ version: "0.2.0" })],
    ]);
    const versionsByName = collectPublishedVersions(
      [CORE_DEFINITION, CLOUDFLARE_DEFINITION],
      manifestsByDirectory,
    );
    assert.equal(versionsByName.get("@flarelobby/core"), "0.1.0");
    assert.equal(versionsByName.get("@flarelobby/cloudflare"), "0.2.0");

    // ルートは 0.1.0 のままでも検証対象にしない。
    assert.deepEqual(
      checkRootManifest(
        { name: "flarelobby", version: "0.1.0", private: true, license: "MIT" },
        { access: "public" },
      ),
      [],
    );
    // pack 報告は自身の manifest と突き合わせる。
    assert.deepEqual(
      checkPublishReport(
        { name: "@flarelobby/cloudflare", version: "0.2.0" },
        CLOUDFLARE_DEFINITION,
        manifestsByDirectory.get("packages/cloudflare"),
      ),
      [],
    );
    // 内部依存は参照先 manifest のバージョンへ変換される。
    assert.deepEqual(
      checkPackedManifest(
        {
          name: "@flarelobby/cloudflare",
          dependencies: { "@flarelobby/core": "0.1.0" },
        },
        CLOUDFLARE_DEFINITION,
        versionsByName,
      ),
      [],
    );
  });

  it("過去の日付や初回 Changeset がなくても現在の公開可否に影響しない", () => {
    const errors = checkHistoricalDocuments({
      changelog: "## 0.2.0 - 2026-09-01\n\n- 変更\n",
      releaseNote: "# FlareLobby v0.1.0 Release Note\n\n本文\n",
      changeset: "---\n---\n\n通常の changeset 本文\n",
    });
    assert.deepEqual(errors, []);
  });

  it("歴史文書の欠落は保存義務として検出する", () => {
    const errors = checkHistoricalDocuments({
      changelog: "",
      releaseNote: "# note\n",
      changeset: "---\n---\n\nx\n",
    });
    assert.match(errors.join("\n"), /CHANGELOG/);
  });
});

describe("不正な配布物の検出", () => {
  it("内部依存の公開バージョン不一致を検出する", () => {
    const versionsByName = new Map([["@flarelobby/core", "0.1.0"]]);
    const errors = checkPackedManifest(
      {
        name: "@flarelobby/cloudflare",
        dependencies: { "@flarelobby/core": "0.9.9" },
      },
      CLOUDFLARE_DEFINITION,
      versionsByName,
    );
    assert.match(errors.join("\n"), /公開用内部依存/);
  });

  it("tarball manifest の workspace: 残存を検出する", () => {
    const versionsByName = new Map([["@flarelobby/core", "0.1.0"]]);
    const errors = checkPackedManifest(
      {
        name: "@flarelobby/cloudflare",
        dependencies: { "@flarelobby/core": "workspace:*" },
      },
      CLOUDFLARE_DEFINITION,
      versionsByName,
    );
    assert.match(errors.join("\n"), /workspace protocol/);
  });

  it("配布 Entry Point の欠落を検出する", () => {
    const manifestErrors = checkEntryPoints(
      sourceManifest({
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/missing.js" },
        },
      }),
      CORE_DEFINITION,
      () => false,
    );
    assert.match(manifestErrors.join("\n"), /Entry Point/);

    const packedErrors = checkPackedFiles(
      CORE_PACKED_FILES.filter((file) => file !== "dist/index.js"),
      CORE_DEFINITION,
    );
    assert.match(packedErrors.join("\n"), /必要なファイルがありません/);
  });

  it("ライセンス欠落を検出する", () => {
    const errors = checkSupplementalFiles({
      definition: CORE_DEFINITION,
      rootLicense: "MIT license text",
      packageLicense: "",
      packageReadme: "@flarelobby/core\n\npnpm add @flarelobby/core\n",
    });
    assert.match(errors.join("\n"), /LICENSE/);
  });

  it("秘密・内部ファイル混入と除外対象 SQL を検出する", () => {
    const errors = checkPackedFiles(
      [
        ...BASE_PACKED_FILES,
        "src/index.ts",
        ".env",
        "migrations/0003_local_demo_rps.sql",
      ],
      CLOUDFLARE_DEFINITION,
    );
    assert.match(errors.join("\n"), /内部・秘密ファイル/);
    assert.match(errors.join("\n"), /除外対象/);
  });

  it("dry-run バージョンが自身の manifest と違う場合は失敗にする", () => {
    const errors = checkPublishReport(
      { name: "@flarelobby/cloudflare", version: "0.1.0" },
      CLOUDFLARE_DEFINITION,
      cloudflareManifest({ version: "0.2.0" }),
    );
    assert.match(errors.join("\n"), /dry-run version/);
  });
});
