import type { ProviderEntry, ProviderRegistry } from "../routing/registry";
import type { RoutePlan, RouteTarget } from "../routing/plan-route";
import type { Provider } from "../transformers";
import type { CanonicalRequest } from "../types/canonical.types";
import { UpstreamError } from "../utils/errors";
import { toClientError } from "./upstream-errors";

/** One tried target in a route plan (spec §3.4 route log line). */
export interface Hop {
  provider: string;
  model: string;
  outcome: "ok" | "http_error" | "timeout" | "transport";
  status?: number;
  ms: number;
}

export interface AttemptResult<T> {
  value: T;
  target: RouteTarget;
  entry: ProviderEntry;
  hops: Hop[];
}

/**
 * Attach the spec §3.3 client-facing rendering to an upstream failure
 * (moved from proxy.service). Only real upstream error statuses (≥ 400)
 * go through the mapping table — timeouts, transport failures and
 * non-JSON 2xx replies already carry their final client-facing message.
 */
export function toClientFacing(
  err: UpstreamError,
  target: Provider,
): UpstreamError {
  if (err.upstreamStatus !== undefined && err.upstreamStatus >= 400) {
    err.clientError = toClientError(
      target,
      err.upstreamStatus,
      err.upstreamBody,
      err.retryAfterSeconds,
    );
  }
  return err;
}

/**
 * The canonical request this attempt sends upstream: the routed model
 * and the target provider's contextWindow (unset → config untouched,
 * spec §3.1), set on a COPY — the decoded request is never mutated.
 */
export function canonicalForTarget(
  canonical: CanonicalRequest,
  entry: ProviderEntry,
  target: RouteTarget,
): CanonicalRequest {
  const out: CanonicalRequest = { ...canonical, model: target.model };
  if (entry.contextWindow !== undefined) {
    out.config = { ...canonical.config, contextWindow: entry.contextWindow };
  }
  return out;
}

/**
 * The fallback loop shared by both chat services (spec §3.4). Task 1
 * tries `plan.targets[0]` only and rethrows its error unchanged;
 * Task 5 adds fallback hops and outcome classification.
 */
export async function attemptTargets<T>(
  plan: RoutePlan,
  registry: ProviderRegistry,
  attempt: (entry: ProviderEntry, target: RouteTarget) => Promise<T>,
  ctx: { requestId: string; signal?: AbortSignal },
): Promise<AttemptResult<T>> {
  const target = plan.targets[0]!;
  const entry = registry.get(target.provider);
  const start = Date.now();
  const value = await attempt(entry, target);
  return {
    value,
    target,
    entry,
    hops: [
      {
        provider: target.provider,
        model: target.model,
        outcome: "ok",
        ms: Date.now() - start,
      },
    ],
  };
}
