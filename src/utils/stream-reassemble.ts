import type {
  CanonicalResponse,
  CanonicalStreamEvent,
  CanonicalToolCall,
  CanonicalUsage,
} from "../types/canonical.types";
import { ProxyError, TransformError } from "./errors";

/**
 * Fold a canonical event stream back into a CanonicalResponse — the inverse
 * of streaming, used to compare streams against their non-streaming twins.
 * Throws TransformError when the events break the spec §3.1 stream rules;
 * an `error` event throws a ProxyError carrying that event's kind/status.
 */
export function reassembleStream(
  events: CanonicalStreamEvent[],
): CanonicalResponse {
  let started = false;
  let done = false;
  let id = "";
  let model = "";
  let text = "";
  let usage: CanonicalUsage | undefined;
  let finishReason: CanonicalResponse["finishReason"] | undefined;
  const calls = new Map<
    number,
    { id: string; name: string; args: string; ended: boolean }
  >();
  let nextIndex = 0;

  function fail(why: string): never {
    throw new TransformError(`Invalid canonical stream: ${why}`);
  }

  for (const event of events) {
    if (done) fail(`event "${event.type}" after the stream ended`);
    if (!started && event.type !== "message_start") {
      fail(`event "${event.type}" before message_start`);
    }
    switch (event.type) {
      case "message_start":
        if (started) fail("duplicate message_start");
        started = true;
        id = event.id;
        model = event.model;
        break;
      case "text_delta":
        text += event.text;
        break;
      case "tool_call_start":
        if (event.index !== nextIndex) {
          fail(
            `tool_call_start index ${event.index}, expected ${nextIndex}`,
          );
        }
        calls.set(event.index, {
          id: event.id,
          name: event.name,
          args: "",
          ended: false,
        });
        nextIndex++;
        break;
      case "tool_call_delta": {
        const call = calls.get(event.index);
        if (!call || call.ended) {
          fail(`tool_call_delta for index ${event.index} with no open call`);
        }
        call.args += event.argumentsDelta;
        break;
      }
      case "tool_call_end": {
        const call = calls.get(event.index);
        if (!call || call.ended) {
          fail(`tool_call_end for index ${event.index} with no open call`);
        }
        call.ended = true;
        break;
      }
      case "usage":
        if (usage) fail("duplicate usage event");
        usage = event.usage;
        break;
      case "message_end":
        finishReason = event.finishReason;
        done = true;
        break;
      case "error":
        done = true;
        throw new ProxyError(
          event.error.message,
          event.error.status,
          event.error.kind.toUpperCase(),
        );
    }
  }
  if (!done) fail("stream ended without message_end or error");

  const toolCalls: CanonicalToolCall[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.args },
    }));

  return {
    id,
    model,
    message: {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
    },
    // done without throwing ⇒ a message_end set finishReason
    finishReason: finishReason!,
    ...(usage && { usage }),
  };
}
