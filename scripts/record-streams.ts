/**
 * record-streams.ts — record the Ollama stream fixtures (spec §4.1).
 *
 *   npm run record:streams
 *
 * Opt-in, real network. Requires OLLAMA_API_BASE_URL to be reachable and a
 * tool-capable model in RECORD_OLLAMA_MODEL (default "qwen2.5:7b"). Writes
 * raw NDJSON bytes to tests/fixtures/streams/ollama/<case>.ndjson and the
 * non-streamed twin response to <case>.nonstreaming.json. The <case>.json
 * files (source/date/expectedEvents) are authored by hand from these bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.OLLAMA_API_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.RECORD_OLLAMA_MODEL ?? "qwen2.5:7b";
const OUT_DIR = join(__dirname, "..", "tests", "fixtures", "streams", "ollama");

const GET_WEATHER = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    },
  },
};

interface Case {
  request: Record<string, unknown>;
}

const CASES: Record<string, Case> = {
  text: {
    request: {
      messages: [
        { role: "user", content: "Reply with exactly one word: hello" },
      ],
      options: { temperature: 0, num_predict: 32 },
    },
  },
  tool_call: {
    request: {
      messages: [
        { role: "user", content: "What is the weather in Paris?" },
      ],
      tools: [GET_WEATHER],
      options: { temperature: 0 },
    },
  },
  parallel_tool_calls: {
    request: {
      messages: [
        {
          role: "user",
          content:
            "What is the weather in Paris and what is the weather in London?",
        },
      ],
      tools: [GET_WEATHER],
      options: { temperature: 0 },
    },
  },
  after_tool_result: {
    request: {
      messages: [
        { role: "user", content: "What is the weather in Paris?" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_0",
              function: {
                index: 0,
                name: "get_weather",
                arguments: { location: "Paris" },
              },
            },
          ],
        },
        { role: "tool", content: "15 degrees Celsius, partly cloudy" },
      ],
      tools: [GET_WEATHER],
      options: { temperature: 0, num_predict: 64 },
    },
  },
  max_tokens: {
    request: {
      messages: [{ role: "user", content: "Count from 1 to 50." }],
      options: { temperature: 0, num_predict: 5 },
    },
  },
  error: {
    request: {
      model: `${MODEL}-does-not-exist`,
      messages: [{ role: "user", content: "hi" }],
    },
  },
};

async function main(): Promise<void> {
  let version = "unknown";
  try {
    const res = await fetch(`${BASE_URL}/api/version`);
    if (res.ok) version = (await res.json()).version ?? version;
  } catch {
    // reported below on the first chat request
  }
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`recording against ollama ${version} at ${BASE_URL}, model ${MODEL}`);

  for (const [name, c] of Object.entries(CASES)) {
    for (const stream of [true, false] as const) {
      const body = {
        model: MODEL,
        stream,
        ...(c.request as Record<string, unknown>),
      };
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (stream) {
        writeFileSync(join(OUT_DIR, `${name}.ndjson`), text);
        console.log(`${name}.ndjson <- HTTP ${res.status} (${text.length} bytes)`);
      } else {
        writeFileSync(join(OUT_DIR, `${name}.nonstreaming.json`), text);
        console.log(
          `${name}.nonstreaming.json <- HTTP ${res.status} (${text.length} bytes)`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(`record:streams failed: ${err}`);
  process.exit(1);
});
