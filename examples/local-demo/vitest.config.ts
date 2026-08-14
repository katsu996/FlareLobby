import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testTokenSecret = "flarelobby-local-demo-test-secret";

process.env["FLARE_LOBBY_TOKEN_SECRET"] ??= testTokenSecret;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        fileURLToPath(new URL("../../packages/cloudflare/migrations", import.meta.url))
      );

      return {
        wrangler: {
          configPath: "./wrangler.jsonc"
        },
        miniflare: {
          bindings: {
            FLARE_LOBBY_TOKEN_SECRET: testTokenSecret,
            TEST_MIGRATIONS: migrations
          }
        }
      };
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"]
    },
    setupFiles: ["../../packages/cloudflare/test/apply-migrations.ts"]
  }
});
