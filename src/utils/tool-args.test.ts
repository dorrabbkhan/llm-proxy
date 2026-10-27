import { describe, it, expect } from "vitest";
import { parseToolArguments } from "./tool-args";

describe("parseToolArguments", () => {
  it('"" → empty object, valid', () => {
    expect(parseToolArguments("")).toEqual({ args: {}, valid: true });
  });

  it("a JSON object → itself, valid", () => {
    expect(parseToolArguments('{"a":1}')).toEqual({
      args: { a: 1 },
      valid: true,
    });
  });

  it.each(["[1]", "not json", '{"a":'])(
    "%s → _invalid_arguments wrapper, invalid",
    (input) => {
      expect(parseToolArguments(input)).toEqual({
        args: { _invalid_arguments: input },
        valid: false,
      });
    },
  );
});
