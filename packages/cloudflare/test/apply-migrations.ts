import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";

interface TestEnv extends Env {
  readonly TEST_MIGRATIONS: D1Migration[];
}

beforeAll(async () => {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.FLARE_LOBBY_DB, testEnv.TEST_MIGRATIONS);
});
