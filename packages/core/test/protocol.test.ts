import { describe, expect, it } from "vitest";

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
      "INVALID_MESSAGE",
      "INVALID_PAYLOAD",
      "UNSUPPORTED_PROTOCOL_VERSION",
      "UNKNOWN_EVENT",
    ]);

    for (const code of FLARE_LOBBY_ERROR_CODES) {
      expect(new FlareLobbyError(code).code).toBe(code);
    }
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
});
