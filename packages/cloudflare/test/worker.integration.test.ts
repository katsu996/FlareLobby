import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { MatchPoolDurableObject, RoomDurableObject } from "../src/index.js";

describe("Cloudflare Worker の設定基盤", () => {
  it("Analytics Engine がなくても最小 Gateway Worker を起動できる", async () => {
    const response = await SELF.fetch("https://example.test/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("D1 Binding を Miniflare 上で解決できる", async () => {
    const row = await env.FLARE_LOBBY_DB.prepare("SELECT 1 AS value").first<{
      value: number;
    }>();

    expect(row?.value).toBe(1);
  });

  it("Room と Match Pool の SQLite-backed Durable Object Binding を解決できる", async () => {
    const roomStub = env.FLARE_LOBBY_ROOMS.getByName("room-integration-test");
    const poolStub = env.FLARE_LOBBY_MATCH_POOLS.getByName(
      "pool-integration-test",
    );

    await runInDurableObject(roomStub, (instance, state) => {
      expect(instance).toBeInstanceOf(RoomDurableObject);
      expect(state.storage.sql).toBeDefined();
    });
    await runInDurableObject(poolStub, (instance, state) => {
      expect(instance).toBeInstanceOf(MatchPoolDurableObject);
      expect(state.storage.sql).toBeDefined();
    });
  });
});
