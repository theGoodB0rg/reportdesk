/**
 * Cloudflare Workers entry for the public demo. Same handler as the Node server;
 * only the database adapter (D1) and static-asset serving differ.
 *
 * Defences specific to a public deployment, outermost first:
 *   1. Cloudflare's rate-limit binding, per client, across all instances.
 *   2. A per-visitor and a global daily cap on model calls, counted in D1.
 *   3. The in-handler limits (tighter for the assistant) and body-size caps.
 *   4. Visitors' requests are answered but never stored (PUBLIC_DEMO).
 *
 * Secrets: `wrangler secret put OPENROUTER_API_KEY`. It is never written to wrangler.toml.
 */
import { createHandler } from "./api/handler.js";
import { RateLimiter } from "./api/rate-limit.js";
import { BudgetedLlm, UsageBudget } from "./budget/index.js";
import { loadConfig } from "./config/index.js";
import { D1Adapter, type D1Like } from "./db/d1.js";
import { readOnly } from "./db/types.js";
import { OpenRouterClient } from "./llm/openrouter.js";
import { AppStore } from "./store/index.js";

type Env = {
  ERP: D1Like;
  APP: D1Like;
  ASSETS: { fetch(req: Request): Promise<Response> };
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  AS_OF?: string;
  QUERY_ROW_LIMIT?: string;
  PUBLIC_DEMO?: string;
  AI_DAILY_BUDGET?: string;
  AI_CLIENT_DAILY_BUDGET?: string;
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const failure = (status: number, error: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...JSON_HEADERS, ...extra } });

// Module scope survives across requests within an isolate: a second, finer brake behind the platform limiter.
const limiter = new RateLimiter(20, 60_000);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const client = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: client })).success) {
      return failure(429, "Too many requests. Try again in a minute.", { "Retry-After": "60" });
    }

    let config;
    try {
      config = loadConfig({
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: env.OPENROUTER_MODEL,
        AS_OF: env.AS_OF,
        QUERY_ROW_LIMIT: env.QUERY_ROW_LIMIT,
        PUBLIC_DEMO: env.PUBLIC_DEMO,
        AI_DAILY_BUDGET: env.AI_DAILY_BUDGET,
        AI_CLIENT_DAILY_BUDGET: env.AI_CLIENT_DAILY_BUDGET,
      });
    } catch {
      return failure(500, "Server is misconfigured.");
    }

    const app = new D1Adapter(env.APP);
    const llm = config.openRouterApiKey
      ? new BudgetedLlm(
          new OpenRouterClient({ apiKey: config.openRouterApiKey, model: config.openRouterModel }),
          new UsageBudget(app, { global: config.aiDailyBudget, client: config.aiClientDailyBudget }),
          client,
        )
      : null;

    return createHandler({
      erp: readOnly(new D1Adapter(env.ERP)),
      store: new AppStore(app),
      llm,
      config,
      publicDemo: config.publicDemo,
      limiter,
    })(req);
  },
};
