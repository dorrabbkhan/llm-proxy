import { describe, it, expect } from "vitest";
import { createIdGenerator, sequentialIds } from "./ids";

describe("sequentialIds", () => {
  it("produces call_0, call_1, call_2 …", () => {
    const ids = sequentialIds();
    expect([ids(), ids(), ids()]).toEqual(["call_0", "call_1", "call_2"]);
  });

  it("honours a custom prefix", () => {
    const ids = sequentialIds("tc_");
    expect([ids(), ids()]).toEqual(["tc_0", "tc_1"]);
  });
});

describe("createIdGenerator", () => {
  it("produces unique ids with the default call_ prefix", () => {
    const ids = createIdGenerator();
    const a = ids();
    const b = ids();
    expect(a).toMatch(/^call_.+/);
    expect(b).toMatch(/^call_.+/);
    expect(a).not.toBe(b);
  });

  it("honours a custom prefix", () => {
    const ids = createIdGenerator("toolu_");
    expect(ids()).toMatch(/^toolu_.+/);
  });
});
