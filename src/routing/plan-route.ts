import { globMatch, parseTarget } from "./rules";

/** One provider/model pair a request can be sent to. */
export interface RouteTarget {
  provider: string;
  model: string;
}

/** An ordered routing rule: glob `match` → target `to`. */
export interface RouteRule {
  match: string;
  when?: { minInputTokens?: number };
  to: RouteTarget;
  fallback: RouteTarget[];
}

/** Routing section of the gateway config. */
export interface RoutingConfig {
  defaultProvider: string;
  aliases: Record<string, RouteTarget>;
  rules: RouteRule[];
}

/**
 * Ordered route targets for one request: first is primary, the rest are
 * fallbacks. `reason` names the resolution step that produced the plan.
 */
export interface RoutePlan {
  targets: RouteTarget[];
  reason: string;
}

export interface PlanRouteInput {
  /** Body model, or Gemini's path model — the name the client asked for */
  requestedModel: string;
  /** estimateInputTokens(canonical), computed once by the caller */
  estimatedInputTokens: number;
  routing: RoutingConfig;
  providerNames: ReadonlySet<string>;
}

/**
 * Pure model → route resolution (spec §3.3): no I/O, clock or
 * randomness. Resolution order:
 *   1. explicit `provider/model` (first-`/` prefix is a registered
 *      provider) — rules are skipped;
 *   2. alias — exact, case-sensitive name;
 *   3. routes in order — first `match` glob whose `when` also holds;
 *   4. the default provider, model unchanged.
 * `targets` is the matched target followed by its fallback list;
 * explicit, alias and default plans carry no fallbacks.
 */
export function planRoute(input: PlanRouteInput): RoutePlan {
  const explicit = parseTarget(input.requestedModel, input.providerNames);
  if (explicit !== undefined) {
    return { targets: [explicit], reason: "explicit" };
  }

  const alias = input.routing.aliases[input.requestedModel];
  if (alias !== undefined) {
    return { targets: [alias], reason: `alias:${input.requestedModel}` };
  }

  for (const [index, rule] of input.routing.rules.entries()) {
    if (!globMatch(rule.match, input.requestedModel)) continue;
    const min = rule.when?.minInputTokens;
    if (min !== undefined && input.estimatedInputTokens < min) continue;
    return {
      targets: [rule.to, ...rule.fallback],
      reason: `rule:${index}`,
    };
  }

  return {
    targets: [
      {
        provider: input.routing.defaultProvider,
        model: input.requestedModel,
      },
    ],
    reason: "default",
  };
}
