import { describe, expect, it } from "vitest";

import {
  FLARE_LOBBY_CORRELATION_ID_HEADER,
  attachObservabilityHeaders,
  createObservabilityContext,
  createObservabilitySink,
  getObservabilityOperationName,
  observeOperation,
  readObservabilityContext,
} from "../src/index.js";
import type {
  FlareLobbyObservabilitySink,
  FlareLobbyStructuredLogger,
} from "../src/index.js";

interface RecordedPoint {
  readonly indexes?: readonly (string | ArrayBuffer | null)[];
  readonly doubles?: readonly number[];
  readonly blobs?: readonly (string | ArrayBuffer | null)[];
}

function createRecordingSink(
  points: RecordedPoint[],
  lines: string[],
  configuration: {
    readonly logSampleRate?: number;
    readonly analyticsSampleRate?: number;
  } = {},
): FlareLobbyObservabilitySink {
  const analytics = {
    writeDataPoint(point?: RecordedPoint): void {
      if (point !== undefined) {
        points.push(point);
      }
    },
  } as unknown as AnalyticsEngineDataset;
  const logger: FlareLobbyStructuredLogger = {
    log: (...values: readonly unknown[]) => {
      lines.push(String(values[0]));
    },
  };

  return createObservabilitySink(analytics, configuration, logger);
}

describe("観測基盤", () => {
  it("相関 ID と要求 ID を内部ヘッダーへ渡し、構造化ログへ記録する", () => {
    const context = createObservabilityContext(undefined, {
      correlationId: "correlation-1",
      requestId: "request-1",
      sampled: true,
      analyticsSampled: true,
    });
    const request = attachObservabilityHeaders(
      new Request("https://example.test/v1/custom-rooms"),
      context,
    );
    const restored = readObservabilityContext(request);

    expect(restored).toEqual(context);
    expect(request.headers.get(FLARE_LOBBY_CORRELATION_ID_HEADER)).toBe(
      "correlation-1",
    );
  });

  it("動的なカスタムルーム操作を安定した操作名へ分類する", () => {
    expect(
      getObservabilityOperationName(
        new Request("https://example.test/v1/custom-rooms/room-1/join", {
          method: "POST",
        }),
      ),
    ).toBe("room.join");
    expect(
      getObservabilityOperationName(
        new Request("https://example.test/v1/custom-rooms/room-1/ws", {
          method: "GET",
        }),
      ),
    ).toBe("room.connect");
  });

  it("秘密値・ゲームメッセージ本文を許可属性から除外し、品質メトリクスを記録する", () => {
    const points: RecordedPoint[] = [];
    const lines: string[] = [];
    const sink = createRecordingSink(points, lines);
    const context = createObservabilityContext(undefined, {
      correlationId: "correlation-2",
      requestId: "request-2",
      sampled: true,
      analyticsSampled: true,
    });

    sink.log({
      context,
      operation: "room.connect",
      startedAt: Date.now() - 12,
      result: "failure",
      errorCode: "FORBIDDEN",
      attributes: {
        roomKind: "custom",
        password: "secret-password",
        joinToken: "secret-token",
        messageBody: "ゲームメッセージ本文",
      } as unknown as Readonly<Record<string, string>>,
    });
    sink.metric({
      context,
      name: "match_wait_time_ms",
      value: 1250,
      operation: "matchmaking.match",
      result: "success",
      attributes: { waitTimeMs: 1250 },
    });

    const output = lines.join("\n") + JSON.stringify(points);
    expect(output).toContain("room.connect");
    expect(output).toContain("FORBIDDEN");
    expect(output).toContain("1250");
    expect(output).not.toContain("secret-password");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("ゲームメッセージ本文");
    expect(points).toHaveLength(1);
    expect(points[0]?.indexes).toContain("match_wait_time_ms");
  });

  it("観測先の書込み失敗で主要処理を失敗させない", async () => {
    const logger: FlareLobbyStructuredLogger = { log: () => undefined };
    let writeAttempts = 0;
    const analytics = {
      writeDataPoint: () => {
        writeAttempts += 1;
        throw new Error("analytics unavailable");
      },
    } as unknown as AnalyticsEngineDataset;
    const sink = createObservabilitySink(
      analytics,
      { analyticsSampleRate: 1 },
      logger,
    );
    const context = createObservabilityContext(undefined, {
      correlationId: "correlation-3",
      requestId: "request-3",
      analyticsSampled: true,
    });

    await expect(
      observeOperation(sink, context, "matchmaking.match", async () => "ok"),
    ).resolves.toBe("ok");

    expect(() =>
      sink.metric({
        context,
        name: "match_succeeded",
        value: 1,
        operation: "matchmaking.match",
      }),
    ).not.toThrow();
    expect(writeAttempts).toBe(1);
  });

  it("ログのサンプリング無効時も失敗操作は構造化記録される", async () => {
    const lines: string[] = [];
    const logger: FlareLobbyStructuredLogger = {
      log: (...values: readonly unknown[]) => {
        lines.push(String(values[0]));
      },
    };
    const sink = createObservabilitySink(
      undefined,
      { logSampleRate: 0 },
      logger,
    );
    const context = createObservabilityContext(undefined, {
      correlationId: "correlation-4",
      requestId: "request-4",
      sampled: false,
      analyticsSampled: false,
    });

    await expect(
      observeOperation(sink, context, "matchmaking.match", async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as {
      result: string;
      level: string;
    };
    expect(record.result).toBe("failure");
    expect(record.level).toBe("error");
  });
});
