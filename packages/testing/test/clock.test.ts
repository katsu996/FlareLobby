import { describe, expect, it } from "vitest";
import {
  VirtualClock,
  addMilliseconds,
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

  it("rejects negative or non-integer advances and time travel", () => {
    const clock = createVirtualClock(1_000);

    for (const milliseconds of [-1, 1.5, Number.NaN]) {
      expect(() => clock.advanceBy(milliseconds)).toThrow(RangeError);
    }
    expect(() => clock.advanceTo(999)).toThrow(RangeError);
    expect(clock.advanceBy(0)).toBe(1_000);
    expect(clock.advanceBy(500)).toBe(1_500);
  });

  it("rejects non-finite numeric time and non-string time values", () => {
    for (const value of [
      Number.NaN,
      1.5,
      Number.POSITIVE_INFINITY,
      8_640_000_000_000_001,
    ]) {
      expect(() => toEpochMilliseconds(value)).toThrow(RangeError);
      expect(() => new VirtualClock(value)).toThrow(RangeError);
    }

    expect(() => toEpochMilliseconds(null as unknown as number)).toThrow(
      TypeError,
    );
    expect(() => toEpochMilliseconds({} as unknown as number)).toThrow(
      TypeError,
    );
  });

  it("rejects ISO strings that pass the grammar but are not real dates", () => {
    // 月 13 は文法上は数字4-2-2桁に一致するが実在しない。
    expect(() => toEpochMilliseconds("2026-13-01T00:00:00.000Z")).toThrow(
      RangeError,
    );
    expect(() => new VirtualClock("2026-13-01T00:00:00Z")).toThrow(RangeError);
  });

  it("rejects millisecond additions that leave the valid date range", () => {
    expect(addMilliseconds(1_000, 2_000)).toBe(3_000);
    expect(() => addMilliseconds(Number.NaN, 1)).toThrow(RangeError);
    expect(() => addMilliseconds(1.5, 1)).toThrow(RangeError);
    expect(() => addMilliseconds(1, -1)).toThrow(RangeError);
    expect(() => addMilliseconds(8_640_000_000_000_000, 1)).toThrow(RangeError);
  });
});
