/**
 * Cloudflare Workers entry. Same handler as the Node server; only the
 * database adapter (D1) and static-asset serving differ.
 *
 * Secrets: `wrangler secret put OPENROUTER_API_KEY`. Never put it in wrangler.toml.
 */
import { createHandler } from "./api/handler.js";
import { RateLimiter } from "./api/rate-limit.js";
import { loadConfig } from "./config/index.js";
import { D1Adapter, type D1Like } from "./db/d1.js";
import { readOnly } from "./db/types.js";
import { OpenRouterClient } from "./llm/openrouter.js";
import { AppStore } from "./store/index.js";

type Env = {
  ERP: D1Like;
  APP: D1Like;
  ASSETS: { fetch(req: Request): Promise<Response> };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  AS_OF?: string;
  QUERY_ROW_LIMIT?: string;
};

// Module scope survives across requests within an isolate, so the limiter is meaningful per isolate.
const limiter = new RateLimiter(20, 60_000);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const config = loadConfig({
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: env.OPENROUTER_MODEL,
      AS_OF: env.AS_OF,
      QUERY_ROW_LIMIT: env.QUERY_ROW_LIMIT,
    });
    const llm = config.openRouterApiKey
      ? new OpenRouterClient({ apiKey: config.openRouterApiKey, model: config.openRouterModel })
      : null;

    return createHandler({
      erp: readOnly(new D1Adapter(env.ERP)),
      store: new AppStore(new D1Adapter(env.APP)),
      llm,
      config,
      limiter,
    })(req);
  },
};
