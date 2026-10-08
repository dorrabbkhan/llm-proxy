import { ErrorRequestHandler } from "express";
import { logger } from "../utils/logger";
import { ProxyError } from "../utils/errors";

interface ErrorResponse {
  error: {
    message: string;
    code: string;
    status: number;
    details?: unknown;
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isProduction = process.env.NODE_ENV === "production";
  const requestId = req.id;

  if (err instanceof ProxyError) {
    logger.error(
      {
        requestId,
        code: err.code,
        statusCode: err.statusCode,
        context: err.context,
        stack: err.stack,
      },
      err.message,
    );

    const response: ErrorResponse = err.toJSON();
    res.status(err.statusCode).json(response);
    return;
  }

  logger.error(
    {
      requestId,
      err,
    },
    "Unhandled error",
  );

  const response: ErrorResponse = {
    error: {
      message: isProduction ? "Internal Server Error" : err.message,
      code: "INTERNAL_ERROR",
      status: 500,
      ...(!isProduction && { details: { stack: err.stack } }),
    },
  };

  res.status(500).json(response);
};
