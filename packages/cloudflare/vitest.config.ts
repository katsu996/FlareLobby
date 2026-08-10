import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testTokenSecret = "flarelobby-test-token-secret";

// Wrangler の required secrets 検証と Miniflare の両方へ、テスト専用値を渡す。
process.env["FLARE_LOBBY_TOKEN_SECRET"] ??= testTokenSecret;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc"
      },
      miniflare: {
        bindings: {
          // テスト専用値。実環境では Wrangler Secret から注入する。
          FLARE_LOBBY_TOKEN_SECRET: testTokenSecret
        }
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
