import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const outputDirectory = mkdtempSync(
  join(tmpdir(), "flarelobby-deploy-dry-run-"),
);
const commandEnvironment = {
  ...process.env,
  CI: "1",
  NO_UPDATE_NOTIFIER: "1",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: join(outputDirectory, "wrangler.log"),
};

function run(arguments_) {
  const result = spawnSync(pnpm, arguments_, {
    cwd: root,
    encoding: "utf8",
    env: commandEnvironment,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${pnpm} ${arguments_.join(" ")} が失敗しました:\n${result.stdout}${result.stderr}`,
    );
  }
  if (result.stderr.trim() !== "") process.stderr.write(result.stderr);
  return result.stdout;
}

try {
  const deployOutput = run([
    "--filter",
    "@flarelobby/cloudflare",
    "exec",
    "wrangler",
    "deploy",
    "--dry-run",
    "--config",
    "wrangler.jsonc",
    "--outdir",
    outputDirectory,
  ]);

  const bundlePath = join(outputDirectory, "index.js");
  if (!existsSync(bundlePath) || statSync(bundlePath).size === 0) {
    throw new Error(
      "Wrangler dry-run の Worker bundle が生成されませんでした。",
    );
  }

  for (const requiredText of [
    "--dry-run: exiting now.",
    "FLARE_LOBBY_ROOMS",
    "FLARE_LOBBY_MATCH_POOLS",
    "FLARE_LOBBY_RATE_LIMITS",
    "FLARE_LOBBY_DB",
  ]) {
    if (!deployOutput.includes(requiredText)) {
      throw new Error(
        `Wrangler dry-run の出力に必要な確認項目がありません: ${requiredText}`,
      );
    }
  }

  console.log(deployOutput.trim());
  console.log(
    `クリーンな一時ディレクトリで Cloudflare deploy dry-run に成功しました ` +
      `(${statSync(bundlePath).size} bytes)。`,
  );
} catch (error) {
  console.error("Cloudflare deploy dry-run に失敗しました。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
