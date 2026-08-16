import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testTokenSecret = "flarelobby-test-token-secret";

// Wrangler の required secrets 検証と Miniflare の両方へ、テスト専用値を渡す。
process.env["FLARE_LOBBY_TOKEN_SECRET"] ??= testTokenSecret;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        fileURLToPath(new URL("./migrations", import.meta.url)),
      );

      return {
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          bindings: {
            // テスト専用値。実環境では Wrangler Secret から注入する。
            FLARE_LOBBY_TOKEN_SECRET: testTokenSecret,
            // D1 migration は各テストファイルの開始時に setup から適用する。
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
