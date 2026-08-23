import type { JsonValue, Revision } from "./index.js";

/** JSON 通信プロトコル第 1 版の番号です。 */
export const PROTOCOL_VERSION = 1 as const;

/** 現在サポートする JSON 通信プロトコルの番号です。 */
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** クライアントが操作ごとに生成する不透明な要求識別子です。 */
export type RequestId = string;

/** クライアントコマンドの種別です。 */
export type ProtocolCommandName = string;

/** サーバーイベントの種別です。 */
export type ProtocolEventType = string;

/** 通信 Envelope の種類です。 */
export type ProtocolMessageKind = "command" | "success" | "failure" | "event";

/** すべての通信 Envelope に共通する必須項目です。 */
export interface ProtocolEnvelope<TKind extends ProtocolMessageKind> {
  readonly protocolVersion: ProtocolVersion;
  readonly kind: TKind;
}

/** クライアントからサーバーへ送る状態変更または問い合わせです。 */
export interface ClientCommandEnvelope<
  TCommand extends ProtocolCommandName = ProtocolCommandName,
  TPayload = JsonValue,
> extends ProtocolEnvelope<"command"> {
  /** 再送時も変更しない、クライアント生成の要求識別子です。 */
  readonly requestId: RequestId;
  readonly command: TCommand;
  readonly payload: TPayload;
}

/** サーバーがコマンドの成功を通知する応答です。 */
export interface ServerSuccessEnvelope<
  TPayload = JsonValue,
> extends ProtocolEnvelope<"success"> {
  /** 対応するクライアントコマンドの要求識別子です。 */
  readonly requestId: RequestId;
  readonly payload: TPayload;
}

/** すべての公開エラーで利用する、機械判定用の安定したコードです。 */
export const FLARE_LOBBY_ERROR_CODES = [
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
] as const;

/** 公開エラーの安定したコードです。 */
export type FlareLobbyErrorCode = (typeof FLARE_LOBBY_ERROR_CODES)[number];

/** 通信上で安全に公開できるエラー情報です。 */
export interface FlareLobbyErrorPayload {
  readonly code: FlareLobbyErrorCode;
  /** 表示用の安全な文言です。機械判定には使用しません。 */
  readonly message: string;
}

/** `FlareLobbyError` を作成するときに指定できる追加情報です。 */
export interface FlareLobbyErrorOptions {
  /** 表示用の安全な文言です。省略時はコードに対応する既定文言になります。 */
  readonly message?: string;
  /** 対応するクライアントコマンドが分かる場合の要求識別子です。 */
  readonly requestId?: RequestId;
}

const defaultErrorMessages: Readonly<Record<FlareLobbyErrorCode, string>> = {
  CONNECTION_FAILED: "通信接続に失敗しました。",
  UNAUTHENTICATED: "認証が必要です。",
  FORBIDDEN: "この操作を実行する権限がありません。",
  ROOM_FULL: "ルームは満員です。",
  ROOM_FINISHED: "ルームは終了しています。",
  CONFLICT: "現在の状態と競合しました。",
  CANCELLED: "操作は取り消されました。",
  INVALID_MESSAGE: "メッセージの形式が正しくありません。",
  INVALID_PAYLOAD: "Payload の形式が正しくありません。",
  UNSUPPORTED_PROTOCOL_VERSION: "このプロトコル版はサポートされていません。",
  UNKNOWN_EVENT: "このイベント種別はサポートされていません。",
};

/**
 * 利用者へ公開する操作失敗です。
 *
 * `code` は機械判定のために固定し、`message` は安全な表示用文言として
 * 分離します。通信へは内部例外、スタックトレース、秘密情報を出力しません。
 */
export class FlareLobbyError extends Error {
  public readonly code: FlareLobbyErrorCode;
  public readonly requestId: RequestId | undefined;

  public constructor(
    code: FlareLobbyErrorCode,
    options: FlareLobbyErrorOptions = {},
  ) {
    super(options.message ?? defaultErrorMessages[code]);
    this.name = "FlareLobbyError";
    this.code = code;
    this.requestId = options.requestId;
  }

  /** 通信上で公開可能なエラー情報だけを返します。 */
  public toJSON(): FlareLobbyErrorPayload {
    return {
      code: this.code,
      message: this.message,
    };
  }

  /** 通信 Envelope のエラー情報を公開例外へ正規化します。 */
  public static fromPayload(
    payload: FlareLobbyErrorPayload,
    requestId?: RequestId,
  ): FlareLobbyError {
    return requestId === undefined
      ? new FlareLobbyError(payload.code, { message: payload.message })
      : new FlareLobbyError(payload.code, {
          message: payload.message,
          requestId,
        });
  }
}

/** サーバーがコマンドの失敗を通知する応答です。 */
export interface ServerFailureEnvelope extends ProtocolEnvelope<"failure"> {
  /**
   * 対応する要求識別子です。
   *
   * 要求識別子を読み取る前に拒否したときだけ `null` を使用します。
   */
  readonly requestId: RequestId | null;
  readonly error: FlareLobbyErrorPayload;
}

/** サーバーから接続済みクライアントへ配信するイベントです。 */
export interface ServerEventEnvelope<
  TEvent extends ProtocolEventType = ProtocolEventType,
  TPayload = JsonValue,
> extends ProtocolEnvelope<"event"> {
  readonly event: TEvent;
  /** このイベントを反映した後の単調増加するルーム版番号です。 */
  readonly revision: Revision;
  readonly payload: TPayload;
}

/** クライアントが受信するサーバーからの通信です。 */
export type ServerMessage =
  | ServerSuccessEnvelope
  | ServerFailureEnvelope
  | ServerEventEnvelope;

/** JSON 通信プロトコル第 1 版で送受信する通信です。 */
export type ProtocolMessage = ClientCommandEnvelope | ServerMessage;

/** エンコードまたはデコードに成功した結果です。 */
export interface ProtocolSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

/** エンコードまたはデコードに失敗した結果です。 */
export interface ProtocolFailure {
  readonly ok: false;
  readonly error: FlareLobbyError;
}

/** 例外を送出しない通信処理の結果です。 */
export type ProtocolResult<TValue> = ProtocolSuccess<TValue> | ProtocolFailure;

/** イベント種別を意味まで含めて検証するときの設定です。 */
export interface ProtocolValidationOptions {
  /** 指定時、一覧にないサーバーイベントは `UNKNOWN_EVENT` として拒否します。 */
  readonly knownEventTypes?: readonly ProtocolEventType[];
}

/** 受信済み版番号とイベント版番号の関係です。 */
export type EventRevisionStatus = "next" | "duplicate" | "gap" | "out_of_order";

/** 2 個のコマンドが同じ要求識別子を持つかを返します。 */
export function isDuplicateRequest(
  first: Pick<ClientCommandEnvelope, "requestId">,
  second: Pick<ClientCommandEnvelope, "requestId">,
): boolean {
  return first.requestId === second.requestId;
}

/**
 * 受信済み版番号を基準に、イベントの欠落・重複・順序逆転を判定します。
 *
 * 初期スナップショットの `revision` を `lastRevision` に渡してから使用します。
 */
export function classifyEventRevision(
  lastRevision: Revision,
  eventRevision: Revision,
): EventRevisionStatus {
  if (eventRevision === lastRevision + 1) {
    return "next";
  }

  if (eventRevision === lastRevision) {
    return "duplicate";
  }

  return eventRevision > lastRevision ? "gap" : "out_of_order";
}

/** 通信オブジェクトを JSON 形式として検証します。 */
export function validateProtocolMessage(
  input: unknown,
  options: ProtocolValidationOptions = {},
): ProtocolResult<ProtocolMessage> {
  try {
    if (!isRecord(input)) {
      return protocolFailure("INVALID_MESSAGE");
    }

    const requestId = readRequestId(input);
    const protocolVersion = input["protocolVersion"];

    if (!Number.isSafeInteger(protocolVersion)) {
      return protocolFailure("INVALID_MESSAGE", requestId);
    }

    if (protocolVersion !== PROTOCOL_VERSION) {
      return protocolFailure("UNSUPPORTED_PROTOCOL_VERSION", requestId);
    }

    switch (input["kind"]) {
      case "command":
        return validateClientCommand(input, requestId);
      case "success":
        return validateServerSuccess(input, requestId);
      case "failure":
        return validateServerFailure(input);
      case "event":
        return validateServerEvent(input, options);
      default:
        return protocolFailure("INVALID_MESSAGE", requestId);
    }
  } catch {
    return protocolFailure("INVALID_PAYLOAD");
  }
}

/** JSON 文字列をデコードし、通信オブジェクトとして検証します。 */
export function decodeProtocolMessage(
  encoded: string,
  options: ProtocolValidationOptions = {},
): ProtocolResult<ProtocolMessage> {
  if (typeof encoded !== "string") {
    return protocolFailure("INVALID_MESSAGE");
  }

  try {
    return validateProtocolMessage(JSON.parse(encoded), options);
  } catch {
    return protocolFailure("INVALID_MESSAGE");
  }
}

/** JSON 文字列をクライアントコマンドとしてデコードします。 */
export function decodeClientCommand(
  encoded: string,
): ProtocolResult<ClientCommandEnvelope> {
  const decoded = decodeProtocolMessage(encoded);

  if (!decoded.ok) {
    return decoded;
  }

  if (decoded.value.kind !== "command") {
    return protocolFailure("INVALID_MESSAGE", requestIdOf(decoded.value));
  }

  return protocolSuccess(decoded.value);
}

/** JSON 文字列をサーバー応答またはイベントとしてデコードします。 */
export function decodeServerMessage(
  encoded: string,
  options: ProtocolValidationOptions = {},
): ProtocolResult<ServerMessage> {
  const decoded = decodeProtocolMessage(encoded, options);

  if (!decoded.ok) {
    return decoded;
  }

  if (decoded.value.kind === "command") {
    return protocolFailure("INVALID_MESSAGE", decoded.value.requestId);
  }

  return protocolSuccess(decoded.value);
}

/** 通信オブジェクトを検証して JSON 文字列へエンコードします。 */
export function encodeProtocolMessage(
  message: ProtocolMessage,
  options: ProtocolValidationOptions = {},
): ProtocolResult<string> {
  const validation = validateProtocolMessage(message, options);

  if (!validation.ok) {
    return validation;
  }

  try {
    return protocolSuccess(JSON.stringify(validation.value));
  } catch {
    return protocolFailure("INVALID_PAYLOAD", requestIdOf(validation.value));
  }
}

/** 値が公開エラーコードかを判定します。 */
export function isFlareLobbyErrorCode(
  value: unknown,
): value is FlareLobbyErrorCode {
  return (
    typeof value === "string" &&
    FLARE_LOBBY_ERROR_CODES.some((code) => code === value)
  );
}

function validateClientCommand(
  input: Record<string, unknown>,
  requestId: RequestId | undefined,
): ProtocolResult<ClientCommandEnvelope> {
  if (requestId === undefined || !isNonEmptyString(input["command"])) {
    return protocolFailure("INVALID_MESSAGE", requestId);
  }

  const payload = validatePayload(input, requestId);

  if (!payload.ok) {
    return payload;
  }

  return protocolSuccess({
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    requestId,
    command: input["command"],
    payload: payload.value,
  });
}

function validateServerSuccess(
  input: Record<string, unknown>,
  requestId: RequestId | undefined,
): ProtocolResult<ServerSuccessEnvelope> {
  if (requestId === undefined) {
    return protocolFailure("INVALID_MESSAGE");
  }

  const payload = validatePayload(input, requestId);

  if (!payload.ok) {
    return payload;
  }

  return protocolSuccess({
    protocolVersion: PROTOCOL_VERSION,
    kind: "success",
    requestId,
    payload: payload.value,
  });
}

function validateServerFailure(
  input: Record<string, unknown>,
): ProtocolResult<ServerFailureEnvelope> {
  const rawRequestId = input["requestId"];

  if (rawRequestId !== null && !isNonEmptyString(rawRequestId)) {
    return protocolFailure("INVALID_MESSAGE");
  }

  const error = input["error"];

  if (!isRecord(error)) {
    return protocolFailure("INVALID_MESSAGE", requestIdFromValue(rawRequestId));
  }

  const code = error["code"];
  const message = error["message"];

  if (!isFlareLobbyErrorCode(code) || !isNonEmptyString(message)) {
    return protocolFailure("INVALID_MESSAGE", requestIdFromValue(rawRequestId));
  }

  return protocolSuccess({
    protocolVersion: PROTOCOL_VERSION,
    kind: "failure",
    requestId: rawRequestId,
    error: {
      code,
      message,
    },
  });
}

function validateServerEvent(
  input: Record<string, unknown>,
  options: ProtocolValidationOptions,
): ProtocolResult<ServerEventEnvelope> {
  const event = input["event"];
  const revision = input["revision"];

  if (!isNonEmptyString(event) || !isRevision(revision)) {
    return protocolFailure("INVALID_MESSAGE");
  }

  if (
    options.knownEventTypes !== undefined &&
    !options.knownEventTypes.includes(event)
  ) {
    return protocolFailure("UNKNOWN_EVENT");
  }

  const payload = validatePayload(input);

  if (!payload.ok) {
    return payload;
  }

  return protocolSuccess({
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    event,
    revision,
    payload: payload.value,
  });
}

function validatePayload(
  input: Record<string, unknown>,
  requestId?: RequestId,
): ProtocolResult<JsonValue> {
  if (!hasOwn(input, "payload")) {
    return protocolFailure("INVALID_MESSAGE", requestId);
  }

  const payload = input["payload"];

  if (!isJsonValue(payload)) {
    return protocolFailure("INVALID_PAYLOAD", requestId);
  }

  return protocolSuccess(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function readRequestId(input: Record<string, unknown>): RequestId | undefined {
  return requestIdFromValue(input["requestId"]);
}

function requestIdFromValue(value: unknown): RequestId | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function requestIdOf(message: ProtocolMessage): RequestId | undefined {
  switch (message.kind) {
    case "command":
    case "success":
      return message.requestId;
    case "failure":
      return message.requestId ?? undefined;
    case "event":
      return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is Revision {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): value is JsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      return isJsonContainer(value, ancestors);
    default:
      return false;
  }
}

function isJsonContainer(value: object, ancestors: WeakSet<object>): boolean {
  if (ancestors.has(value)) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isJsonValue(item, ancestors)) {
          return false;
        }
      }

      return true;
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        key === "toJSON" ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        return false;
      }
    }

    for (const descriptor of Object.values(descriptors)) {
      if (!isJsonValue(descriptor.value, ancestors)) {
        return false;
      }
    }

    return true;
  } finally {
    ancestors.delete(value);
  }
}

function protocolSuccess<TValue>(value: TValue): ProtocolSuccess<TValue> {
  return {
    ok: true,
    value,
  };
}

function protocolFailure<TValue>(
  code: FlareLobbyErrorCode,
  requestId?: RequestId,
): ProtocolResult<TValue> {
  return {
    ok: false,
    error:
      requestId === undefined
        ? new FlareLobbyError(code)
        : new FlareLobbyError(code, { requestId }),
  };
}
