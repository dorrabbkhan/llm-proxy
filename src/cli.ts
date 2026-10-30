#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { Provider } from "./transformers/adapters";
import { getConfig } from "./config/env-config";
import { startServer } from "./index";

export interface CliArgs {
  preset?: "claude-code" | "openai-apps";
  target?: Provider;
  model?: string;
  baseUrl?: string;
  port?: number;
  help?: boolean;
}

const PRESETS = ["claude-code", "openai-apps"] as const;
const PROVIDERS: Provider[] = ["openai", "gemini", "ollama", "anthropic"];

/**
 * Parses CLI arguments. Unknown flags and invalid values throw an error
 * naming the flag; upstream keys only ever come from the environment.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      preset: { type: "string" },
      target: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
      port: { type: "string" },
      help: { type: "boolean" },
    },
  });

  const args: CliArgs = {};
  if (values.preset !== undefined) {
    if (!(PRESETS as readonly string[]).includes(values.preset)) {
      throw new Error(
        `--preset must be one of: ${PRESETS.join(", ")}`,
      );
    }
    args.preset = values.preset as CliArgs["preset"];
  }
  if (values.target !== undefined) {
    if (!PROVIDERS.includes(values.target as Provider)) {
      throw new Error(`--target must be one of: ${PROVIDERS.join(", ")}`);
    }
    args.target = values.target as Provider;
  }
  if (values.model !== undefined) args.model = values.model;
  if (values["base-url"] !== undefined) args.baseUrl = values["base-url"];
  if (values.port !== undefined) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("--port must be an integer between 1 and 65535");
    }
    args.port = port;
  }
  if (values.help) args.help = true;
  return args;
}

/**
 * The provider the proxy will target: `--target` when given, else a valid
 * TARGET_API already in the env. Used wherever a preset/flag value depends
 * on which target is effective.
 */
function effectiveTarget(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): Provider | undefined {
  if (args.target !== undefined) return args.target;
  return PROVIDERS.includes(env.TARGET_API as Provider)
    ? (env.TARGET_API as Provider)
    : undefined;
}

/**
 * Every env value the flags/preset would set, before "user env wins" is
 * applied. `env` is still consulted to resolve the effective target for
 * --base-url and the ollama timeout.
 */
function wantedEnv(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const wanted: Record<string, string> = {};

  if (args.target !== undefined) {
    wanted.TARGET_API = args.target;
  }

  if (args.preset === "claude-code") {
    if (args.model !== undefined) {
      wanted.MODEL_MAP = `claude-*=${args.model}`;
    }
    wanted.TARGET_CONTEXT_WINDOW = "32768";
    if (effectiveTarget(args, env) === "ollama") {
      wanted.UPSTREAM_TIMEOUT_MS = "600000";
    }
  }

  if (args.baseUrl !== undefined) {
    const target = effectiveTarget(args, env);
    if (target === undefined) {
      throw new Error(
        "--base-url requires --target or TARGET_API in the environment",
      );
    }
    wanted[`${target.toUpperCase()}_API_BASE_URL`] = args.baseUrl;
  }

  if (args.port !== undefined) {
    wanted.PORT = String(args.port);
  }

  return wanted;
}

/**
 * Environment values implied by the flags. Keys the user's own env already
 * sets (a non-empty value) are not returned — user env always wins and
 * presets are only ever env values, never changes to config defaults.
 */
export function presetEnv(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(wantedEnv(args, env)).filter(([key]) => !env[key]),
  );
}

/**
 * Names of the preset/flag env keys that lost to values already set in
 * `env` — everything the flags/preset wanted that presetEnv(args, env)
 * dropped. Names only, never values.
 */
export function overriddenKeys(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): string[] {
  const applied = presetEnv(args, env);
  return Object.keys(wantedEnv(args, env)).filter((key) => !(key in applied));
}

/**
 * The `export …` lines the user pastes into their shell to point the client
 * app at this proxy. PROXY_API_KEY is the proxy's own client-facing key, not
 * an upstream key.
 */
export function clientInstructions(
  args: CliArgs,
  port: number,
  proxyApiKey?: string,
): string[] {
  const token = proxyApiKey ?? "babelgate";
  if (args.preset === "claude-code") {
    return [
      `export ANTHROPIC_BASE_URL=http://localhost:${port}`,
      `export ANTHROPIC_AUTH_TOKEN=${token}`,
    ];
  }
  if (args.preset === "openai-apps") {
    return [
      `export OPENAI_BASE_URL=http://localhost:${port}/v1`,
      `export OPENAI_API_KEY=${token}`,
    ];
  }
  return [];
}

function usageLines(): string[] {
  return [
    "Usage: babelgate [--preset <claude-code|openai-apps>] [--target <provider>]",
    "                 [--model <name>] [--base-url <url>] [--port <n>] [--help]",
    "",
    "Upstream API keys come only from the environment",
    "(OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OLLAMA_API_KEY).",
  ];
}

export async function main(argv: string[]): Promise<void> {
  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      for (const line of usageLines()) console.log(line);
      return;
    }

    const envValues = presetEnv(args, process.env);
    const overridden = overriddenKeys(args, process.env);
    for (const [key, value] of Object.entries(envValues)) {
      process.env[key] = value;
    }

    if (overridden.length > 0) {
      console.error(
        `babelgate: your environment overrides ${overridden.join(", ")} ` +
          "(flags and presets never replace values you set)",
      );
    }
    if (
      args.preset === "claude-code" &&
      args.model === undefined &&
      !process.env.MODEL_MAP
    ) {
      console.error(
        "babelgate: no --model given; claude-* model names are forwarded " +
          "to the target unchanged",
      );
    }

    await startServer();
    const config = getConfig();
    if (args.preset !== undefined) {
      // The export lines come from the requested preset — there is no
      // configured source format; the request path decides the dialect.
      for (const line of clientInstructions(
        args,
        config.port,
        config.proxyApiKey,
      )) {
        console.log(line);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2));
}
