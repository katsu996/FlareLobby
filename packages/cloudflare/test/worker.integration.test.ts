import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Cloudflare Worker の基盤", () => {
  it("Workers 実行環境で最小ハンドラーを実行できる", async () => {
    const response = await SELF.fetch("https://example.test/");

    expect(response.status).toBe(501);
    await expect(response.text()).resolves.toBe("FlareLobby の基盤を初期化中です。");
  });
});
