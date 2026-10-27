import type { RequestHandler } from "express";
import { getConfig } from "../config/env-config";
import { findSourceRoute } from "../transformers/adapters";

/**
 * Records the configured source provider on `res.locals.sourceApi` when
 * the request matches one of its routes, so the error handler can render
 * errors — including auth and body-parser errors — in that provider's
 * dialect (spec §3.3). Mounted before the body parser and auth.
 *
 * Never throws: a broken config just leaves `sourceApi` unset and errors
 * keep the generic shape.
 */
export function resolveSource(): RequestHandler {
  return (req, res, next) => {
    try {
      const { sourceApi } = getConfig();
      if (findSourceRoute(sourceApi, req.method, req.path)) {
        res.locals.sourceApi = sourceApi;
      }
    } catch {
      // config unavailable — sourceApi stays unset
    }
    next();
  };
}
