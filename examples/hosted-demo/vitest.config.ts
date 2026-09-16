import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testTokenSecret = "flarelobby-hosted-demo-test-secret";
// JWKS 取得を即時失敗させ、外部 network なしで拒否系を確定させます。
const testSupabaseUrl = "https://127.0.0.1:1";

process.env["FLARE_LOBBY_TOKEN_SECRET"] ??= testTokenSecret;

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@flarelobby/cloudflare",
        replacement: fileURLToPath(
          new URL("../../packages/cloudflare/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@flarelobby/core",
        replacement: fileURLToPath(
          new URL("../../packages/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@flarelobby/client",
        replacement: fileURLToPath(
          new URL("../../packages/client/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
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
            FLARE_LOBBY_TOKEN_SECRET: testTokenSecret,
            SUPABASE_URL: testSupabaseUrl,
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
    setupFiles: ["../../packages/cloudflare/test/apply-migrations.ts"],
  },
});
