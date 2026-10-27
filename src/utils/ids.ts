import { randomBytes } from "crypto";
import type { IdGenerator } from "../types/canonical.types";

/**
 * Random-suffix ID generator (spec §3.4: `call_<n>`-style generated
 * tool-call IDs) — the default injected into decoders/adapters.
 */
export function createIdGenerator(prefix = "call_"): IdGenerator {
  return () => `${prefix}${randomBytes(9).toString("base64url")}`;
}

/** Deterministic `call_0`, `call_1`, … — used in tests and fixtures. */
export function sequentialIds(prefix = "call_"): IdGenerator {
  let next = 0;
  return () => `${prefix}${next++}`;
}
