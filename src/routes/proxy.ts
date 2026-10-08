import { Router } from "express";
import { proxyRequest } from "../services/proxy.service";
import { ProxyError, TransformError } from "../utils/errors";

/**
 * Thin HTTP adapter — all orchestration lives in proxy.service.
 * Returns null from the service → next() → 404 handler.
 */
export const proxyRouter = Router();

proxyRouter.use(async (req, res, next) => {
  try {
    const result = await proxyRequest(req.path, req.body, String(req.id));
    if (!result) return next();
    res.status(200).json(result.body);
  } catch (err) {
    next(
      err instanceof ProxyError
        ? err
        : new TransformError(
            err instanceof Error ? err.message : "Unknown proxy error",
            { requestId: req.id },
          ),
    );
  }
});
