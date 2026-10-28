# Recipe: OpenAI-SDK apps on any backend through babelgate

Anything that speaks the OpenAI API — the Python/JS SDKs, Open WebUI,
LangChain, Cursor-style apps — can sit in front of babelgate and run on
Ollama, an OpenAI-compatible backend, or another provider babelgate
targets. Streaming and tool calls work.

## Start the proxy

```bash
# Ollama target
OLLAMA_API_BASE_URL=http://localhost:11434 \
  npx babelgate --preset openai-apps --target ollama

# …or an OpenAI-compatible backend (OpenRouter shown)
OPENAI_API_KEY=<your OpenRouter key> \
  npx babelgate --preset openai-apps --target openai \
  --base-url https://openrouter.ai/api
```

babelgate prints:

```
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=babelgate
```

`OPENAI_API_KEY=babelgate` is a placeholder for local dev — with
`PROXY_API_KEY` unset the proxy doesn't authenticate clients. Set
`PROXY_API_KEY` and the printed line carries that key instead.

## Point the SDK at it

Python:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="babelgate",
)
resp = client.chat.completions.create(
    model="qwen3-coder:30b",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="")
```

Or curl:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer babelgate" \
  -d '{"model": "qwen3-coder:30b",
       "messages": [{"role": "user", "content": "Hello"}],
       "stream": true}'
```

`GET /v1/models` works too — the upstream catalog is translated into
OpenAI's list shape, so model dropdowns in apps populate.

## Model names

The model in the request is forwarded to the target unchanged. So the
name must mean something to the target (`qwen3-coder:30b` to Ollama,
`qwen/qwen3-coder` to OpenRouter) — or rename it with `MODEL_MAP`:

```bash
MODEL_MAP="gpt-*=qwen3-coder:30b,*=qwen3-coder:30b" \
OLLAMA_API_BASE_URL=http://localhost:11434 \
  npx babelgate --preset openai-apps --target ollama
```

Rules are ordered `glob=model`, comma-separated; the first match wins.
Replies carry the name the client asked for, either way.

## What works, what doesn't

- **Streaming** (`stream: true`) — SSE in OpenAI's chunk format, whatever
  the target's wire protocol.
- **Tools** — `tools`, `tool_choice` (`auto`/`none`/`required`/named),
  parallel calls and `role: "tool"` results translate through canonical.
  `parallel_tool_calls` is accepted but ignored (targets get their
  defaults).
- **Errors** arrive in OpenAI's error shape, so `openai.APIError`
  subclasses raise as usual — including in-stream error events.
- **Ollama caveat:** a request that omits `stream` gets a single JSON
  reply (Ollama's own API streams by default; babelgate doesn't mimic
  that — send `"stream": true` or `"stream": false` explicitly).
- See the README's Known limitations for what's intentionally unmapped.
