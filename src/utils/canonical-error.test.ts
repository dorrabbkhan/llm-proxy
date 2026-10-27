import { describe, it, expect } from "vitest";
import { parseRetryAfter } from "./canonical-error";

describe("parseRetryAfter", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  it("Retry-After forms", () => {
    // delta-seconds pass through
    expect(parseRetryAfter("30", now)).toBe(30);
    // an HTTP-date becomes whole seconds from now
    expect(
      parseRetryAfter(
        new Date(now.getTime() + 90_000).toUTCString(),
        now,
      ),
    ).toBe(90);
    // a past date clamps to 1, never 0 or negative
    expect(
      parseRetryAfter(
        new Date(now.getTime() - 60_000).toUTCString(),
        now,
      ),
    ).toBe(1);
    // garbage is dropped
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    // absent header is dropped
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});
