import { once } from "node:events";
import { Router } from "express";
import { proxyRequest } from "../services/proxy.service";
import type { Provider } from "../transformers";
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
        // Client format detected by the middleware; undefined → the
        // service returns null → 404.
        source: res.locals.sourceApi as Provider | undefined,
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

      // One close promise for the whole loop — racing a fresh
      // `once(res, "close")` per backpressured write leaks listeners.
      const closed = new Promise<void>((resolve) => {
        res.once("close", resolve);
      });
      for await (const chunk of result.stream.chunks) {
        if (res.writableEnded || res.destroyed) break;
        if (!res.write(chunk)) {
          await Promise.race([once(res, "drain"), closed]);
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
    // Headers already went out: a JSON error can't be rendered onto a
    // streaming response — end it rather than calling next(err).
    if (res.headersSent) {
      res.destroy();
      return;
    }
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
