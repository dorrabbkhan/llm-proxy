import express from "express";
import { requestLogger } from "./middleware/request-logger";
import { errorHandler } from "./middleware/error-handler";
import { requireApiKey } from "./middleware/require-api-key";
import { proxyRouter } from "./routes/proxy";

const app = express();

// 1. Request logger - logs every incoming request
app.use(requestLogger);

// 2. Body parser - parses application/json. LLM payloads (base64
// images, long context) routinely exceed the 100kb default.
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "10mb" }));

// 3. Routes
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// 3a. Client auth — active only when PROXY_API_KEY is set.
// /health above stays open for probes.
app.use(requireApiKey(process.env.PROXY_API_KEY || undefined));

// 3b. Proxy routes - transforms and forwards LLM API requests
app.use(proxyRouter);

// 4. 404 handler - catch unmatched routes
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { message: "Not Found", code: "NOT_FOUND", status: 404 } });
});

// 5. Error handler - must be last
app.use(errorHandler);

export { app };
