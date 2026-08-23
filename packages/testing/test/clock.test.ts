import { describe, expect, it } from "vitest";
import {
  VirtualClock,
  createVirtualClock,
  toEpochMilliseconds,
} from "../src/index.js";

describe("VirtualClock", () => {
  it("accepts ISO 8601 UTC strings with the Z designator", () => {
    const clock = new VirtualClock("2026-01-02T03:04:05.678Z");

    expect(clock.now()).toBe(Date.parse("2026-01-02T03:04:05.678Z"));
    expect(clock.nowTimestamp()).toBe("2026-01-02T03:04:05.678Z");

    expect(clock.advanceTo("2027-06-07T08:09:10.111Z")).toBe(
      Date.parse("2027-06-07T08:09:10.111Z"),
    );
    expect(clock.now()).toBe(Date.parse("2027-06-07T08:09:10.111Z"));

    expect(createVirtualClock(0).now()).toBe(0);
    expect(toEpochMilliseconds("1970-01-01T00:00:00.000Z")).toBe(0);
  });

  it("rejects date-time strings without the Z designator", () => {
    for (const value of [
      "2026-01-02T03:04:05.678",
      "2026-01-02T03:04:05",
      "2026-01-02",
    ]) {
      expect(() => new VirtualClock(value)).toThrow(RangeError);
      expect(() => toEpochMilliseconds(value)).toThrow(RangeError);
      expect(() => createVirtualClock(0).advanceTo(value)).toThrow(RangeError);
    }
  });
});
