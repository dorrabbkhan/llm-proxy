import { app } from "./app";
import { getConfig, type Config } from "./config/env-config";
import { logger } from "./utils/logger";

let config: Config;
try {
  config = getConfig();
} catch (err) {
  logger.fatal({ err }, "Invalid configuration — check required env vars");
  process.exit(1);
}

const port = config.port;

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
});

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
