import { z } from "zod";

/** `KEY=` in a .env file arrives as "", which should mean "unset". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  OPENROUTER_API_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  OPENROUTER_MODEL: z.preprocess(blankToUndefined, z.string().min(1).default("openai/gpt-4o-mini")),
  ERP_DB_PATH: z.preprocess(blankToUndefined, z.string().default("./data/erp.db")),
  APP_DB_PATH: z.preprocess(blankToUndefined, z.string().default("./data/app.db")),
  QUERY_ROW_LIMIT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(5000).default(500)),
  AS_OF: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").default("2026-09-30")),
  PUBLIC_DEMO: z.preprocess(blankToUndefined, z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),
  AI_DAILY_BUDGET: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100000).default(400)),
  AI_CLIENT_DAILY_BUDGET: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10000).default(40)),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(8787)),
});

export type Config = {
  openRouterApiKey?: string;
  openRouterModel: string;
  erpDbPath: string;
  appDbPath: string;
  queryRowLimit: number;
  asOf: string;
  port: number;
  /** Public deployment: visitors' requests are answered but never stored. */
  publicDemo: boolean;
  aiDailyBudget: number;
  aiClientDailyBudget: number;
};

/**
 * Validates environment variables once, at startup. The error names the
 * offending variables but never echoes their values, so a bad key can't leak
 * into logs.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    openRouterApiKey: e.OPENROUTER_API_KEY,
    openRouterModel: e.OPENROUTER_MODEL,
    erpDbPath: e.ERP_DB_PATH,
    appDbPath: e.APP_DB_PATH,
    queryRowLimit: e.QUERY_ROW_LIMIT,
    asOf: e.AS_OF,
    port: e.PORT,
    publicDemo: e.PUBLIC_DEMO,
    aiDailyBudget: e.AI_DAILY_BUDGET,
    aiClientDailyBudget: e.AI_CLIENT_DAILY_BUDGET,
  };
}
