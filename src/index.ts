import { app } from "./app";
import { config } from "./config/env-config";
import { logger } from "./utils/logger";

const port = config.port || 3000;

app.listen(port, () => {
  logger.info(
    {
      port,
      sourceApi: config.sourceApi,
      targetApi: config.targetApi,
      targetApiKey: config.targetApiKey ? "****" : "Not configured",
    },
    "Server started",
  );
});
