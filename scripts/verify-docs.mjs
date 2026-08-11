import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  "docs/getting-started.md",
  "docs/custom-room-guide.md",
  "docs/matchmaking-guide.md",
  "docs/api-reference.md",
  "docs/architecture.md",
  "docs/testing.md",
  "docs/releases/v0.1.0.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/tsconfig.json",
  "docs/adr/0001-durable-object-sqlite.md",
  "docs/adr/0002-reconnect-and-revision.md",
  "docs/adr/0003-public-room-index.md",
  "docs/adr/0004-match-result-trust-boundary.md",
  "examples/local-demo/src/index.ts",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/pull_request_template.md"
];

for (const file of requiredFiles) read(file);

requireText("README.md", "./docs/getting-started.md");
requireText("README.md", "./docs/api-reference.md");
requireText("README.md", "./docs/architecture.md");
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

function exportedNames(entryPath) {
  const entry = read(entryPath);
  const files = [entry];
  for (const match of entry.matchAll(/export\s+\*\s+from\s+["'](.+?)["']/gu)) {
    const target = match[1];
    if (target !== undefined && target.endsWith(".js")) {
      files.push(read(resolve(dirname(entryPath), target.replace(/\.js$/u, ".ts"))));
    }
  }

  const names = new Set();
  for (const content of files) {
    for (const match of content.matchAll(
      /export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s+from\s+[^;]+)?;/gu
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
      /export\s+(?:declare\s+)?(?:type|interface|const|function|class)\s+([A-Za-z_$][\w$]*)/gu
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
  "packages/testing/src/index.ts"
];

for (const entry of publicEntries) {
  for (const name of exportedNames(entry)) {
    if (!new RegExp(`\\b${name.replace(/[$]/gu, "\\$")}\\b`, "u").test(apiReference)) {
      errors.push(`APIリファレンスに公開 Export がありません: ${name} (${entry})`);
    }
  }
}

function sourceStringValues(relativePath, constantName) {
  const content = read(relativePath);
  const match = new RegExp(
    `${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
    "u"
  ).exec(content);
  return match === null
    ? []
    : [...(match[1] ?? "").matchAll(/"([^"\\n]+)"/gu)].map((value) => value[1]);
}

for (const code of [
  ...sourceStringValues("packages/core/src/protocol.ts", "FLARE_LOBBY_ERROR_CODES"),
  ...sourceStringValues(
    "packages/cloudflare/src/config.ts",
    "FLARE_LOBBY_CONFIGURATION_ERROR_CODES"
  )
]) {
  if (code !== undefined && !apiReference.includes(`\`${code}\``)) {
    errors.push(`APIリファレンスにエラーコードがありません: ${code}`);
  }
}

const markdownFiles = [
  "README.md",
  "docs/getting-started.md",
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
  "docs/releases/v0.1.0.md",
  "CHANGELOG.md",
  "packages/core/README.md",
  "packages/cloudflare/README.md",
  "packages/client/README.md",
  "packages/testing/README.md",
  "examples/README.md"
];

for (const markdownFile of markdownFiles) {
  const content = read(markdownFile);
  for (const match of content.matchAll(/\]\((\.[^)#]+)(?:#[^)]+)?\)/gu)) {
    const target = match[1];
    if (target !== undefined && !existsSync(resolve(root, dirname(markdownFile), target))) {
      errors.push(`${markdownFile} のリンク先がありません: ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error("文書検証に失敗しました。");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("文書、公開 API、エラーコード、リンクの検証に成功しました。");
}
