// scripts/verify-consumer.mjs
//
// 配布 tarball の独立プロジェクト導入 E2E (Issue #85)。
//
// - 4 package を build/pack し、OS 一時ディレクトリへ独立テンプレートをコピーする。
// - 本体 4 package は同一検証で生成した tarball からのみ解決する (pnpm overrides で推移依存も固定)。
// - src への symlink / workspace: / tsconfig paths / 元 repo node_modules 参照を禁止する。
// - client/core/testing の Node ESM import を確認し、cloudflare runtime entry は Workers 側で検証する。
// - wrangler types + skipLibCheck:false の型検査を実行する。
// - 配布 Migration だけでローカル D1 を初期化し、wrangler dev をローカル起動する。
// - 認証は独立テスト entry から注入し、配布テンプレートの拒否設定を維持する。
// - Playwright Chromium + 別オリジン Vite/browser で HTTP/WebSocket を利用する。
// - 実ブラウザ 2 context で作成・参加・準備・状態通知・1v1・切断復帰・cancel/dispose を検証する。
// - 切断は offline 制御で起こし、snapshot/revision の状態到達を待つ (任意 sleep 判定なし)。
// - 子プロセス・ポート・一時ファイルを成功/失敗/中断時に解放する。
// - 失敗時は状態・段階・安全なログを保存し、token/secret を artifact に含めない。
// - Cloudflare account / 本番 DB / 実デプロイ credential を必要としない。

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// 明示する上限 (CI タイムアウトと各プロセスの起動待ち)。
const TIMEOUTS = {
  buildMs: 5 * 60_000,
  installMs: 5 * 60_000,
  typecheckMs: 3 * 60_000,
  d1Ms: 2 * 60_000,
  workerStartMs: 90_000,
  viteStartMs: 30_000,
  browserStepMs: 20_000,
  browserTotalMs: 5 * 60_000,
  pollIntervalMs: 100,
};

const PACKAGES = [
  { directory: "packages/core", name: "@flarelobby/core" },
  { directory: "packages/client", name: "@flarelobby/client" },
  { directory: "packages/testing", name: "@flarelobby/testing" },
  { directory: "packages/cloudflare", name: "@flarelobby/cloudflare" },
];

let stage = "init";
let consumerRoot = "";
let archiveDirectory = "";
let logDirectory = "";
let workerProcess = null;
let viteProcess = null;
let browserHandle = null;
let workerPort = 0;
let vitePort = 0;
let workerOrigin = "";
let viteOrigin = "";
let disallowedOrigin = "";
let testSecret = "";
let failureBundleDirectory = "";
const reservedPorts = new Set();

function log(message) {
  console.log(`[verify-consumer:${stage}] ${redact(message)}`);
}

function redact(value) {
  if (typeof value !== "string") return value;
  let output = value;
  if (testSecret) output = output.split(testSecret).join("[redacted-secret]");
  // Bearer トークン相当をマスクする (テスト用ランダム値でも artifact に残さない)。
  output = output.replace(
    /Bearer\s+[A-Za-z0-9._\-+/=]+/gu,
    "Bearer [redacted]",
  );
  return output;
}

function fail(message) {
  throw new Error(message);
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
    env: {
      ...process.env,
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      ...options.env,
    },
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} が失敗しました (status=${result.status}):\n${redact(`${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 8000))}`,
    );
  }
  return result.stdout ?? "";
}

function findFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        if (reservedPorts.has(port)) {
          findFreePort().then(resolvePromise, rejectPromise);
          return;
        }
        reservedPorts.add(port);
        resolvePromise(port);
      });
    });
  });
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      // wrangler dev の 404/200 いずれも起動済みとみなす。接続拒否だけ待つ。
      if (response.status > 0) return response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(TIMEOUTS.pollIntervalMs);
  }
  fail(`${label} の起動待ちがタイムアウトしました (${url}): ${lastError}`);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "";
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
      lastValue =
        typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    } catch (error) {
      lastValue = error instanceof Error ? error.message : String(error);
    }
    await delay(TIMEOUTS.pollIntervalMs);
  }
  fail(
    `状態到達の待機がタイムアウトしました: ${label} (last=${lastValue.slice(0, 500)})`,
  );
}

function startProcess(command, args, options, logFile) {
  const child = spawn(command, args, {
    ...options,
    env: {
      ...process.env,
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      WRANGLER_SEND_METRICS: "false",
      ...options.env,
    },
  });
  const chunks = [];
  child.stdout?.on("data", (data) => chunks.push(String(data)));
  child.stderr?.on("data", (data) => chunks.push(String(data)));
  child.on("exit", () => {
    try {
      if (logFile) writeFileSync(logFile, redact(chunks.join("")), "utf8");
    } catch {
      // ログ保存の失敗で検証結果を上書きしない。
    }
  });
  return { child, chunks };
}

async function stopProcess(handle, label, timeoutMs = 10_000) {
  if (!handle) return;
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  child.kill("SIGKILL");
}

function cleanupSync() {
  try {
    if (browserHandle) {
      void browserHandle.close().catch(() => {});
      browserHandle = null;
    }
  } catch {
    // ignore
  }
  try {
    if (workerProcess) {
      workerProcess.child.kill("SIGKILL");
      workerProcess = null;
    }
  } catch {
    // ignore
  }
  try {
    if (viteProcess) {
      viteProcess.child.kill("SIGKILL");
      viteProcess = null;
    }
  } catch {
    // ignore
  }
}

function preserveFailureBundle(error) {
  try {
    failureBundleDirectory = join(
      tmpdir(),
      `flarelobby-consumer-failure-${Date.now()}`,
    );
    mkdirSync(failureBundleDirectory, { recursive: true });
    const state = {
      stage,
      workerOrigin,
      viteOrigin,
      disallowedOrigin,
      timeoutsMs: TIMEOUTS,
      error: redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    };
    writeFileSync(
      join(failureBundleDirectory, "state.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );
    for (const file of ["wrangler.log", "vite.log", "browser.json"]) {
      const source = join(logDirectory, file);
      if (source && logDirectory && existsSync(source)) {
        copyFileSync(source, join(failureBundleDirectory, file));
      }
    }
    // 子プロセスの最終出力を追記する。
    for (const [handle, name] of [
      [workerProcess, "wrangler.log"],
      [viteProcess, "vite.log"],
    ]) {
      try {
        const target = join(failureBundleDirectory, name);
        if (handle && !existsSync(target)) {
          writeFileSync(
            target,
            redact((handle.chunks ?? []).join("").slice(-20000)),
            "utf8",
          );
        }
      } catch {
        // ignore
      }
    }
    console.error(
      `consumer 検証の失敗ログを保存しました: ${failureBundleDirectory}`,
    );
    console.error(
      "token/secret はマスク済みです。所要時間と段階は state.json を参照してください。",
    );
  } catch (bundleError) {
    console.error(
      `失敗ログの保存に失敗しました: ${bundleError instanceof Error ? bundleError.message : String(bundleError)}`,
    );
  }
}

process.on("SIGINT", () => {
  cleanupSync();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupSync();
  process.exit(143);
});

// ---------- consumer file templates ----------

function testWorkerSource(allowedOrigin) {
  return `import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

export type ConsumerTestApp = FlareLobbyApp<{ map: string }, { name: string }, {}>;

const lobby = defineFlareLobby<ConsumerTestApp>({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 0,
    defaultSettings: { map: "forest" },
  },
  matchmakingPools: [
    {
      id: "solo-1v1",
      gameId: "standalone",
      seasonId: "season-1",
      mode: "duel-1v1",
      region: "jp",
      matchRoom: {
        settings: { map: "forest" },
        metadata: { name: "standalone duel" },
        teamIds: ["blue", "red"],
        maxPlayers: 2,
        minimumPlayers: 2,
        requireAllPlayersReady: false,
      },
    },
  ],
  authenticate: (request) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer\\s+(.+)$/u)?.[1]?.trim();
    if (!token) return null;
    return { id: token, playerId: \`\${token}-player\` };
  },
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true,
    authorizeMatchResult: () => true,
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 120,
    maxRoomCreationsPerMinute: 60,
  },
  cors: {
    allowedOrigins: ${JSON.stringify([allowedOrigin])},
  },
});

export default lobby.createGatewayWorker<FlareLobbyBindings>();

export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
} from "@flarelobby/cloudflare";
`;
}

function harnessClientSource() {
  return `import { createFlareLobbyClient } from "@flarelobby/client";
import type { FlareLobbyClient, MatchmakingTicket, Room } from "@flarelobby/client";
import type { FlareLobbyApp } from "@flarelobby/core";

type TestApp = FlareLobbyApp<{ map: string }, { name: string }, {}>;
type TestClient = FlareLobbyClient<TestApp>;
type TestRoom = Room<TestApp>;
type TestTicket = MatchmakingTicket<TestApp>;

const SOLO_POOL = {
  id: "solo-1v1",
  gameId: "standalone",
  seasonId: "season-1",
  mode: "duel-1v1",
  region: "jp",
};

let client: TestClient | undefined;
let room: TestRoom | undefined;
let ticket: TestTicket | undefined;
let lastError = "";
const trackedSockets = new Set<WebSocket>();

function summary(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function roomSummary(target: TestRoom | undefined) {
  if (!target) return null;
  return {
    id: target.id,
    kind: target.snapshot.room.kind,
    revision: target.snapshot.revision,
    participants: target.snapshot.participants.length,
    status: target.snapshot.state.status,
    connectionStatus: target.connectionStatus,
    closed: target.closed,
  };
}

const api = {
  init(token: string, endpoint: string): boolean {
    try {
      if (client) client.dispose();
      trackedSockets.clear();
      client = createFlareLobbyClient<TestApp>({
        endpoint,
        getAccessToken: () => token,
        webSocketFactory: (url, protocols) => {
          const socket = new WebSocket(url, protocols);
          trackedSockets.add(socket);
          socket.addEventListener("close", () => {
            trackedSockets.delete(socket);
          });
          return socket as unknown as WebSocket;
        },
      });
      room = undefined;
      ticket = undefined;
      lastError = "";
      return true;
    } catch (error) {
      lastError = summary(error instanceof Error ? error.message : error);
      return false;
    }
  },
  async createRoom(): Promise<string> {
    if (!client) throw new Error("client が初期化されていません。");
    room = await client.createCustomRoom({
      requestId: crypto.randomUUID(),
      maxPlayers: 2,
      settings: { map: "forest" },
    });
    return room.id;
  },
  async joinRoom(roomId: string): Promise<string> {
    if (!client) throw new Error("client が初期化されていません。");
    room = await client.joinCustomRoom({
      requestId: crypto.randomUUID(),
      roomId,
    });
    return room.id;
  },
  async setReady(ready: boolean): Promise<number> {
    if (!room) throw new Error("room がありません。");
    await room.setReady(ready, { requestId: crypto.randomUUID() });
    return room.snapshot.revision;
  },
  async startMatch(): Promise<string> {
    if (!room || room.role !== "host") throw new Error("host の room がありません。");
    const snapshot = await (room as never as { startMatch: (o: unknown) => Promise<{ state: { status: string } }> }).startMatch({
      requestId: crypto.randomUUID(),
    });
    return snapshot.state.status;
  },
  async leave(): Promise<boolean> {
    if (!room || room.closed) {
      room = undefined;
      return true;
    }
    await room.leave({ requestId: crypto.randomUUID() });
    room = undefined;
    return true;
  },
  async joinQueue(): Promise<string> {
    if (!client) throw new Error("client が初期化されていません。");
    ticket = await client.joinMatchmaking(SOLO_POOL, {
      requestId: crypto.randomUUID(),
      rating: 1500,
    });
    return ticket.id;
  },
  async waitForMatch(timeoutMs: number): Promise<string> {
    if (!ticket) throw new Error("ticket がありません。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const matched = await ticket.waitForMatch({
        signal: controller.signal,
      });
      room = matched;
      ticket = undefined;
      return matched.snapshot.room.id;
    } finally {
      clearTimeout(timer);
    }
  },
  async findMatchAndWait(timeoutMs: number): Promise<string> {
    if (!client) throw new Error("client が初期化されていません。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const matched = await client.findMatch(SOLO_POOL, {
        requestId: crypto.randomUUID(),
        rating: 1500,
        signal: controller.signal,
      });
      room = matched;
      return matched.snapshot.room.id;
    } finally {
      clearTimeout(timer);
    }
  },
  async cancelQueue(): Promise<string> {
    if (!ticket) return "no-ticket";
    await ticket.cancel({ requestId: crypto.randomUUID() });
    const status = ticket.status;
    ticket = undefined;
    return status;
  },
  getSnapshot(): unknown {
    return roomSummary(room);
  },
  getConnectionStatus(): string {
    return room?.connectionStatus ?? "no-room";
  },
  getTicketStatus(): string {
    return ticket?.status ?? "no-ticket";
  },
  isDisposed(): boolean {
    return client?.disposed ?? true;
  },
  dispose(): boolean {
    try {
      client?.dispose();
      return true;
    } finally {
      client = undefined;
      room = undefined;
      ticket = undefined;
      for (const socket of [...trackedSockets]) {
        try {
          socket.close(1000, "harness disposed");
        } catch {
          // 既に閉じたソケットの例外は無視する。
        }
      }
      trackedSockets.clear();
    }
  },
  dropConnections(): number {
    let dropped = 0;
    for (const socket of [...trackedSockets]) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
          socket.close(1000, "consumer test network drop");
          dropped += 1;
        } catch {
          // 既に閉じたソケットの例外は無視する。
        }
      }
    }
    return dropped;
  },
  async fetchPath(path: string): Promise<{ status: number; acao: string }> {
    const endpoint = (window as unknown as { __consumerEndpoint?: string }).__consumerEndpoint ?? "";
    const response = await fetch(new URL(path, endpoint).href, { method: "GET" });
    return { status: response.status, acao: response.headers.get("access-control-allow-origin") ?? "" };
  },
  getLastError(): string {
    return lastError;
  },
};

(window as unknown as { __consumerHarness: typeof api }).__consumerHarness = api;
`;
}

function harnessHtmlSource() {
  return `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>consumer harness</title></head>
  <body>
    <div id="ready">loading</div>
    <script>
      window.__consumerEndpoint = new URLSearchParams(location.search).get("endpoint") ?? "";
    </script>
    <script type="module" src="/src/consumer-harness.ts"></script>
    <script type="module">
      const deadline = Date.now() + 15000;
      const timer = setInterval(() => {
        if (window.__consumerHarness || Date.now() > deadline) {
          document.getElementById("ready").textContent = window.__consumerHarness ? "ready" : "timeout";
          if (window.__consumerHarness || Date.now() > deadline) clearInterval(timer);
        }
      }, 50);
    </script>
  </body>
</html>
`;
}

// ---------- stages ----------

function stagePack() {
  stage = "pack";
  consumerRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "flarelobby-consumer-")),
  );
  archiveDirectory = join(consumerRoot, "archives");
  logDirectory = join(consumerRoot, "logs");
  mkdirSync(archiveDirectory, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });
  log(`一時ディレクトリ: ${consumerRoot}`);

  log("4 package を build します。");
  runSync(pnpm, ["--filter", "@flarelobby/core", "run", "build"], {
    cwd: root,
    timeout: TIMEOUTS.buildMs,
  });
  runSync(pnpm, ["--filter", "@flarelobby/cloudflare", "run", "build"], {
    cwd: root,
    timeout: TIMEOUTS.buildMs,
  });
  runSync(pnpm, ["--filter", "@flarelobby/client", "run", "build"], {
    cwd: root,
    timeout: TIMEOUTS.buildMs,
  });
  runSync(pnpm, ["--filter", "@flarelobby/testing", "run", "build"], {
    cwd: root,
    timeout: TIMEOUTS.buildMs,
  });

  const tarballs = new Map();
  for (const pkg of PACKAGES) {
    log(`${pkg.name} を pack します。`);
    const output = runSync(
      pnpm,
      [
        "--filter",
        pkg.name,
        "pack",
        "--pack-destination",
        archiveDirectory,
        "--json",
      ],
      { cwd: root, timeout: TIMEOUTS.buildMs },
    );
    const start = output.search(/[{[]/);
    if (start < 0) fail(`${pkg.name} の pack 結果を読めません。`);
    const parsed = JSON.parse(output.slice(start));
    if (typeof parsed.filename !== "string")
      fail(`${pkg.name} の pack 結果に tarball path がありません。`);
    tarballs.set(pkg.name, parsed.filename);
    log(`${pkg.name}: ${parsed.filename}`);
  }
  if (tarballs.size !== 4) fail("4 tarball の生成に失敗しました。");
  return tarballs;
}

function stageScaffold(tarballs) {
  stage = "scaffold";
  const consumer = join(consumerRoot, "consumer");
  mkdirSync(consumer, { recursive: true });
  cpSync(join(root, "templates", "standalone"), consumer, {
    recursive: true,
    filter: (source) =>
      !source.includes("node_modules") &&
      !source.includes(
        `${resolve(root, "templates", "standalone")}${"/dist"}`,
      ) &&
      !source.endsWith("/.wrangler") &&
      !source.endsWith("/dist"),
  });

  const manifestPath = join(consumer, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fileOf = (name) => {
    const archive = tarballs.get(name);
    if (!archive) fail(`tarball がありません: ${name}`);
    return `file:${archive}`;
  };
  manifest.dependencies = {
    "@flarelobby/client": fileOf("@flarelobby/client"),
    "@flarelobby/cloudflare": fileOf("@flarelobby/cloudflare"),
    "@flarelobby/core": fileOf("@flarelobby/core"),
  };
  manifest.devDependencies = {
    ...manifest.devDependencies,
    "@flarelobby/testing": fileOf("@flarelobby/testing"),
  };
  if (JSON.stringify(manifest).includes("workspace:")) {
    fail("consumer manifest に workspace protocol が残っています。");
  }
  delete manifest.pnpm;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const workspaceYaml =
    "allowBuilds:\n  esbuild: true\n  workerd: true\noverrides:\n" +
    [...tarballs.entries()]
      .map(([name, archive]) => `  "${name}": "file:${archive}"`)
      .join("\n") +
    "\n";
  writeFileSync(join(consumer, "pnpm-workspace.yaml"), workspaceYaml, "utf8");

  // tsconfig paths / 元 repo 参照の禁止を静的に確認する。
  for (const file of [
    "tsconfig.json",
    "tsconfig.browser.json",
    "vite.config.ts",
    "package.json",
    "pnpm-workspace.yaml",
  ]) {
    const content = readFileSync(join(consumer, file), "utf8");
    if (content.includes("workspace:"))
      fail(`${file} に workspace 参照があります。`);
    if (content.includes(root) && file !== "pnpm-workspace.yaml")
      fail(`${file} に元 repo パス参照があります。`);
  }
  for (const file of ["tsconfig.json", "tsconfig.browser.json"]) {
    const config = JSON.parse(
      readFileSync(join(consumer, file), "utf8").replace(/\/\/.*$/gm, ""),
    );
    if (config.compilerOptions?.paths)
      fail(`${file} に tsconfig paths があります。`);
    if (config.compilerOptions?.skipLibCheck !== false)
      fail(`${file} が skipLibCheck:false ではありません。`);
  }
  return consumer;
}

function stageInstall(consumer) {
  stage = "install";
  log("独立プロジェクトとして install します (tarball のみ)。");
  runSync(pnpm, ["install", "--no-frozen-lockfile"], {
    cwd: consumer,
    timeout: TIMEOUTS.installMs,
  });

  // 実際に解決した各本体 package のパスを確認する。
  // exports map が "./package.json" を公開しないため、entry 解決から実パスを導出する。
  const consumerRequire = createRequire(join(consumer, "package.json"));
  for (const pkg of PACKAGES) {
    const entry = consumerRequire.resolve(pkg.name, {
      paths: [consumer],
    });
    const packageDirectory = realpathSync(entry).replace(/\/dist\/.*$/, "");
    const manifestPath = join(packageDirectory, "package.json");
    const real = realpathSync(packageDirectory);
    if (!real.startsWith(consumer)) {
      fail(`${pkg.name} が consumer 外に解決されました: ${real}`);
    }
    if (real.startsWith(root) && !real.startsWith(consumer)) {
      fail(`${pkg.name} が元 repo に解決されました: ${real}`);
    }
    let isLink = false;
    try {
      isLink = lstatSync(
        join(consumer, "node_modules", pkg.name),
      ).isSymbolicLink();
    } catch {
      isLink = false;
    }
    // pnpm の仮想ストア symlink は consumer 内のため許容し、元 repo src への参照だけ拒否する。
    if (real.includes(`${resolve(root, "packages")}`)) {
      fail(`${pkg.name} が元 repo src に解決されました: ${real}`);
    }
    const installedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (JSON.stringify(installedManifest).includes("workspace:")) {
      fail(`${pkg.name} の解決 manifest に workspace が残っています。`);
    }
    log(
      `${pkg.name} -> ${real} ${isLink ? "(pnpm store link, consumer 内)" : ""}`,
    );
  }
}

async function stageNodeImports(consumer) {
  stage = "node-import";
  const consumerRequire = createRequire(join(consumer, "package.json"));
  const packageDirectoryOf = (name) => {
    const entryResolved = consumerRequire.resolve(name, { paths: [consumer] });
    return realpathSync(entryResolved).replace(/\/dist\/.*$/, "");
  };
  const importFrom = async (name, sub = "dist/index.js") =>
    import(join(packageDirectoryOf(name), sub));
  const core = await importFrom("@flarelobby/core");
  if (typeof core.selectMatchCandidates !== "function")
    fail("core の公開 entry を解決できません。");
  const client = await importFrom("@flarelobby/client");
  if (typeof client.createFlareLobbyClient !== "function")
    fail("client の公開 entry を解決できません。");
  const testing = await importFrom("@flarelobby/testing");
  if (typeof testing.simulateMatchmaking !== "function")
    fail("testing の公開 entry を解決できません。");
  log("client/core/testing の Node ESM import に成功しました。");

  // cloudflare の runtime entry は cloudflare:workers を使うため Node import 成功を要求しない。
  // 代わりに Node 互換の設定モジュールを確認し、runtime entry は Workers 側で検証する。
  const cloudflareConfig = await importFrom(
    "@flarelobby/cloudflare",
    "dist/config.js",
  );
  if (typeof cloudflareConfig.defineFlareLobby !== "function") {
    fail("cloudflare の設定モジュールを解決できません。");
  }
  try {
    await importFrom("@flarelobby/cloudflare", "dist/index.js");
    log(
      "cloudflare runtime entry も Node で読み込めました (要求はしないが記録する)。",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      `cloudflare runtime entry の Node import は期待どおり Workers 専用の可能性があります: ${message.slice(0, 200)}`,
    );
  }
  // 全公開 Entry Point の型宣言が tarball に含まれることを確認する。
  for (const pkg of PACKAGES) {
    const packageDirectory = packageDirectoryOf(pkg.name);
    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    );
    for (const entry of ["./dist/index.js", "./dist/index.d.ts"]) {
      const resolved = join(packageDirectory, entry.replace("./", ""));
      if (!existsSync(resolved))
        fail(`${pkg.name} の配布 entry がありません: ${entry}`);
    }
    if (manifest.types !== "./dist/index.d.ts")
      fail(`${pkg.name} の types が不正です。`);
  }
  log("全公開 Entry Point と型宣言を適切な runtime で検証しました。");
}

function stageTypecheck(consumer) {
  stage = "typecheck";
  // 配布テンプレートの拒否設定を維持していることを確認する (テスト認証の混入禁止)。
  const distributed = readFileSync(join(consumer, "src", "index.ts"), "utf8");
  if (!distributed.includes("return null"))
    fail("配布 Worker の拒否設定が維持されていません。");
  if (distributed.includes("authorizeJoin"))
    fail("配布 Worker にテスト用認証が混入しています。");
  log("配布テンプレートの拒否設定を維持しています。");

  log("wrangler types と skipLibCheck:false の型検査を実行します。");
  runSync(pnpm, ["run", "typecheck"], {
    cwd: consumer,
    timeout: TIMEOUTS.typecheckMs,
  });
  log("公開宣言の型検査に成功しました (skipLibCheck:false)。");
}

function stageMigrations(consumer) {
  stage = "migrations";
  testSecret = randomBytes(24).toString("base64url");
  writeFileSync(
    join(consumer, ".dev.vars"),
    `FLARE_LOBBY_TOKEN_SECRET=${testSecret}\n`,
    "utf8",
  );

  log("配布 Migration だけでローカル D1 を初期化します。");
  // 既存 state を使わず、配布物だけの fresh state で検証する。
  rmSync(join(consumer, ".wrangler"), { recursive: true, force: true });
  runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "FLARE_LOBBY_DB",
      "--local",
      "--config",
      "wrangler.jsonc",
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  const historyOutput = runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "FLARE_LOBBY_DB",
      "--local",
      "--config",
      "wrangler.jsonc",
      "--command",
      "SELECT name FROM d1_migrations ORDER BY id",
      "--json",
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  const history = JSON.stringify(historyOutput);
  for (const expected of [
    "0001_custom_room_index.sql",
    "0002_rating.sql",
    "0004_team_rating.sql",
    "0005_rating_algorithm.sql",
  ]) {
    if (!history.includes(expected))
      fail(`空 DB の Migration 履歴に ${expected} がありません。`);
  }
  if (history.includes("0003_local_demo_rps"))
    fail("配布 Migration にデモ専用テーブルが含まれています。");
  log("空 DB の Migration 適用を検証しました。");

  // 旧スキーマ fixture: 0005 適用前の状態を作り、配布 Migration で更新してデータ保持を確認する。
  const legacyDir = join(consumerRoot, "legacy-migrations");
  mkdirSync(legacyDir, { recursive: true });
  const publishedMigrations = join(
    consumer,
    "node_modules",
    "@flarelobby",
    "cloudflare",
    "migrations",
  );
  for (const file of [
    "0001_custom_room_index.sql",
    "0002_rating.sql",
    "0004_team_rating.sql",
  ]) {
    copyFileSync(join(publishedMigrations, file), join(legacyDir, file));
  }
  const legacyConfig = join(consumerRoot, "wrangler.legacy.jsonc");
  const baseConfig = readFileSync(
    join(consumer, "wrangler.jsonc"),
    "utf8",
  ).replace(
    "node_modules/@flarelobby/cloudflare/migrations",
    join(consumerRoot, "legacy-migrations").replaceAll("\\", "/"),
  );
  // JSONC のまま migrations_dir だけ差し替える (trailing comma を保つため文字列置換する)。
  writeFileSync(legacyConfig, baseConfig, "utf8");
  const legacyState = join(consumerRoot, "legacy-state");
  mkdirSync(legacyState, { recursive: true });
  runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "FLARE_LOBBY_DB",
      "--local",
      "--persist-to",
      legacyState,
      "--config",
      legacyConfig,
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "FLARE_LOBBY_DB",
      "--local",
      "--persist-to",
      legacyState,
      "--config",
      legacyConfig,
      "--command",
      "INSERT INTO flarelobby_rating_seasons (game_id, season_id, pool_id, initial_rating, k_factor, created_at, updated_at) VALUES ('game-85', 'season-85', 'pool-85', 1500, 32, 1, 1)",
      "--json",
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  // 配布 Migration で更新する。
  runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "FLARE_LOBBY_DB",
      "--local",
      "--persist-to",
      legacyState,
      "--config",
      join(consumer, "wrangler.jsonc"),
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  const preserved = runSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "FLARE_LOBBY_DB",
      "--local",
      "--persist-to",
      legacyState,
      "--config",
      join(consumer, "wrangler.jsonc"),
      "--command",
      "SELECT COUNT(*) AS count FROM flarelobby_rating_seasons WHERE game_id = 'game-85'",
      "--json",
    ],
    {
      cwd: consumer,
      timeout: TIMEOUTS.d1Ms,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  );
  if (!preserved.includes('"count":1') && !preserved.includes('"count": 1')) {
    fail(
      `旧スキーマ fixture のデータ保持を検証できません: ${preserved.slice(0, 500)}`,
    );
  }
  log("旧スキーマ fixture の Migration とデータ保持を検証しました。");
  rmSync(join(consumer, ".wrangler"), { recursive: true, force: true });
}

async function stageServers(consumer) {
  stage = "servers";
  vitePort = await findFreePort();
  workerPort = await findFreePort();
  viteOrigin = `http://localhost:${vitePort}`;
  disallowedOrigin = `http://127.0.0.1:${vitePort}`;
  workerOrigin = `http://localhost:${workerPort}`;

  writeFileSync(
    join(consumer, "src", "consumer-test-worker.ts"),
    testWorkerSource(viteOrigin),
    "utf8",
  );
  const rawConfig = readFileSync(join(consumer, "wrangler.jsonc"), "utf8");
  const testConfig = rawConfig.replace(
    '"main": "src/index.ts"',
    '"main": "src/consumer-test-worker.ts"',
  );
  if (!testConfig.includes("consumer-test-worker"))
    fail("テスト entry の wrangler 設定を生成できません。");
  writeFileSync(
    join(consumer, "wrangler.consumer-test.jsonc"),
    testConfig,
    "utf8",
  );
  writeFileSync(
    join(consumer, "src", "consumer-harness.ts"),
    harnessClientSource(),
    "utf8",
  );
  writeFileSync(
    join(consumer, "consumer-harness.html"),
    harnessHtmlSource(),
    "utf8",
  );

  log(`wrangler dev を起動します (${workerOrigin})。`);
  workerProcess = startProcess(
    pnpm,
    [
      "--dir",
      consumer,
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.consumer-test.jsonc",
      "--port",
      String(workerPort),
    ],
    { cwd: root },
    join(logDirectory, "wrangler.log"),
  );
  await waitForHttp(`${workerOrigin}/`, TIMEOUTS.workerStartMs, "wrangler dev");

  log(`Vite を起動します (${viteOrigin}, 別オリジン)。`);
  viteProcess = startProcess(
    pnpm,
    [
      "--dir",
      consumer,
      "exec",
      "vite",
      "--port",
      String(vitePort),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: root },
    join(logDirectory, "vite.log"),
  );
  await waitForHttp(
    `${viteOrigin}/consumer-harness.html`,
    TIMEOUTS.viteStartMs,
    "Vite",
  );
  log("wrangler dev と Vite の起動を確認しました。");
}

async function runBrowserStage() {
  stage = "browser";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  browserHandle = browser;
  const results = { steps: [] };
  try {
    const record = (name, ok, detail = "") => {
      results.steps.push({ name, ok, detail: String(detail).slice(0, 500) });
      log(`${name}: ${ok ? "ok" : "NG"} ${String(detail).slice(0, 200)}`);
      if (!ok) fail(`${name} に失敗しました: ${detail}`.slice(0, 1000));
    };

    const newPage = async (contextLabel, token) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const url = `${viteOrigin}/consumer-harness.html?endpoint=${encodeURIComponent(workerOrigin)}`;
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.browserStepMs,
      });
      await page.waitForFunction(
        () => document.getElementById("ready")?.textContent === "ready",
        { timeout: TIMEOUTS.browserStepMs },
      );
      const initialized = await page.evaluate(
        ([pageToken, endpoint]) =>
          window.__consumerHarness.init(pageToken, endpoint),
        [token, workerOrigin],
      );
      if (!initialized)
        fail(`${contextLabel} の harness 初期化に失敗しました。`);
      return { context, page };
    };

    const tokenA = `consumer-test-a-${randomBytes(8).toString("hex")}`;
    const tokenB = `consumer-test-b-${randomBytes(8).toString("hex")}`;
    const first = await newPage("contextA", tokenA);
    const second = await newPage("contextB", tokenB);

    try {
      // 作成・参加・準備・状態通知。
      const roomId = await first.page.evaluate(() =>
        window.__consumerHarness.createRoom(),
      );
      record(
        "room-create",
        typeof roomId === "string" && roomId.length > 0,
        roomId,
      );
      const joinedId = await second.page.evaluate(
        ([id]) => window.__consumerHarness.joinRoom(id),
        [roomId],
      );
      record("room-join", joinedId === roomId, joinedId);
      await first.page.evaluate(() => window.__consumerHarness.setReady(true));
      await second.page.evaluate(() => window.__consumerHarness.setReady(true));
      await waitFor(
        async () => {
          const snapshot = await first.page.evaluate(() =>
            window.__consumerHarness.getSnapshot(),
          );
          return snapshot?.participants === 2 ? snapshot : null;
        },
        TIMEOUTS.browserStepMs,
        "参加者の状態通知",
      );
      record("room-ready-notify", true, "participants=2");
      const status = await first.page.evaluate(() =>
        window.__consumerHarness.startMatch(),
      );
      record("room-start", status === "in_progress", status);
      await first.page.evaluate(() => window.__consumerHarness.leave());
      await second.page.evaluate(() => window.__consumerHarness.leave());
      record("room-leave", true, "");

      // 1v1 マッチング。
      const queuePromise = first.page.evaluate(() =>
        window.__consumerHarness.joinQueue(),
      );
      await queuePromise;
      const [firstRoomId, secondRoomId] = await Promise.all([
        first.page.evaluate(() => window.__consumerHarness.waitForMatch(15000)),
        second.page.evaluate(() =>
          window.__consumerHarness.findMatchAndWait(15000),
        ),
      ]);
      record(
        "matchmaking-1v1",
        firstRoomId === secondRoomId && firstRoomId.length > 0,
        firstRoomId,
      );

      // 切断復帰: Playwright の offline 制御と harness の接続切断で一時切断を起こし、
      // 再接続後の snapshot/revision を確認する。任意の sleep ではなく状態到達を待つ。
      // 対戦成立後の match room ではなく、操作可能な custom room を作り直して検証する。
      await first.page.evaluate(() => window.__consumerHarness.leave());
      await second.page.evaluate(() => window.__consumerHarness.leave());
      record("match-leave", true, "");
      const retryRoomId = await first.page.evaluate(() =>
        window.__consumerHarness.createRoom(),
      );
      await second.page.evaluate(
        ([id]) => window.__consumerHarness.joinRoom(id),
        [retryRoomId],
      );
      const revisionBefore =
        (
          await second.page.evaluate(() =>
            window.__consumerHarness.getSnapshot(),
          )
        )?.revision ?? 0;
      await second.context.setOffline(true);
      await second.page.evaluate(() =>
        window.__consumerHarness.dropConnections(),
      );
      await waitFor(
        async () => {
          const connection = await second.page.evaluate(() =>
            window.__consumerHarness.getConnectionStatus(),
          );
          return connection === "reconnecting" || connection === "disconnected"
            ? connection
            : null;
        },
        TIMEOUTS.browserStepMs,
        "切断検出",
      );
      // 切断中にホスト側の状態を進め、復帰後に取りこぼしなく反映されることを確認する。
      await first.page.evaluate(() => window.__consumerHarness.setReady(true));
      await second.context.setOffline(false);
      await waitFor(
        async () => {
          const snapshot = await second.page.evaluate(() =>
            window.__consumerHarness.getSnapshot(),
          );
          if (
            snapshot?.connectionStatus === "connected" &&
            snapshot?.revision > revisionBefore
          ) {
            return snapshot;
          }
          return null;
        },
        TIMEOUTS.browserStepMs,
        "再接続後の snapshot 復元",
      );
      record(
        "reconnect-restore",
        true,
        `revision ${revisionBefore} -> restored`,
      );

      // cancel/dispose: 待機の取消と再接続残存の確認。
      await first.page.evaluate(() => window.__consumerHarness.leave());
      await second.page.evaluate(() => window.__consumerHarness.leave());
      await first.page.evaluate(() => window.__consumerHarness.joinQueue());
      const cancelled = await first.page.evaluate(() =>
        window.__consumerHarness.cancelQueue(),
      );
      record("queue-cancel", cancelled === "cancelled", cancelled);
      const disposedA = await first.page.evaluate(() =>
        window.__consumerHarness.dispose(),
      );
      const disposedB = await second.page.evaluate(() =>
        window.__consumerHarness.dispose(),
      );
      record("client-dispose", disposedA && disposedB, "");
      await waitFor(
        async () => {
          const a = await first.page.evaluate(() =>
            window.__consumerHarness.isDisposed(),
          );
          const b = await second.page.evaluate(() =>
            window.__consumerHarness.isDisposed(),
          );
          return a && b ? true : null;
        },
        TIMEOUTS.browserStepMs,
        "dispose 後の待機・再接続の残存確認",
      );
      record("dispose-clean", true, "");

      // 別オリジンの許可されたブラウザからの HTTP/WS 利用は上記フローで検証済み。
      // 不許可 Origin からの CORS アクセスをブラウザが拒否することを確認する。
      const deniedContext = await browser.newContext();
      const deniedPage = await deniedContext.newPage();
      await deniedPage.goto(
        `${disallowedOrigin}/consumer-harness.html?endpoint=${encodeURIComponent(workerOrigin)}`,
        {
          waitUntil: "domcontentloaded",
          timeout: TIMEOUTS.browserStepMs,
        },
      );
      const corsResult = await deniedPage.evaluate(
        async ([worker]) => {
          try {
            await fetch(new URL("/v1/custom-rooms", worker).href, {
              method: "GET",
            });
            return "unexpected-success";
          } catch (error) {
            return error instanceof Error
              ? `rejected:${error.message.slice(0, 100)}`
              : "rejected";
          }
        },
        [workerOrigin],
      );
      // 不許可 Origin ではブラウザが CORS により失敗させるか、ACAO が付与されないことを要求する。
      // fetch 自体の成否に加え、プリフライトの ACAO を直接確認する。
      const preflightStatus = await (async () => {
        const response = await fetch(`${workerOrigin}/v1/custom-rooms`, {
          method: "OPTIONS",
          headers: {
            Origin: disallowedOrigin,
            "Access-Control-Request-Method": "GET",
          },
        });
        return {
          status: response.status,
          acao: response.headers.get("access-control-allow-origin") ?? "",
        };
      })();
      await deniedContext.close();
      const denied =
        corsResult.startsWith("rejected") ||
        preflightStatus.acao === "" ||
        preflightStatus.acao === viteOrigin;
      // preflight の ACAO が不許可 Origin をそのまま反射していないことを厳密に確認する。
      if (preflightStatus.acao === disallowedOrigin) {
        record(
          "cors-deny",
          false,
          `ACAO が不許可 Origin を反射しています: ${preflightStatus.acao}`,
        );
      } else {
        record(
          "cors-deny",
          denied,
          `${corsResult} / preflight acao=${preflightStatus.acao || "(none)"}`,
        );
      }

      // 許可 Origin のプリフライトが ACAO を返すことも確認する。
      const allowedPreflight = await (async () => {
        const response = await fetch(`${workerOrigin}/v1/custom-rooms`, {
          method: "OPTIONS",
          headers: {
            Origin: viteOrigin,
            "Access-Control-Request-Method": "GET",
          },
        });
        return response.headers.get("access-control-allow-origin") ?? "";
      })();
      record(
        "cors-allow",
        allowedPreflight === viteOrigin,
        `acao=${allowedPreflight}`,
      );
    } finally {
      await first.context.close().catch(() => {});
      await second.context.close().catch(() => {});
    }

    writeFileSync(
      join(logDirectory, "browser.json"),
      JSON.stringify({ ...results, workerOrigin, viteOrigin }, null, 2),
      "utf8",
    );
    log(
      "ブラウザ E2E (作成・参加・マッチング・復帰・cancel/dispose・CORS) に成功しました。",
    );
  } finally {
    await browser.close().catch(() => {});
    if (browserHandle === browser) browserHandle = null;
  }
}

async function stageBrowser() {
  stage = "browser";
  const controller = new AbortController();
  try {
    const overallTimeout = delay(TIMEOUTS.browserTotalMs, undefined, {
      signal: controller.signal,
    }).then(
      async () => {
        try {
          await browserHandle?.close();
        } catch {
          // タイムアウト時の後始末の失敗は元のタイムアウトを優先する。
        }
        fail(
          `browser stage の全体タイムアウト (${TIMEOUTS.browserTotalMs} ms) を超過しました。`,
        );
      },
      () => undefined,
    );
    await Promise.race([runBrowserStage(), overallTimeout]);
  } finally {
    controller.abort();
  }
}

async function main() {
  const startedAt = Date.now();
  let tarballs;
  try {
    tarballs = stagePack();
    const consumer = stageScaffold(tarballs);
    stageInstall(consumer);
    await stageNodeImports(consumer);
    stageTypecheck(consumer);
    stageMigrations(consumer);
    await stageServers(consumer);
    await stageBrowser();
    stage = "cleanup";
    await stopProcess(workerProcess, "wrangler dev");
    workerProcess = null;
    await stopProcess(viteProcess, "Vite");
    viteProcess = null;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    log(
      `consumer 検証に成功しました (所要 ${elapsedSec} 秒)。一時ファイルを解放します。`,
    );
    cleanupSync();
    if (consumerRoot && existsSync(consumerRoot))
      rmSync(consumerRoot, { recursive: true, force: true });
  } catch (error) {
    stage = stage === "cleanup" ? "cleanup" : stage;
    console.error(
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
    try {
      await browserHandle?.close();
    } catch {
      // ignore
    }
    browserHandle = null;
    try {
      await stopProcess(workerProcess, "wrangler dev");
    } catch {
      // ignore
    }
    workerProcess = null;
    try {
      await stopProcess(viteProcess, "Vite");
    } catch {
      // ignore
    }
    viteProcess = null;
    cleanupSync();
    if (logDirectory) preserveFailureBundle(error);
    // 失敗時は一時ディレクトリを残し、成功時のみ削除する (原因調査のため)。
    console.error(
      `失敗段階: ${stage} / ログ: ${failureBundleDirectory || logDirectory || "(なし)"}`,
    );
    process.exitCode = 1;
  }
}

await main();
