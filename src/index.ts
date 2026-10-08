import { app } from "./app";
import { getConfig } from "./config/env-config";
import { logger } from "./utils/logger";

const config = getConfig();
const port = config.port;

app.listen(port, () => {
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
