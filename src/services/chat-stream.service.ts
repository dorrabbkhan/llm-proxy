import {
  adapters,
  PROVIDER_ROUTES,
} from "../transformers";
import { authHeaders } from "../routing/registry";
import type {
  CanonicalStreamEvent,
  StreamDecoder,
} from "../types/canonical.types";
import { UpstreamError } from "../utils/errors";
import { logger } from "../utils/logger";
import { postStream } from "./http-client";
import { runStreamPipeline } from "./stream-pipeline";
import {
  attemptTargets,
  canonicalForTarget,
  toClientFacing,
} from "./attempt-targets";
import type { ChatInput } from "./chat.service";
import type { ProxyResult } from "./proxy.service";

/**
 * Streaming chat over a RoutePlan (spec §3.2): per target — encode the
 * canonical copy, postStream to its stream endpoint, pipe through
 * runStreamPipeline. The postStream call resolves on response headers,
 * so the attempt is what Task 5's fallback decision hangs off. A Gemini
 * target uses the route's streamRequestPath
 * (:streamGenerateContent?alt=sse); the others stream on the chat path.
 */
export async function proxyChatStream(
  input: ChatInput,
): Promise<ProxyResult> {
  const {
    source,
    sourceBody,
    canonical,
    requestedModel,
    plan,
    config,
    requestId,
    opts,
  } = input;

  const encoder = adapters[source].createStreamEncoder({
    sourceRequest: sourceBody,
    query: opts?.query ?? {},
    requestedModel,
  });

  const result = await attemptTargets(
    plan,
    config.registry,
    async (entry, target) => {
      const decoder = adapters[entry.type].createStreamDecoder(
        target.model,
      );
      const targetBody = adapters[entry.type].fromCanonicalRequest(
        canonicalForTarget(canonical, entry, target),
      );
      const targetRoute = PROVIDER_ROUTES[entry.type].find(
        (r) => r.kind === "chat",
      )!;
      const url = `${entry.baseUrl}${
        targetRoute.streamRequestPath?.(target.model) ??
        targetRoute.requestPath(target.model)
      }`;

      logger.info(
        {
          requestId,
          sourceApi: source,
          targetApi: entry.type,
          url,
          model: target.model,
          requestedModel,
          stream: true,
        },
        "Forwarding request to upstream",
      );

      // Client disconnect aborts the upstream request; upstreamAc lets
      // the pipeline's end (terminal event, failure) tear it down too —
      // a bare body cancel doesn't reach the request on every transport.
      const upstreamAc = new AbortController();
      const upstream = await postStream({
        url,
        headers: authHeaders(entry),
        body: targetBody,
        timeoutMs: entry.timeoutMs ?? config.upstreamTimeoutMs,
        retries: config.upstreamRetries,
        requestId,
        signal: opts?.signal
          ? AbortSignal.any([opts.signal, upstreamAc.signal])
          : upstreamAc.signal,
      }).catch((err) => {
        throw err instanceof UpstreamError
          ? toClientFacing(err, entry.type)
          : err;
      });

      return { upstream, upstreamAc, decoder };
    },
    { requestId, signal: opts?.signal },
  );

  const { upstream, upstreamAc, decoder } = result.value;
  const targetApi = result.entry.type;
  const model = result.target.model;

  // Watch the event stream for the completion log line — the pipeline
  // yields only encoded bytes, so the decoder is wrapped. Chunk contents
  // are never logged (§3.2); only usage and the finish reason are.
  const observed: CanonicalStreamEvent[] = [];
  const recordingDecoder: StreamDecoder = {
    feed(chunk) {
      const events = decoder.feed(chunk);
      observed.push(...events);
      return events;
    },
    end() {
      const events = decoder.end();
      observed.push(...events);
      return events;
    },
  };

  const signal = opts?.signal ?? new AbortController().signal;

  const chunks = (async function* (): AsyncGenerator<string> {
    try {
      yield* runStreamPipeline({
        upstream: upstream.body,
        decoder: recordingDecoder,
        encoder,
        idleMs: result.entry.streamIdleMs ?? config.upstreamStreamIdleMs,
        signal,
      });
    } finally {
      // Whatever ended the pipe — terminal event, in-stream error,
      // client disconnect — the upstream request is done with.
      upstreamAc.abort();
    }
    const last = observed.at(-1);
    if (last?.type === "message_end") {
      const usageEvent = observed.find((e) => e.type === "usage");
      logger.info(
        {
          requestId,
          sourceApi: source,
          targetApi,
          model,
          requestedModel,
          stream: true,
          inputTokens:
            usageEvent?.type === "usage"
              ? usageEvent.usage.inputTokens
              : undefined,
          outputTokens:
            usageEvent?.type === "usage"
              ? usageEvent.usage.outputTokens
              : undefined,
          finishReason: last.finishReason,
          upstreamDurationMs: upstream.durationMs,
        },
        "Request completed",
      );
    }
  })();

  return { stream: { contentType: encoder.contentType, chunks } };
}
