import type { RequestHandler } from "express";
import { detectSource } from "../routing/detect-source";

/**
 * Records the detected client format on `res.locals.sourceApi` so the
 * proxy route and the error handler use the request's own dialect
 * (spec §3.2). Mounted before the body parser and auth so their errors
 * render in the detected dialect too. Reads no config — detection is
 * pure method + path + headers.
 */
export function detectSourceMiddleware(): RequestHandler {
  return (req, res, next) => {
    const sourceApi = detectSource(req.method, req.path, req.headers);
    if (sourceApi) {
      res.locals.sourceApi = sourceApi;
    }
    next();
  };
}
