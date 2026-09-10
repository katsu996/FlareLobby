import { afterEach, describe, expect, it, vi } from "vitest";

import { FlareLobbyError } from "@flarelobby/core";

import {
  createFlareLobbyClient,
  type FetchImplementation,
} from "../src/index.js";

function createClient(fetchImplementation: FetchImplementation) {
  return createFlareLobbyClient({
    endpoint: "https://example.test",
    getAccessToken: () => "secret-token",
    fetch: fetchImplementation,
  });
}

async function readRequestError(
  fetchImplementation: FetchImplementation,
  options?: { readonly requestId?: string },
): Promise<FlareLobbyError> {
  const client = createClient(fetchImplementation);
  try {
    if (options?.requestId !== undefined) {
      await client.request("/v1/rooms", { requestId: options.requestId });
    } else {
      await client.request("/v1/rooms");
    }
    throw new Error("要求が失敗することを期待しました。");
  } catch (error) {
    expect(error).toBeInstanceOf(FlareLobbyError);
    return error as FlareLobbyError;
  }
}

describe("HTTP エラーの status と Retry-After 保持", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常な 429 で code・httpStatus・retryAfterSeconds を取得できる", async () => {
    const error = await readRequestError(async () =>
      Response.json(
        { code: "CONFLICT", message: "要求が許可された頻度を超えています。" },
        { status: 429, headers: { "Retry-After": "12" } },
      ),
    );

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("要求が許可された頻度を超えています。");
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it("秒数・日時・欠落・不正値を表形式で解釈する", async () => {
    const now = Date.parse("2026-09-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const futureHttpDate = new Date(now + 12_000).toUTCString();
    const pastHttpDate = new Date(now - 10_000).toUTCString();
    const futureIso = new Date(now + 12_000).toISOString();

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly header: string | null;
      readonly expected: number | undefined;
    }> = [
      { name: "整数秒", header: "12", expected: 12 },
      { name: "前後空白", header: "  12  ", expected: 12 },
      { name: "ゼロ秒", header: "0", expected: 0 },
      { name: "未来日時", header: futureHttpDate, expected: 12 },
      { name: "過去日時は0", header: pastHttpDate, expected: 0 },
      { name: "欠落", header: null, expected: undefined },
      { name: "負数", header: "-1", expected: undefined },
      { name: "小数", header: "12.5", expected: undefined },
      { name: "非数値", header: "soon", expected: undefined },
      { name: "NaN", header: "NaN", expected: undefined },
      { name: "Infinity", header: "Infinity", expected: undefined },
      { name: "空文字", header: "", expected: undefined },
      { name: "空白のみ", header: "   ", expected: undefined },
      { name: "不正日時", header: "not a date", expected: undefined },
      {
        name: "HTTP日時でないISO文字列は採用しない",
        header: futureIso,
        expected: undefined,
      },
      {
        name: "極端に大きい値",
        header: "99999999999999999999999",
        expected: undefined,
      },
    ];

    for (const { name, header, expected } of cases) {
      const error = await readRequestError(async () =>
        Response.json(
          {
            code: "CONFLICT",
            message: "要求が許可された頻度を超えています。",
          },
          {
            status: 429,
            ...(header === null ? {} : { headers: { "Retry-After": header } }),
          },
        ),
      );

      expect(error.httpStatus, name).toBe(429);
      expect(error.retryAfterSeconds, name).toBe(expected);
      expect(error.code, name).toBe("CONFLICT");
    }
  });

  it("429 以外の 503 でも有効な Retry-After を保持する", async () => {
    const error = await readRequestError(async () =>
      Response.json(
        { code: "CONNECTION_FAILED", message: "通信接続に失敗しました。" },
        { status: 503, headers: { "Retry-After": "30" } },
      ),
    );

    expect(error.code).toBe("CONNECTION_FAILED");
    expect(error.httpStatus).toBe(503);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("非JSON・空・壊れたJSON の HTTP エラーも httpStatus を保持する", async () => {
    const nonJson = await readRequestError(
      async () =>
        new Response("not-json{{", {
          status: 500,
          headers: { "Retry-After": "7" },
        }),
    );
    expect(nonJson.httpStatus).toBe(500);
    expect(nonJson.retryAfterSeconds).toBe(7);
    expect(nonJson.code).toBe("INVALID_MESSAGE");

    const empty = await readRequestError(
      async () => new Response("", { status: 503 }),
    );
    expect(empty.httpStatus).toBe(503);
    expect(empty.retryAfterSeconds).toBeUndefined();
    expect(empty.code).toBe("CONNECTION_FAILED");

    const brokenText = await readRequestError(
      async () =>
        ({
          ok: false,
          status: 503,
          text: () => Promise.reject(new Error("stream broken")),
        }) as unknown as Response,
    );
    expect(brokenText.httpStatus).toBe(503);
    expect(brokenText.code).toBe("CONNECTION_FAILED");

    const nullJson = await readRequestError(
      async () => new Response("null", { status: 400 }),
    );
    expect(nullJson.httpStatus).toBe(400);
    expect(nullJson.code).toBe("INVALID_PAYLOAD");
  });

  it("ネットワーク失敗には httpStatus を捏造しない", async () => {
    const transportError = await readRequestError(async () => {
      throw new Error("network down");
    });
    expect(transportError.code).toBe("CONNECTION_FAILED");
    expect(transportError.httpStatus).toBeUndefined();
    expect(transportError.retryAfterSeconds).toBeUndefined();
  });

  it("requestId と既存 code/message を維持する", async () => {
    const error = await readRequestError(
      async () =>
        Response.json(
          { code: "CONFLICT", message: "要求が許可された頻度を超えています。" },
          { status: 429, headers: { "Retry-After": "12" } },
        ),
      { requestId: "request-keep-1" },
    );

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("要求が許可された頻度を超えています。");
    expect(error.requestId).toBe("request-keep-1");
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
  });
});
