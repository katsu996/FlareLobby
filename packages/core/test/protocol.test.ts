import { describe, expect, it, vi } from "vitest";

import {
  FLARE_LOBBY_ERROR_CODES,
  FlareLobbyError,
  PROTOCOL_VERSION,
  classifyEventRevision,
  decodeClientCommand,
  decodeProtocolMessage,
  decodeServerMessage,
  encodeProtocolMessage,
  isDuplicateRequest,
  validateProtocolMessage,
} from "../src/index.js";
import type {
  ClientCommandEnvelope,
  ProtocolMessage,
  ProtocolResult,
} from "../src/index.js";

function expectProtocolValue<TValue>(result: ProtocolResult<TValue>): TValue {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectProtocolError<TValue>(
  result: ProtocolResult<TValue>,
  code: FlareLobbyError["code"],
): FlareLobbyError {
  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error("通信処理が失敗することを期待しました。");
  }

  expect(result.error).toBeInstanceOf(FlareLobbyError);
  expect(result.error.code).toBe(code);
  return result.error;
}

describe("JSON 通信プロトコル v1", () => {
  const command: ClientCommandEnvelope<"room.set_ready", { ready: boolean }> = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    requestId: "request-1",
    command: "room.set_ready",
    payload: {
      ready: true,
    },
  };

  it("コマンド、成功、失敗、イベントを往復変換する", () => {
    const messages: readonly ProtocolMessage[] = [
      command,
      {
        protocolVersion: PROTOCOL_VERSION,
        kind: "success",
        requestId: "request-1",
        payload: {
          accepted: true,
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: "request-2",
        error: {
          code: "ROOM_FULL",
          message: "ルームは満員です。",
        },
      },
      {
        protocolVersion: PROTOCOL_VERSION,
        kind: "event",
        event: "room.snapshot",
        revision: 8,
        payload: {
          roomId: "room-1",
        },
      },
    ];

    for (const message of messages) {
      const encoded = expectProtocolValue(encodeProtocolMessage(message));
      const decoded = expectProtocolValue(decodeProtocolMessage(encoded));

      expect(decoded).toEqual(message);
    }
  });

  it("同じ requestId の再送を識別する", () => {
    const retry: ClientCommandEnvelope = {
      ...command,
      payload: {
        ready: true,
      },
    };
    const anotherRequest: ClientCommandEnvelope = {
      ...command,
      requestId: "request-2",
    };

    expect(isDuplicateRequest(command, retry)).toBe(true);
    expect(isDuplicateRequest(command, anotherRequest)).toBe(false);
  });

  it("すべての公開エラーに機械判定用の安定した code がある", () => {
    expect(FLARE_LOBBY_ERROR_CODES).toEqual([
      "CONNECTION_FAILED",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "ROOM_FULL",
      "ROOM_FINISHED",
      "CONFLICT",
      "CANCELLED",
      "TIMEOUT",
      "INVALID_MESSAGE",
      "INVALID_PAYLOAD",
      "UNSUPPORTED_PROTOCOL_VERSION",
      "UNKNOWN_EVENT",
    ]);

    for (const code of FLARE_LOBBY_ERROR_CODES) {
      expect(new FlareLobbyError(code).code).toBe(code);
    }
  });

  it("TIMEOUT を既定メッセージ付きで生成し failure Envelope を往復できる", () => {
    const timeout = new FlareLobbyError("TIMEOUT", { requestId: "request-1" });
    expect(timeout.code).toBe("TIMEOUT");
    expect(timeout.message).toBe("操作がタイムアウトしました。");
    expect(timeout.requestId).toBe("request-1");
    expect(timeout.toJSON()).toEqual({
      code: "TIMEOUT",
      message: "操作がタイムアウトしました。",
    });

    const encoded = expectProtocolValue(
      encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: "request-1",
        error: timeout.toJSON(),
      }),
    );
    const decoded = expectProtocolValue(decodeServerMessage(encoded));
    expect(decoded).toMatchObject({
      kind: "failure",
      requestId: "request-1",
      error: { code: "TIMEOUT" },
    });
  });

  it("revision から欠落、重複、順序逆転を検出する", () => {
    expect(classifyEventRevision(7, 8)).toBe("next");
    expect(classifyEventRevision(7, 7)).toBe("duplicate");
    expect(classifyEventRevision(7, 9)).toBe("gap");
    expect(classifyEventRevision(7, 6)).toBe("out_of_order");
  });

  it("未知のプロトコル版と必須項目の欠落を公開エラーとして返す", () => {
    expectProtocolError(
      decodeProtocolMessage(
        JSON.stringify({
          protocolVersion: 2,
          kind: "command",
          requestId: "request-1",
          command: "room.set_ready",
          payload: {
            ready: true,
          },
        }),
      ),
      "UNSUPPORTED_PROTOCOL_VERSION",
    );

    expectProtocolError(
      decodeProtocolMessage(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          kind: "command",
          requestId: "request-1",
          payload: {},
        }),
      ),
      "INVALID_MESSAGE",
    );
  });

  it("不正な Payload と不正な JSON を内部例外を漏らさず拒否する", () => {
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "command",
        requestId: "request-1",
        command: "room.set_ready",
        payload: {
          ready: undefined,
        },
      }),
      "INVALID_PAYLOAD",
    );

    const error = expectProtocolError(
      decodeProtocolMessage("{not-json"),
      "INVALID_MESSAGE",
    );

    expect(error.message).toBe("メッセージの形式が正しくありません。");
    expect(error.message).not.toContain("SyntaxError");
  });

  it("隠し toJSON やアクセサプロパティを含む Payload を拒否する", () => {
    const buildCommand = (payload: unknown) => ({
      protocolVersion: PROTOCOL_VERSION,
      kind: "command",
      requestId: "request-1",
      command: "room.set_ready",
      payload,
    });

    // 通常のデータプロパティだけの入れ子は従来どおり検証を通過する。
    expect(
      validateProtocolMessage(
        buildCommand({
          ready: true,
          meta: { players: [1, "a", null], flags: { ranked: false } },
        }),
      ).ok,
    ).toBe(true);

    // 列挙されない own toJSON は JSON.stringify の挙動を変えるため拒否する。
    const hiddenToJson: Record<string, unknown> = { ready: true };
    Object.defineProperty(hiddenToJson, "toJSON", {
      value: () => ({}),
      enumerable: false,
      writable: true,
      configurable: true,
    });

    expectProtocolError(
      validateProtocolMessage(buildCommand(hiddenToJson)),
      "INVALID_PAYLOAD",
    );

    // 列挙可能なゲッターもシリアライズ時に評価されるため拒否する。
    const getterPayload: Record<string, unknown> = {};
    Object.defineProperty(getterPayload, "ready", {
      get() {
        return true;
      },
      enumerable: true,
      configurable: true,
    });

    expectProtocolError(
      validateProtocolMessage(buildCommand(getterPayload)),
      "INVALID_PAYLOAD",
    );

    // 列挙されないセッターのみのアクセサも拒否する。
    const setterOnlyPayload: Record<string, unknown> = { ready: true };
    Object.defineProperty(setterOnlyPayload, "hidden", {
      set(value: unknown) {
        void value;
      },
      enumerable: false,
      configurable: true,
    });

    expectProtocolError(
      validateProtocolMessage(buildCommand(setterOnlyPayload)),
      "INVALID_PAYLOAD",
    );
  });

  it("未知のイベントを登録済みイベント一覧と照合して拒否する", () => {
    const encodedEvent = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      event: "room.unknown",
      revision: 1,
      payload: null,
    });

    expectProtocolError(
      decodeServerMessage(encodedEvent, {
        knownEventTypes: ["room.snapshot"],
      }),
      "UNKNOWN_EVENT",
    );
  });

  it("送受信の方向に合わない Envelope を拒否する", () => {
    const encodedCommand = expectProtocolValue(encodeProtocolMessage(command));
    const encodedEvent = expectProtocolValue(
      encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "event",
        event: "room.snapshot",
        revision: 1,
        payload: null,
      }),
    );

    expectProtocolError(decodeServerMessage(encodedCommand), "INVALID_MESSAGE");
    expectProtocolError(decodeClientCommand(encodedEvent), "INVALID_MESSAGE");
  });

  it("公開エラーをコードと表示文言へ分離してシリアライズする", () => {
    const error = new FlareLobbyError("FORBIDDEN", {
      message: "この操作にはホスト権限が必要です。",
      requestId: "request-3",
    });

    expect(error.code).toBe("FORBIDDEN");
    expect(error.requestId).toBe("request-3");
    expect(error.toJSON()).toEqual({
      code: "FORBIDDEN",
      message: "この操作にはホスト権限が必要です。",
    });
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({
        code: "FORBIDDEN",
        message: "この操作にはホスト権限が必要です。",
      }),
    );
  });

  it("FlareLobbyError.fromPayload は requestId の有無で例外情報を復元する", () => {
    const payload = {
      code: "ROOM_FINISHED",
      message: "ルームは終了しています。",
    } as const;

    const withoutRequest = FlareLobbyError.fromPayload(payload);
    expect(withoutRequest.code).toBe("ROOM_FINISHED");
    expect(withoutRequest.message).toBe("ルームは終了しています。");
    expect(withoutRequest.requestId).toBeUndefined();

    const withRequest = FlareLobbyError.fromPayload(payload, "request-9");
    expect(withRequest.requestId).toBe("request-9");
    expect(withRequest.toJSON()).toEqual(payload);
  });

  it("HTTP メタデータは保持し wire 形式と WebSocket 互換を維持する", () => {
    const error = new FlareLobbyError("CONFLICT", {
      message: "要求が許可された頻度を超えています。",
      requestId: "request-1",
      httpStatus: 429,
      retryAfterSeconds: 12,
    });

    expect(error.code).toBe("CONFLICT");
    expect(error.requestId).toBe("request-1");
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
    // toJSON の wire 形式は変更しない。
    expect(error.toJSON()).toEqual({
      code: "CONFLICT",
      message: "要求が許可された頻度を超えています。",
    });
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({
        code: "CONFLICT",
        message: "要求が許可された頻度を超えています。",
      }),
    );

    // fromPayload は通信 Envelope の復元のみで HTTP 情報を新設しない。
    const restored = FlareLobbyError.fromPayload(error.toJSON(), "request-1");
    expect(restored.code).toBe("CONFLICT");
    expect(restored.message).toBe("要求が許可された頻度を超えています。");
    expect(restored.requestId).toBe("request-1");
    expect(restored.httpStatus).toBeUndefined();
    expect(restored.retryAfterSeconds).toBeUndefined();

    // 既定では HTTP メタデータを持たない。
    const plain = new FlareLobbyError("CONFLICT");
    expect(plain.httpStatus).toBeUndefined();
    expect(plain.retryAfterSeconds).toBeUndefined();
  });

  it("decode 系の入力形式と JSON 解析失敗を INVALID_MESSAGE へ正規化する", () => {
    // 文字列以外
    expectProtocolError(
      decodeProtocolMessage(42 as unknown as string),
      "INVALID_MESSAGE",
    );
    // JSON として不正
    expectProtocolError(decodeProtocolMessage("{{{"), "INVALID_MESSAGE");
    // JSON だがオブジェクトでない
    expectProtocolError(
      decodeProtocolMessage(JSON.stringify([1, 2, 3])),
      "INVALID_MESSAGE",
    );
  });

  it("validateProtocolMessage は Envelope 形式外を INVALID_MESSAGE で拒否する", () => {
    expectProtocolError(
      validateProtocolMessage("command" as unknown as ProtocolMessage),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: 99,
        kind: "event",
        event: "room.snapshot",
        revision: 1,
        payload: null,
      } as unknown as ProtocolMessage),
      "UNSUPPORTED_PROTOCOL_VERSION",
    );
  });

  it("protocolVersion の非整数と未知の kind を INVALID_MESSAGE で拒否する", () => {
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: "1",
        kind: "command",
        requestId: "request-1",
        command: "room.set_ready",
        payload: {},
      }),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "bogus",
        requestId: "request-1",
      }),
      "INVALID_MESSAGE",
    );
  });

  it("検証中の例外を INVALID_PAYLOAD へ正規化する", () => {
    const throwingKind: Record<string, unknown> = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "request-1",
    };
    Object.defineProperty(throwingKind, "kind", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
      configurable: true,
    });

    expectProtocolError(
      validateProtocolMessage(throwingKind),
      "INVALID_PAYLOAD",
    );
  });

  it("decodeClientCommand は方向違いと復号失敗と正常系を処理する", () => {
    // 復号失敗はそのまま伝搬する。
    expectProtocolError(decodeClientCommand("{not-json"), "INVALID_MESSAGE");

    // success Envelope は command ではないため拒否する。
    const encodedSuccess = expectProtocolValue(
      encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "success",
        requestId: "request-1",
        payload: { accepted: true },
      }),
    );
    expectProtocolError(decodeClientCommand(encodedSuccess), "INVALID_MESSAGE");

    // failure Envelope (requestId あり) も command ではないため拒否する。
    const encodedFailure = expectProtocolValue(
      encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: "request-2",
        error: { code: "ROOM_FULL", message: "ルームは満員です。" },
      }),
    );
    expectProtocolError(decodeClientCommand(encodedFailure), "INVALID_MESSAGE");

    // requestId が null の failure Envelope も command ではないため拒否する。
    const nullRequestFailure = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: "failure",
      requestId: null,
      error: { code: "ROOM_FULL", message: "ルームは満員です。" },
    });
    expectProtocolError(
      decodeClientCommand(nullRequestFailure),
      "INVALID_MESSAGE",
    );

    // 正常な command はそのまま復元する。
    const encodedCommand = expectProtocolValue(encodeProtocolMessage(command));
    expect(expectProtocolValue(decodeClientCommand(encodedCommand))).toEqual(
      command,
    );
  });

  it("encodeProtocolMessage は検証失敗と文字列化失敗を公開エラーで返す", () => {
    expectProtocolError(
      encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "command",
        requestId: "request-1",
        command: "room.set_ready",
      } as unknown as ProtocolMessage),
      "INVALID_MESSAGE",
    );

    const stringify = vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("stringify boom");
    });
    try {
      expectProtocolError(encodeProtocolMessage(command), "INVALID_PAYLOAD");
    } finally {
      stringify.mockRestore();
    }
  });

  it("success 応答の requestId 欠落と不正 Payload を拒否する", () => {
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "success",
        payload: { accepted: true },
      }),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "success",
        requestId: "request-1",
        payload: undefined,
      }),
      "INVALID_PAYLOAD",
    );
  });

  it("failure 応答の requestId と error 形式を検証する", () => {
    const validError = { code: "ROOM_FULL", message: "ルームは満員です。" };
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: 42,
        error: validError,
      }),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: "request-1",
        error: "oops",
      }),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "failure",
        requestId: "request-1",
        error: { code: "NOPE", message: "" },
      }),
      "INVALID_MESSAGE",
    );
  });

  it("event の event・revision・payload 形式を検証する", () => {
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "event",
        event: 42,
        revision: "x",
        payload: null,
      }),
      "INVALID_MESSAGE",
    );
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "event",
        event: "room.snapshot",
        revision: 1,
        payload: undefined,
      }),
      "INVALID_PAYLOAD",
    );
  });

  it("payload キーの欠落を INVALID_MESSAGE で拒否する", () => {
    expectProtocolError(
      validateProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: "command",
        requestId: "request-1",
        command: "room.set_ready",
      }),
      "INVALID_MESSAGE",
    );
  });

  it("JSON 値として扱えない Payload を INVALID_PAYLOAD で拒否する", () => {
    const buildCommand = (payload: unknown) => ({
      protocolVersion: PROTOCOL_VERSION,
      kind: "command",
      requestId: "request-1",
      command: "room.set_ready",
      payload,
    });

    // 循環参照は拒否する。
    const circular: Record<string, unknown> = { ready: true };
    circular["self"] = circular;
    expectProtocolError(
      validateProtocolMessage(buildCommand(circular)),
      "INVALID_PAYLOAD",
    );

    // シンボルキーを含むオブジェクトは拒否する。
    const withSymbol: Record<string, unknown> = { ready: true };
    (withSymbol as Record<symbol, unknown>)[Symbol("hidden")] = true;
    expectProtocolError(
      validateProtocolMessage(buildCommand(withSymbol)),
      "INVALID_PAYLOAD",
    );

    // 配列要素が JSON 値でない場合は拒否する。
    expectProtocolError(
      validateProtocolMessage(buildCommand({ list: [1, undefined] })),
      "INVALID_PAYLOAD",
    );

    // 組み込みクラスのインスタンスはプレーンオブジェクトではないため拒否する。
    expectProtocolError(
      validateProtocolMessage(buildCommand({ at: new Date() })),
      "INVALID_PAYLOAD",
    );
  });
});
