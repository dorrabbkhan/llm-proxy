import express from "express";
import { config } from "./config/env-config";

const app = express();

app.get("/health", (_, res) => {
  res.status(200).send("OK");
});

app.use((_, res) => {
  res.status(404).send("Not Found");
});

app.listen(config.port || 3000, () => {
  console.log(`Server started on port ${config.port || 3000}`);
  console.log(`Source API: ${config.sourceApi}`);
  console.log(`Target API: ${config.targetApi}`);
  console.log(
    `Target API Key: ${config.targetApiKey ? "****" : "Not configured"}`
  );
});
