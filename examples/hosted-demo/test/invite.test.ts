import { describe, expect, it } from "vitest";
import {
  buildInviteUrl,
  classifyInviteJoinError,
  describeInviteJoinFailure,
  isInviteCode,
  parseInviteCodeFromHash,
} from "../src/invite.js";

describe("招待リンクの検証", () => {
  it("6 文字の英大文字・数字だけを受け付ける", () => {
    expect(isInviteCode("ABC123")).toBe(true);
    expect(isInviteCode("abc123")).toBe(false);
    expect(isInviteCode("ABC12")).toBe(false);
    expect(isInviteCode("ABC1234")).toBe(false);
    expect(isInviteCode("AB-123")).toBe(false);
    expect(isInviteCode("")).toBe(false);
    expect(isInviteCode(null)).toBe(false);
  });

  it("location.hash から招待コードだけを取り出す", () => {
    expect(parseInviteCodeFromHash("#invite=ABC123")).toBe("ABC123");
    expect(parseInviteCodeFromHash("#invite=abc123")).toBe("ABC123");
    expect(parseInviteCodeFromHash("#invite=ABC12")).toBeNull();
    expect(parseInviteCodeFromHash("#invite=")).toBeNull();
    expect(parseInviteCodeFromHash("#resume=TOKEN")).toBeNull();
    expect(parseInviteCodeFromHash("")).toBeNull();
  });

  it("自サイトの招待リンクを作り、token 類を含めない", () => {
    const url = buildInviteUrl("https://demo.example", "ABC123");
    expect(url).toBe("https://demo.example/#invite=ABC123");
    expect(buildInviteUrl("https://demo.example", "invalid!")).toBeNull();
    expect(buildInviteUrl("not-a-url", "ABC123")).toBeNull();
  });

  it("参加失敗を無効・期限切れ・満員・終了済みへ区別する", () => {
    expect(classifyInviteJoinError({ code: "NOT_FOUND" })).toBe("invalid");
    expect(classifyInviteJoinError({ code: "INVALID_PAYLOAD" })).toBe(
      "invalid",
    );
    expect(classifyInviteJoinError({ code: "TIMEOUT" })).toBe("expired");
    expect(classifyInviteJoinError({ code: "ROOM_FULL" })).toBe("full");
    expect(classifyInviteJoinError({ code: "ROOM_FINISHED" })).toBe("finished");
    expect(classifyInviteJoinError({ code: "FORBIDDEN" })).toBe("other");
    expect(classifyInviteJoinError(new Error("boom"))).toBe("other");
    for (const kind of [
      "invalid",
      "expired",
      "full",
      "finished",
      "other",
    ] as const) {
      expect(describeInviteJoinFailure(kind).length).toBeGreaterThan(0);
    }
  });
});
