import express from 'express';
import { requestLogger } from './middleware/request-logger';
import { errorHandler } from './middleware/error-handler';

const app = express();

// 1. Request logger - logs every incoming request
app.use(requestLogger);

// 2. Body parser - parses application/json
app.use(express.json());

// 3. Routes
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 4. 404 handler - catch unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: { message: 'Not Found', code: 'NOT_FOUND', status: 404 } });
});

// 5. Error handler - must be last
app.use(errorHandler);

export { app };
