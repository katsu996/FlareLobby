import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`必須ファイルがありません: ${relativePath}`);
    return "";
  }

  return readFileSync(absolutePath, "utf8");
}

function requireText(relativePath, text) {
  const content = read(relativePath);
  if (!content.includes(text)) {
    errors.push(`${relativePath} に必要な記載がありません: ${text}`);
  }
}

const requiredFiles = [
  "README.md",
  "README.en.md",
  "docs/en/index.md",
  "docs/en/getting-started.md",
  "docs/examples/english-quick-start.ts",
  "docs/public/llms.txt",
  "docs/getting-started.md",
  "docs/hosted-demo.md",
  "docs/local-demo.md",
  "docs/index.md",
  "docs/custom-room-guide.md",
  "docs/matchmaking-guide.md",
  "docs/api-reference.md",
  "docs/architecture.md",
  "docs/testing.md",
  "docs/versioning.md",
  "docs/upgrading.md",
  "docs/releases/current.md",
  "docs/releases/v0.1.0.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/tsconfig.json",
  "docs/adr/0001-durable-object-sqlite.md",
  "docs/adr/0002-reconnect-and-revision.md",
  "docs/adr/0003-public-room-index.md",
  "docs/adr/0004-match-result-trust-boundary.md",
  "docs/adr/0005-party-matching-and-team-composition.md",
  "docs/adr/0006-rating-strategy-and-glicko2.md",
  "templates/standalone/README.md",
  "templates/supabase/README.md",
  "examples/local-demo/src/index.ts",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/pull_request_template.md",
];

for (const file of requiredFiles) read(file);

requireText("README.md", "./docs/getting-started.md");
requireText("README.md", "./docs/api-reference.md");
requireText("README.md", "./docs/architecture.md");
requireText("README.md", "./README.en.md");
requireText("README.en.md", "./README.md");
requireText("README.en.md", "@flarelobby/cloudflare");
requireText("README.en.md", "getAccessToken");
requireText("README.en.md", "two browser windows");
requireText("docs/en/index.md", "/en/getting-started");
requireText("docs/en/index.md", "Japanese:");
requireText("docs/en/getting-started.md", "FLARE_LOBBY_TOKEN_SECRET");
requireText("docs/en/getting-started.md", "verifyApplicationToken");
requireText("docs/en/getting-started.md", "two browser windows");
requireText("docs/public/llms.txt", "README.en.md");
requireText("docs/public/llms.txt", "docs/en/getting-started.md");
requireText("docs/.vitepress/config.mts", "locales:");
requireText("docs/.vitepress/config.mts", 'link: "/en/"');
requireText("docs/.vitepress/config.mts", "i18nRouting: false");
requireText("docs/.vitepress/config.mts", 'buttonText: "Search"');
requireText("README.md", "./docs/releases/current.md");
requireText("README.md", "./docs/versioning.md");
requireText("README.md", "./docs/upgrading.md");
requireText("README.en.md", "./docs/releases/current.md");
requireText("README.en.md", "./docs/versioning.md");
requireText("README.en.md", "./docs/upgrading.md");
requireText("docs/public/llms.txt", "docs/releases/current.md");
requireText("docs/public/llms.txt", "docs/versioning.md");
requireText("docs/public/llms.txt", "docs/upgrading.md");
requireText("docs/public/llms.txt", "docs/hosted-demo.md");
requireText("docs/public/llms.txt", "docs/local-demo.md");
requireText("docs/public/llms.txt", "templates/standalone/README.md");
requireText("docs/public/llms.txt", "templates/supabase/README.md");
requireText("docs/.vitepress/config.mts", "/releases/current");
requireText("docs/.vitepress/config.mts", "/versioning");
requireText("docs/.vitepress/config.mts", "/upgrading");
requireText("docs/.vitepress/config.mts", "/hosted-demo");
requireText("docs/.vitepress/config.mts", "/local-demo");
requireText("README.md", "./templates/standalone/README.md");
requireText("README.md", "./templates/supabase/README.md");
requireText("README.en.md", "./templates/standalone/README.md");
requireText("README.en.md", "./templates/supabase/README.md");
requireText("README.en.md", "./docs/local-demo.md");
requireText("README.md", "未検証のランタイム互換性は断言しません");
requireText(
  "docs/getting-started.md",
  "未検証のランタイム互換性は断言しません",
);
requireText("docs/versioning.md", "未検証のランタイムは対応済みと表示しません");
requireText(
  "docs/releases/current.md",
  "Firefox と WebKit は実行していないため未検証とします",
);
requireText("README.md", "pnpm check:docs");
requireText("README.md", "pnpm release:check");
requireText("README.md", "MIT License");
requireText("docs/architecture.md", "Room Durable Object");
requireText("docs/architecture.md", "revision");
requireText("docs/architecture.md", "D1");
requireText("docs/architecture.md", "再接続");
requireText("docs/api-reference.md", "## エラーコード");
requireText("docs/api-reference.md", "## 公開 Export の検査対象");
requireText("docs/testing.md", "完了条件");
requireText("docs/releases/v0.1.0.md", "## 既知の制限");
requireText("docs/releases/v0.1.0.md", "## 対象外");
requireText(".github/ISSUE_TEMPLATE/bug_report.md", "## 完了条件");
requireText(".github/ISSUE_TEMPLATE/feature_request.md", "設計の正本 #1");
requireText(".github/pull_request_template.md", "Closes #");

for (const packageDirectory of [
  "packages/core",
  "packages/client",
  "packages/cloudflare",
  "packages/testing",
]) {
  requireText(`${packageDirectory}/README.md`, "README.en.md");
  requireText(`${packageDirectory}/README.md`, "docs/en/getting-started.md");
}

function exportedNames(entryPath) {
  const entry = read(entryPath);
  const files = [entry];
  for (const match of entry.matchAll(/export\s+\*\s+from\s+["'](.+?)["']/gu)) {
    const target = match[1];
    if (target !== undefined && target.endsWith(".js")) {
      files.push(
        read(join(dirname(entryPath), target.replace(/\.js$/u, ".ts"))),
      );
    }
  }

  const names = new Set();
  for (const content of files) {
    for (const match of content.matchAll(
      /export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s+from\s+[^;]+)?;/gu,
    )) {
      for (const raw of (match[1] ?? "").split(",")) {
        const name = raw
          .replace(/\/\/.*$/u, "")
          .replace(/^\s*type\s+/u, "")
          .split(/\s+as\s+/u)[0]
          ?.trim();
        if (name !== undefined && /^[A-Za-z_$][\w$]*$/u.test(name)) {
          names.add(name);
        }
      }
    }

    for (const match of content.matchAll(
      /export\s+(?:declare\s+)?(?:type|interface|const|function|class)\s+([A-Za-z_$][\w$]*)/gu,
    )) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }

  return names;
}

const apiReference = read("docs/api-reference.md");
const publicEntries = [
  "packages/core/src/index.ts",
  "packages/client/src/index.ts",
  "packages/cloudflare/src/index.ts",
  "packages/testing/src/index.ts",
];

for (const entry of publicEntries) {
  for (const name of exportedNames(entry)) {
    if (
      !new RegExp(`\\b${name.replace(/[$]/gu, "\\$")}\\b`, "u").test(
        apiReference,
      )
    ) {
      errors.push(
        `APIリファレンスに公開 Export がありません: ${name} (${entry})`,
      );
    }
  }
}

function sourceStringValues(relativePath, constantName) {
  const content = read(relativePath);
  const match = new RegExp(
    `${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
    "u",
  ).exec(content);
  return match === null
    ? []
    : [...(match[1] ?? "").matchAll(/"([^"\n]+)"/gu)].map((value) => value[1]);
}

for (const code of [
  ...sourceStringValues(
    "packages/core/src/protocol.ts",
    "FLARE_LOBBY_ERROR_CODES",
  ),
  ...sourceStringValues(
    "packages/cloudflare/src/config.ts",
    "FLARE_LOBBY_CONFIGURATION_ERROR_CODES",
  ),
]) {
  if (code !== undefined && !apiReference.includes(`\`${code}\``)) {
    errors.push(`APIリファレンスにエラーコードがありません: ${code}`);
  }
}

const markdownFiles = [
  "README.md",
  "README.en.md",
  "docs/en/index.md",
  "docs/en/getting-started.md",
  "docs/getting-started.md",
  "docs/hosted-demo.md",
  "docs/local-demo.md",
  "docs/index.md",
  "docs/custom-room-guide.md",
  "docs/matchmaking-guide.md",
  "docs/api-reference.md",
  "docs/architecture.md",
  "docs/client.md",
  "docs/cloudflare-configuration.md",
  "docs/custom-room-list.md",
  "docs/custom-room-participation.md",
  "docs/domain-model.md",
  "docs/match-pool.md",
  "docs/observability.md",
  "docs/protocol.md",
  "docs/rating.md",
  "docs/security.md",
  "docs/testing.md",
  "docs/versioning.md",
  "docs/upgrading.md",
  "docs/releases/v0.1.0.md",
  "docs/releases/current.md",
  "docs/public/llms.txt",
  "docs/adr/0001-durable-object-sqlite.md",
  "docs/adr/0002-reconnect-and-revision.md",
  "docs/adr/0003-public-room-index.md",
  "docs/adr/0004-match-result-trust-boundary.md",
  "docs/adr/0005-party-matching-and-team-composition.md",
  "docs/adr/0006-rating-strategy-and-glicko2.md",
  "CHANGELOG.md",
  "templates/standalone/README.md",
  "templates/supabase/README.md",
  "packages/core/README.md",
  "packages/cloudflare/README.md",
  "packages/client/README.md",
  "packages/testing/README.md",
  "examples/README.md",
];

for (const markdownFile of markdownFiles) {
  const content = read(markdownFile);
  for (const match of content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/gu)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const rawPrefix =
      "https://raw.githubusercontent.com/katsu996/FlareLobby/main/";
    if (target.startsWith(rawPrefix)) {
      const relativePath = target.slice(rawPrefix.length);
      if (!existsSync(resolve(root, relativePath))) {
        errors.push(`${markdownFile} のリンク先がありません: ${target}`);
      }
      continue;
    }
    if (target.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(target)) {
      continue;
    }
    if (!existsSync(resolve(root, dirname(markdownFile), target))) {
      errors.push(`${markdownFile} のリンク先がありません: ${target}`);
    }
  }
}

// Issue #117: standalone テンプレートと導入手順のドリフト検出。
// registry 取得・実 Supabase 接続は使わず、ローカルに固定できる対応だけを確認する。
function parseJsonc(content, relativePath) {
  const withoutComments = content.replace(/\/\/.*$/gm, "");
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/gu, "$1");
  try {
    return JSON.parse(withoutTrailingCommas);
  } catch {
    errors.push(`${relativePath} の JSONC を解釈できません。`);
    return null;
  }
}

function requireAll(relativePath, texts) {
  const content = read(relativePath);
  for (const text of texts) {
    if (!content.includes(text)) {
      errors.push(`${relativePath} に必要な記載がありません: ${text}`);
    }
  }
}

const standaloneManifest = parseJsonc(
  read("templates/standalone/package.json"),
  "templates/standalone/package.json",
);
if (standaloneManifest !== null) {
  if (
    typeof standaloneManifest.engines?.node !== "string" ||
    !standaloneManifest.engines.node.includes(">=22.12.0")
  ) {
    errors.push(
      "templates/standalone/package.json の engines.node が >=22.12.0 ではありません。",
    );
  }
  if (
    typeof standaloneManifest.packageManager !== "string" ||
    !standaloneManifest.packageManager.startsWith("pnpm@")
  ) {
    errors.push(
      "templates/standalone/package.json の packageManager が pnpm ではありません。",
    );
  }
  for (const script of [
    "generate:types",
    "typecheck",
    "build",
    "dev:worker",
    "dev:browser",
    "db:apply:local",
    "deploy:dry-run",
  ]) {
    if (typeof standaloneManifest.scripts?.[script] !== "string") {
      errors.push(
        `templates/standalone/package.json に script がありません: ${script}`,
      );
    }
  }
  for (const name of [
    "@flarelobby/core",
    "@flarelobby/client",
    "@flarelobby/cloudflare",
  ]) {
    const spec = standaloneManifest.dependencies?.[name];
    if (typeof spec !== "string") {
      errors.push(
        `templates/standalone/package.json の dependencies に ${name} がありません。`,
      );
    } else if (
      spec.includes("workspace:") ||
      spec.includes("file:") ||
      spec.includes("/") ||
      spec.includes("\\")
    ) {
      errors.push(
        `templates/standalone/package.json の ${name} が公開バージョン指定ではありません: ${spec}`,
      );
    }
  }
}

const standaloneWrangler = parseJsonc(
  read("templates/standalone/wrangler.jsonc"),
  "templates/standalone/wrangler.jsonc",
);
if (standaloneWrangler !== null) {
  const bindings = standaloneWrangler.durable_objects?.bindings;
  const expectedBindings = [
    ["FLARE_LOBBY_ROOMS", "RoomDurableObject"],
    ["FLARE_LOBBY_MATCH_POOLS", "MatchPoolDurableObject"],
    ["FLARE_LOBBY_PARTIES", "PartyDurableObject"],
    ["FLARE_LOBBY_PARTY_MEMBERSHIPS", "PartyMembershipDurableObject"],
    ["FLARE_LOBBY_RATE_LIMITS", "RateLimitDurableObject"],
  ];
  for (const [name, className] of expectedBindings) {
    if (
      !Array.isArray(bindings) ||
      !bindings.some(
        (binding) =>
          binding?.name === name && binding?.class_name === className,
      )
    ) {
      errors.push(
        `templates/standalone/wrangler.jsonc に Durable Object Binding がありません: ${name} (${className})`,
      );
    }
  }
  const migrations = standaloneWrangler.migrations;
  const expectedMigrations = [
    ["v1", ["RoomDurableObject", "MatchPoolDurableObject"]],
    ["v2", ["RateLimitDurableObject"]],
    ["v3", ["PartyDurableObject", "PartyMembershipDurableObject"]],
  ];
  for (const [tag, classes] of expectedMigrations) {
    const entry = Array.isArray(migrations)
      ? migrations.find((migration) => migration?.tag === tag)
      : undefined;
    const actual = entry?.new_sqlite_classes;
    if (
      !Array.isArray(actual) ||
      classes.length !== actual.length ||
      !classes.every((className) => actual.includes(className))
    ) {
      errors.push(
        `templates/standalone/wrangler.jsonc の DO Migration が不正です: ${tag}`,
      );
    }
  }
  const d1 = Array.isArray(standaloneWrangler.d1_databases)
    ? standaloneWrangler.d1_databases[0]
    : undefined;
  if (d1?.binding !== "FLARE_LOBBY_DB") {
    errors.push(
      "templates/standalone/wrangler.jsonc の D1 binding が FLARE_LOBBY_DB ではありません。",
    );
  }
  if (d1?.migrations_dir !== "node_modules/@flarelobby/cloudflare/migrations") {
    errors.push(
      "templates/standalone/wrangler.jsonc の migrations_dir が公開 package 参照ではありません。",
    );
  }
  if ("database_id" in (d1 ?? {})) {
    errors.push(
      "templates/standalone/wrangler.jsonc に database_id が含まれています（ローカル用は未設定にします）。",
    );
  }
  const secrets = standaloneWrangler.secrets?.required;
  if (
    !Array.isArray(secrets) ||
    !secrets.includes("FLARE_LOBBY_TOKEN_SECRET")
  ) {
    errors.push(
      "templates/standalone/wrangler.jsonc の secrets.required に FLARE_LOBBY_TOKEN_SECRET がありません。",
    );
  }
}

requireAll("templates/standalone/README.md", [
  ">=22.12.0",
  "11.21.0",
  "cp .dev.vars.example .dev.vars",
  "FLARE_LOBBY_TOKEN_SECRET",
  "database_id",
  "pnpm generate:types",
  "pnpm typecheck",
  "pnpm db:apply:local",
  "pnpm dev:worker",
  "pnpm dev:browser",
  "http://localhost:8787",
  "http://localhost:5173",
  "pnpm build",
  "dist/",
  "pnpm deploy:dry-run",
  "0001",
  "0002",
  "0004",
  "0005",
  "0003_local_demo_rps",
  "verifyApplicationToken",
  "getAccessToken",
  "allowedOrigins",
  "skipLibCheck",
]);
const standaloneReadme = read("templates/standalone/README.md");
if (standaloneReadme.includes("workspace:")) {
  errors.push(
    "templates/standalone/README.md に workspace 参照があります（公開パッケージ名で解決します）。",
  );
}

requireAll("templates/standalone/.dev.vars.example", [
  "FLARE_LOBBY_TOKEN_SECRET",
]);

// tarball 経路の記載は開発者向けに残し、削除しない。
requireAll("docs/getting-started.md", [
  ">=22.12.0",
  "pnpm generate:types",
  "pnpm typecheck",
  "pnpm db:apply:local",
  "pnpm dev:worker",
  "pnpm dev:browser",
  "pnpm build",
  "pnpm deploy:dry-run",
  "FLARE_LOBBY_TOKEN_SECRET",
  "database_id",
  "node_modules/@flarelobby/cloudflare/migrations",
  "0001",
  "0002",
  "0004",
  "0005",
  "0003_local_demo_rps",
  "verifyApplicationToken",
  "getAccessToken",
  "http://localhost:5173",
  "http://localhost:8787",
  "pack",
  "file:",
  "pnpm-workspace.yaml",
  '"status": "ready"',
]);

if (errors.length > 0) {
  console.error("文書検証に失敗しました。");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("文書、公開 API、エラーコード、リンクの検証に成功しました。");
}
