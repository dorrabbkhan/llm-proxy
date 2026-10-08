import { describe, it, expect } from "vitest";
import { logger } from "./logger";

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
