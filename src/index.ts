import type { Server } from "node:http";
import { app } from "./app";
import { getConfig } from "./config/env-config";
import { logger } from "./utils/logger";

/**
 * Starts the proxy and resolves once it is listening. Importing this module
 * has no side effects — the server only starts when startServer() is called
 * (or when index.js is run directly, for `npm start` / `npm run dev`).
 */
export function startServer(): Promise<Server> {
  const config = getConfig();
  const port = config.port;

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info(
        {
          port,
          sourceApi: config.sourceApi,
          targetApi: config.targetApi,
          targetBaseUrl: config.targetBaseUrl,
          targetApiKey: config.targetApiKey ? "****" : "Not configured",
        },
        "Server started",
      );
      resolve(server);
    });
    server.on("error", reject);

    // Graceful shutdown — drain in-flight requests instead of killing them
    // mid-generation. server.close() stops accepting new connections and
    // resolves once active requests finish; the timer is the escape hatch.
    function shutdown(signal: string): void {
      logger.info({ signal }, "Shutting down");
      server.close(() => {
        logger.info("All connections drained");
        process.exit(0);
      });
      setTimeout(() => {
        logger.warn("Forcing exit — connections did not drain in time");
        process.exit(1);
      }, 10_000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}

if (require.main === module) {
  try {
    getConfig();
  } catch (err) {
    logger.fatal({ err }, "Invalid configuration — check required env vars");
    process.exit(1);
  }
  startServer().catch((err) => {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  });
}
