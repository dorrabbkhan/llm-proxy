import { describe, it, expect } from "vitest";
import { logger, loggerOptions } from "./logger";

describe("logger", () => {
  it("should export a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should support child loggers", () => {
    const child = logger.child({ requestId: "test-123" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});

describe("loggerOptions", () => {
  it("no pino-pretty installed → plain JSON logger, no transport", () => {
    const options = loggerOptions({ NODE_ENV: "development" }, () => false);
    expect(options.transport).toBeUndefined();
  });

  it("pino-pretty installed, not production → pretty transport", () => {
    const options = loggerOptions({ NODE_ENV: "development" }, () => true);
    expect(options.transport).toMatchObject({ target: "pino-pretty" });
  });

  it("production → no transport even if pino-pretty is installed", () => {
    const options = loggerOptions({ NODE_ENV: "production" }, () => true);
    expect(options.transport).toBeUndefined();
  });
});
