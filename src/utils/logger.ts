import pino from "pino";

function canResolvePinoPretty(): boolean {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

export function loggerOptions(
  env: NodeJS.ProcessEnv,
  canResolve: () => boolean,
): pino.LoggerOptions {
  const isProduction = env.NODE_ENV === "production";
  return {
    level: env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    transport:
      !isProduction && canResolve()
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  };
}

export const logger = pino(loggerOptions(process.env, canResolvePinoPretty));

export type Logger = pino.Logger;
