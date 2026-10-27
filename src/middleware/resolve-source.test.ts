import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { resolveSource } from "./resolve-source";
import { resetConfig } from "../config/env-config";

/**
 * resolveSource records the configured source provider on
 * res.locals.sourceApi when the request path belongs to it, so the error
 * handler can render in that dialect. It must never throw — a broken
 * config just leaves sourceApi unset (generic error shape).
 */

function run(method: string, path: string) {
  const req = { method, path } as Request;
  const res = { locals: {} } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  resolveSource()(req, res, next);
  return { res, next };
}

describe("resolveSource", () => {
  beforeEach(() => {
    process.env.SOURCE_API = "openai";
    process.env.TARGET_API = "ollama";
    process.env.OLLAMA_API_BASE_URL = "http://localhost:11434";
    resetConfig();
  });

  afterEach(() => {
    delete process.env.SOURCE_API;
    delete process.env.TARGET_API;
    delete process.env.OLLAMA_API_BASE_URL;
    resetConfig();
  });

  it("sets sourceApi when the path matches a source route", () => {
    const { res, next } = run("POST", "/v1/chat/completions");
    expect(res.locals.sourceApi).toBe("openai");
    expect(next).toHaveBeenCalled();
  });

  it("leaves sourceApi unset for /health", () => {
    const { res, next } = run("GET", "/health");
    expect(res.locals.sourceApi).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("leaves sourceApi unset for an unknown path", () => {
    const { res, next } = run("POST", "/v1/unknown");
    expect(res.locals.sourceApi).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("leaves sourceApi unset when the method does not match", () => {
    const { res, next } = run("GET", "/v1/chat/completions");
    expect(res.locals.sourceApi).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("never throws when the config is broken", () => {
    delete process.env.SOURCE_API;
    resetConfig();
    const { res, next } = run("POST", "/v1/chat/completions");
    expect(res.locals.sourceApi).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
