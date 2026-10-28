import { describe, it, expect } from "vitest";
import { estimateInputTokens } from "./token-estimate";
import type { CanonicalRequest } from "../types/canonical.types";

describe("estimateInputTokens", () => {
  it("estimate counts system, messages, tool args, results and tool definitions", () => {
    const req: CanonicalRequest = {
      model: "m",
      systemPrompt: "SYS", // 3 chars
      messages: [
        { role: "user", content: "Hello" }, // 5
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "f", arguments: '{"a":1}' }, // 7
            },
          ],
        },
        { role: "tool", toolCallId: "c1", content: "result!" }, // 7
        {
          role: "user",
          content: [
            { type: "text", text: "ab" }, // 2
            { type: "text", text: "cd" }, // 2
          ],
        },
      ],
      // JSON.stringify(tools) is 94 chars
      tools: [
        {
          type: "function",
          function: {
            name: "f",
            description: "d",
            parameters: { type: "object" },
          },
        },
      ],
    };

    // (3 + 5 + 0 + 7 + 7 + 4 + 94) / 4 = 120 / 4
    expect(estimateInputTokens(req)).toBe(30);
  });

  it("system text counts once even when both fields carry it", () => {
    // Adapters keep the system text in systemPrompt AND a system-role
    // message — the estimate must not double it.
    const req: CanonicalRequest = {
      model: "m",
      systemPrompt: "SYST", // 4 chars
      messages: [
        { role: "system", content: "SYST" }, // duplicate — not counted
        { role: "user", content: "hi!" }, // 3
      ],
    };

    // (4 + 3) / 4 → 1.75 → 2
    expect(estimateInputTokens(req)).toBe(2);
  });

  it("system-role message text counts when systemPrompt is absent", () => {
    const req: CanonicalRequest = {
      model: "m",
      messages: [
        { role: "system", content: "SYST" }, // 4
        { role: "user", content: "hi!" }, // 3
      ],
    };

    expect(estimateInputTokens(req)).toBe(2);
  });

  it("empty request rounds up to 0", () => {
    expect(estimateInputTokens({ model: "m", messages: [] })).toBe(0);
  });
});
