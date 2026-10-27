import { once } from "node:events";
import { Router } from "express";
import { proxyRequest } from "../services/proxy.service";
import { ProxyError, TransformError } from "../utils/errors";

/**
 * Thin HTTP adapter — all orchestration lives in proxy.service.
 * Returns null from the service → next() → 404 handler.
 */
export const proxyRouter = Router();

proxyRouter.use(async (req, res, next) => {
  // Client disconnect mid-request → abort the upstream call. On a
  // completed response "close" still fires, so guard on completion.
  const ac = new AbortController();
  let completed = false;
  res.on("close", () => {
    if (!completed) ac.abort();
  });

  try {
    const result = await proxyRequest(
      req.path,
      req.method,
      req.body,
      String(req.id),
      {
        query: Object.fromEntries(
          Object.entries(req.query).map(([k, v]) => [k, String(v)]),
        ),
        signal: ac.signal,
      },
    );
    if (!result) return next();

    if (result.headers) {
      for (const [name, value] of Object.entries(result.headers)) {
        res.setHeader(name, value);
      }
    }

    if (result.stream) {
      // spec §3.2: headers once, before the first write; honour
      // backpressure; never write after the client went away.
      res.status(200);
      res.setHeader("Content-Type", result.stream.contentType);
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      for await (const chunk of result.stream.chunks) {
        if (res.writableEnded || res.destroyed) break;
        if (!res.write(chunk)) {
          await Promise.race([once(res, "drain"), once(res, "close")]);
        }
      }
      completed = true;
      res.end();
      return;
    }

    res.status(200).json(result.body);
  } catch (err) {
    // The client went away mid-request — nothing left to answer.
    if (ac.signal.aborted) return;
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
