import { globMatch } from "./rules";

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
 * randomness. Task 1 implements steps 3–4 only — the first rule whose
 * `match` glob matches wins (when/fallback ignored), then the default
 * provider with the model unchanged. Explicit `provider/model` targets
 * and aliases arrive with Task 3.
 */
export function planRoute(input: PlanRouteInput): RoutePlan {
  for (const [index, rule] of input.routing.rules.entries()) {
    if (globMatch(rule.match, input.requestedModel)) {
      return { targets: [rule.to], reason: `rule:${index}` };
    }
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
