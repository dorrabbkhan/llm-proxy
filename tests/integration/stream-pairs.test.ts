import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { setupServer } from "msw/node";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../../src/app";
import { resetConfig } from "../../src/config/env-config";
import { PROVIDER_PATHS, type Provider } from "../../src/transformers";
import { reassembleStream } from "../../src/utils/stream-reassemble";
import type { CanonicalStreamEvent } from "../../src/types/canonical.types";
import {
  upstreamHandlers,
  capturedRequests,
  resetCaptured,
  resetOverrides,
  resetStreamCase,
  streamCase,
  nonStreamBody,
  MOCK_BASE_URLS,
} from "../mocks/upstreams";
import openaiFixtures from "../fixtures/openai.json";
import anthropicFixtures from "../fixtures/anthropic.json";

/**
 * Launch-pair matrix (spec §4.5, §5): every launch pair ×
 * {text, tool_call, parallel_tool_calls, after_tool_result} ×
 * {stream, non-stream}. The msw upstream serves the recorded stream
 * corpus for streaming requests and the matching non-stream body
 * otherwise (see tests/mocks/upstreams.ts). For each cell the client
 * must receive its own dialect; tool cases keep the upstream's call
 * names and ids with parsed arguments and distinct ids; and
 * after_tool_result's tool result must reach the upstream request in
 * the target's dialect.
 *
 * Task 17 replaces LAUNCH_PAIRS with all 16 pairs.
 */
const LAUNCH_PAIRS: [Provider, Provider][] = [
  ["anthropic", "ollama"],
  ["anthropic", "openai"],
  ["openai", "ollama"],
];

const CASES = [
  "text",
  "tool_call",
  "parallel_tool_calls",
  "after_tool_result",
] as const;
type Case = (typeof CASES)[number];

const STREAMS_DIR = join(__dirname, "..", "fixtures", "streams");
const TOOL_RESULT_TEXT = "72°F and sunny";

// The call id each launch source sends in its after_tool_result request.
const CLIENT_CALL_ID: Partial<Record<Provider, string>> = {
  openai: "call_1",
  anthropic: "toolu_1",
};

const SOURCE_FIXTURES: Partial<
  Record<Provider, { requests: Record<string, unknown> }>
> = {
  openai: openaiFixtures,
  anthropic: anthropicFixtures,
};

const server = setupServer(...upstreamHandlers);

function setPair(source: Provider, target: Provider): void {
  process.env.SOURCE_API = source;
  process.env.TARGET_API = target;
  resetConfig();
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  for (const p of [
    "openai",
    "gemini",
    "ollama",
    "anthropic",
  ] as Provider[]) {
    process.env[`${p.toUpperCase()}_API_BASE_URL`] = MOCK_BASE_URLS[p];
    process.env[`${p.toUpperCase()}_API_KEY`] = "test-key";
  }
});

beforeEach(() => {
  process.env.UPSTREAM_RETRIES = "0";
});

afterEach(() => {
  server.resetHandlers();
  resetCaptured();
  resetOverrides();
  resetStreamCase();
  delete process.env.UPSTREAM_RETRIES;
});

afterAll(() => {
  server.close();
});

/** supertest parses SSE/NDJSON as an opaque body — collect it as text. */
function postStream(path: string, body: unknown): request.Test {
  return request(app)
    .post(path)
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => cb(null, text));
    });
}

// ---------- client request bodies ----------

function toolResultRequest(source: Provider): Record<string, unknown> {
  const tools = (
    SOURCE_FIXTURES[source]!.requests.tools as { tools: unknown[] }
  ).tools;
  const callId = CLIENT_CALL_ID[source]!;
  if (source === "openai") {
    return {
      model: "gpt-4",
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location":"Paris"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: callId,
          content: TOOL_RESULT_TEXT,
        },
      ],
      tools,
    };
  }
  if (source === "anthropic") {
    return {
      model: "claude-3-opus-20240229",
      max_tokens: 1024,
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: callId,
              name: "get_weather",
              input: { location: "Paris" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: callId,
              content: TOOL_RESULT_TEXT,
            },
          ],
        },
      ],
      tools,
    };
  }
  throw new Error(`no tool-result request builder for source ${source}`);
}

function clientRequest(
  source: Provider,
  caseName: Case,
  streaming: boolean,
): { path: string; body: Record<string, unknown> } {
  const base =
    caseName === "after_tool_result"
      ? toolResultRequest(source)
      : caseName === "text"
        ? SOURCE_FIXTURES[source]!.requests.basic
        : SOURCE_FIXTURES[source]!.requests.tools;
  return {
    path: PROVIDER_PATHS[source].pathPrefix,
    body: {
      ...(base as Record<string, unknown>),
      ...(streaming && { stream: true }),
    },
  };
}

// ---------- expected values, from the oracle ----------

interface ExpectedCall {
  id?: string;
  name?: string;
  args: unknown;
}

interface StreamFixture {
  expectedEvents: CanonicalStreamEvent[];
}

function streamFixture(provider: Provider, caseName: Case): StreamFixture {
  return JSON.parse(
    readFileSync(join(STREAMS_DIR, provider, `${caseName}.json`), "utf8"),
  ) as StreamFixture;
}

/** The calls the upstream reply carries, in the comparison shape. */
function expectedCalls(
  target: Provider,
  caseName: Case,
  streaming: boolean,
): ExpectedCall[] {
  if (streaming) {
    const response = reassembleStream(
      streamFixture(target, caseName).expectedEvents,
    );
    return (response.message.toolCalls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));
  }
  return providerCalls(target, nonStreamBody(target));
}

function expectedText(
  target: Provider,
  caseName: Case,
  streaming: boolean,
): string {
  if (streaming) {
    return reassembleStream(streamFixture(target, caseName).expectedEvents)
      .message.content as string;
  }
  return providerText(target, nonStreamBody(target));
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tool calls carried by a provider-dialect response body. */
function providerCalls(provider: Provider, body: unknown): ExpectedCall[] {
  const b = body as any;
  switch (provider) {
    case "openai":
      return (b.choices?.[0]?.message?.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        args: JSON.parse(tc.function?.arguments ?? "null"),
      }));
    case "ollama":
      return (b.message?.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        args: tc.function?.arguments,
      }));
    case "anthropic":
      return (b.content ?? [])
        .filter((bl: any) => bl.type === "tool_use")
        .map((bl: any) => ({ id: bl.id, name: bl.name, args: bl.input }));
    case "gemini":
      return (b.candidates?.[0]?.content?.parts ?? [])
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({
          id: p.functionCall.id,
          name: p.functionCall.name,
          args: p.functionCall.args,
        }));
  }
}

function providerText(provider: Provider, body: unknown): string {
  const b = body as any;
  switch (provider) {
    case "openai":
      return b.choices?.[0]?.message?.content ?? "";
    case "ollama":
      return b.message?.content ?? "";
    case "anthropic":
      return (b.content ?? [])
        .filter((x: any) => x.type === "text")
        .map((x: any) => x.text ?? "")
        .join("");
    case "gemini":
      return (b.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? "")
        .join("");
  }
}

// ---------- client reply parsers (source dialects) ----------

interface ClientCall {
  id?: string;
  name?: string;
  args: unknown;
}

interface ClientReply {
  text: string;
  calls: ClientCall[];
}

function clientJsonReply(source: Provider, body: any): ClientReply {
  switch (source) {
    case "openai": {
      const msg = body.choices?.[0]?.message ?? {};
      return {
        text: msg.content ?? "",
        calls: (msg.tool_calls ?? []).map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          args: JSON.parse(tc.function?.arguments ?? "null"),
        })),
      };
    }
    case "anthropic": {
      const blocks: any[] = body.content ?? [];
      return {
        text: blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(""),
        calls: blocks
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, args: b.input })),
      };
    }
    default:
      throw new Error(`no reply parser for source ${source}`);
  }
}

function clientStreamReply(source: Provider, wire: string): ClientReply {
  switch (source) {
    case "openai": {
      let text = "";
      const calls = new Map<
        number,
        { id?: string; name?: string; args: string }
      >();
      for (const line of wire.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).replace(/^ /, "");
        if (data === "" || data === "[DONE]") continue;
        const chunk = JSON.parse(data);
        for (const choice of chunk.choices ?? []) {
          if (typeof choice.delta?.content === "string") {
            text += choice.delta.content;
          }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const c = calls.get(tc.index) ?? { args: "" };
            if (typeof tc.id === "string") c.id = tc.id;
            if (typeof tc.function?.name === "string") {
              c.name = tc.function.name;
            }
            c.args += tc.function?.arguments ?? "";
            calls.set(tc.index, c);
          }
        }
      }
      return {
        text,
        calls: [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, c]) => ({
            id: c.id,
            name: c.name,
            args: JSON.parse(c.args),
          })),
      };
    }
    case "anthropic": {
      let text = "";
      const calls: { id?: string; name?: string; args: string }[] = [];
      const byBlock = new Map<
        number,
        { id?: string; name?: string; args: string }
      >();
      for (const frame of wire.split(/\r?\n\r?\n/)) {
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        const evt = JSON.parse(data);
        if (
          evt.type === "content_block_start" &&
          evt.content_block?.type === "tool_use"
        ) {
          const c = {
            id: evt.content_block.id,
            name: evt.content_block.name,
            args: "",
          };
          calls.push(c);
          byBlock.set(evt.index, c);
        } else if (evt.type === "content_block_delta") {
          if (evt.delta?.type === "text_delta") text += evt.delta.text;
          if (evt.delta?.type === "input_json_delta") {
            byBlock.get(evt.index)!.args += evt.delta.partial_json;
          }
        }
      }
      return {
        text,
        calls: calls.map((c) => ({
          id: c.id,
          name: c.name,
          args: JSON.parse(c.args),
        })),
      };
    }
    default:
      throw new Error(`no stream parser for source ${source}`);
  }
}

// ---------- shape and upstream assertions ----------

function assertSourceFormat(
  source: Provider,
  streaming: boolean,
  res: request.Response,
): void {
  if (!streaming) {
    if (source === "openai") {
      expect(res.body.object).toBe("chat.completion");
    } else if (source === "anthropic") {
      expect(res.body.type).toBe("message");
      expect(res.body.role).toBe("assistant");
    } else if (source === "ollama") {
      expect(res.body.message).toBeDefined();
      expect(typeof res.body.done).toBe("boolean");
    } else if (source === "gemini") {
      expect(Array.isArray(res.body.candidates)).toBe(true);
    }
    return;
  }
  const wire = res.body as string;
  if (source === "openai") {
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(wire).toContain("data: {");
    expect(wire.trimEnd().endsWith("data: [DONE]")).toBe(true);
  } else if (source === "anthropic") {
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(wire).toContain("event: message_start");
    expect(
      wire.trimEnd().endsWith('data: {"type":"message_stop"}'),
    ).toBe(true);
  } else if (source === "ollama") {
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const lines = wire.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) JSON.parse(line);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ done: true });
  } else if (source === "gemini") {
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(wire).toContain("data: {");
  }
}

/** The upstream request must carry the tool definitions in its dialect. */
function assertToolsForwarded(target: Provider): void {
  const tools = (capturedRequests[target][0] as any)?.tools;
  const names = (tools ?? []).map(
    (t: any) => t.function?.name ?? t.name,
  );
  expect(names).toContain("get_weather");
}

/** The upstream request must carry the client's tool result. */
function assertToolResultForwarded(
  target: Provider,
  source: Provider,
): void {
  const messages = (capturedRequests[target][0] as any)?.messages ?? [];
  expect(
    messages.some((m: any) =>
      (m.tool_calls ?? []).some(
        (tc: any) => tc.function?.name === "get_weather",
      ),
    ),
    "upstream request carries the assistant tool call",
  ).toBe(true);
  const toolMsg = messages.find(
    (m: any) =>
      m.role === "tool" ||
      (Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_result")),
  );
  expect(
    toolMsg,
    "upstream request carries the tool result",
  ).toBeDefined();
  const content =
    typeof toolMsg.content === "string"
      ? toolMsg.content
      : (toolMsg.content ?? [])
          .map((b: any) => b.text ?? b.content ?? "")
          .join("");
  expect(content).toBe(TOOL_RESULT_TEXT);
  if (target === "openai") {
    expect(toolMsg.tool_call_id).toBe(CLIENT_CALL_ID[source]);
  }
  if (target === "ollama") {
    expect(toolMsg.tool_name).toBe("get_weather");
  }
}

// ---------- the matrix ----------

const matrix = LAUNCH_PAIRS.flatMap(([source, target]) =>
  CASES.flatMap((caseName) =>
    [true, false].map((streaming) => ({
      source,
      target,
      caseName,
      streaming,
    })),
  ),
);

describe("launch-pair matrix (spec §4.5)", () => {
  it.each(matrix)(
    "$source → $target $caseName stream=$streaming",
    async ({ source, target, caseName, streaming }) => {
      setPair(source, target);
      streamCase[target] = caseName;
      const { path, body } = clientRequest(source, caseName, streaming);

      const res = streaming
        ? await postStream(path, body)
        : await request(app).post(path).send(body);

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      assertSourceFormat(source, streaming, res);

      const reply = streaming
        ? clientStreamReply(source, res.body as string)
        : clientJsonReply(source, res.body);

      if (caseName === "text" || caseName === "after_tool_result") {
        expect(reply.calls).toEqual([]);
        expect(reply.text).toBe(
          expectedText(target, caseName, streaming),
        );
      } else {
        const expected = expectedCalls(target, caseName, streaming);
        expect(reply.calls).toEqual(expected);
        expect(new Set(reply.calls.map((c) => c.id)).size).toBe(
          reply.calls.length,
        );
      }

      if (caseName === "text") return;

      assertToolsForwarded(target);
      if (caseName === "after_tool_result") {
        assertToolResultForwarded(target, source);
      }
    },
  );
});
