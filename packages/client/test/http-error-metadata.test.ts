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

  it("状態コードのみの応答も requestId と httpStatus を保持する", async () => {
    const cases = [
      { status: 400, code: "INVALID_PAYLOAD" },
      { status: 422, code: "INVALID_PAYLOAD" },
      { status: 401, code: "UNAUTHENTICATED" },
      { status: 403, code: "FORBIDDEN" },
      { status: 409, code: "CONFLICT" },
      { status: 500, code: "CONNECTION_FAILED" },
    ] as const;

    for (const { status, code } of cases) {
      const error = await readRequestError(
        async () =>
          new Response("{}", {
            status,
            headers: { "Retry-After": "5" },
          }),
        { requestId: `request-fallback-${status}` },
      );

      expect(error.code, `status ${status}`).toBe(code);
      expect(error.requestId, `status ${status}`).toBe(
        `request-fallback-${status}`,
      );
      expect(error.httpStatus, `status ${status}`).toBe(status);
      expect(error.retryAfterSeconds, `status ${status}`).toBe(5);
    }
  });

  it("RFC 850 と asctime 形式の HTTP 日時も解釈する", async () => {
    // 1994-11-06T08:49:37Z を各形式で表す。now をその 12 秒前に固定する。
    // RFC 850 は GMT を含むため UTC で一意に解釈できる。
    const now = Date.parse("1994-11-06T08:49:25.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const rfc850 = await readRequestError(async () =>
      Response.json(
        {
          code: "CONFLICT",
          message: "要求が許可された頻度を超えています。",
        },
        {
          status: 429,
          headers: { "Retry-After": "Sunday, 06-Nov-94 08:49:37 GMT" },
        },
      ),
    );
    expect(rfc850.retryAfterSeconds).toBe(12);
    expect(rfc850.httpStatus).toBe(429);

    // asctime はタイムゾーンを含まず実行環境の解釈に依存するため、
    // 秒数の一致までは断定せず HTTP 日時として採用されることだけを確認する。
    const asctime = await readRequestError(async () =>
      Response.json(
        {
          code: "CONFLICT",
          message: "要求が許可された頻度を超えています。",
        },
        {
          status: 429,
          headers: { "Retry-After": "Sun Nov  6 08:49:37 1994" },
        },
      ),
    );
    expect(asctime.httpStatus).toBe(429);
    expect(asctime.retryAfterSeconds).toBeDefined();
  });

  it("HTTP日時形式でも解析不能な日時は無視する", async () => {
    const error = await readRequestError(async () =>
      Response.json(
        {
          code: "CONFLICT",
          message: "要求が許可された頻度を超えています。",
        },
        {
          status: 429,
          headers: { "Retry-After": "Sun, 99 Foo 9999 99:99:99 GMT" },
        },
      ),
    );

    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("ヘッダー読み取り失敗や欠落は Retry-After なしとして扱う", async () => {
    const throwingHeaders = await readRequestError(
      async () =>
        ({
          ok: false,
          status: 503,
          headers: {
            get: () => {
              throw new Error("headers broken");
            },
          },
          text: () => Promise.resolve("{}"),
        }) as unknown as Response,
    );
    expect(throwingHeaders.httpStatus).toBe(503);
    expect(throwingHeaders.retryAfterSeconds).toBeUndefined();

    const nullHeaders = await readRequestError(
      async () =>
        ({
          ok: false,
          status: 503,
          headers: null,
          text: () => Promise.resolve("{}"),
        }) as unknown as Response,
    );
    expect(nullHeaders.httpStatus).toBe(503);
    expect(nullHeaders.retryAfterSeconds).toBeUndefined();
  });

  it("本文不正の HTTP エラーも requestId を保持する", async () => {
    const error = await readRequestError(
      async () =>
        new Response("not-json{{", {
          status: 500,
          headers: { "Retry-After": "7" },
        }),
      { requestId: "request-broken-1" },
    );

    expect(error.code).toBe("INVALID_MESSAGE");
    expect(error.requestId).toBe("request-broken-1");
    expect(error.httpStatus).toBe(500);
    expect(error.retryAfterSeconds).toBe(7);
  });
});
