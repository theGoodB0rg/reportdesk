import { z } from "zod";
import { ask, type AskResult } from "../ask/index.js";
import { runAssistant } from "../assistant/index.js";
import { exampleQuestions } from "../ask/examples.js";
import type { Config } from "../config/index.js";
import { QUERYABLE_TABLES } from "../db/schema.js";
import type { Database } from "../db/types.js";
import type { Llm } from "../llm/index.js";
import { computeKpis } from "../kpis/index.js";
import { computeImpact } from "../metrics/index.js";
import { runReconciliation } from "../reconcile/index.js";
import { REPORTS, getReport, runReport, toCsv } from "../reports/index.js";
import type { AppStore } from "../store/index.js";
import { triage } from "../triage/index.js";
import { RateLimiter } from "./rate-limit.js";

export type ApiDeps = {
  /** Must be read-only. */
  erp: Database;
  store: AppStore;
  llm: Llm | null;
  config: Pick<Config, "asOf" | "queryRowLimit">;
  /** Public deployment: submitted requests are answered but never stored. */
  publicDemo?: boolean;
  now?: () => number;
  limiter?: RateLimiter;
  /** Each assistant message can trigger several model calls, so it has its own, tighter limit. */
  assistantLimiter?: RateLimiter;
  log?: (message: string) => void;
};

const MAX_BODY = 4_000;
const DEPARTMENTS = ["finance", "sales", "operations", "procurement", "other"] as const;

const askBody = z.object({ question: z.string().max(500) });
const assistantBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) })).min(1).max(12),
});
const requestBody = z.object({
  department: z.enum(DEPARTMENTS),
  text: z.string().trim().min(3).max(500),
});

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...extra },
  });

const clientKey = (req: Request) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

const ASK_STATUS = { input: 400, guard: 422, llm: 503, db: 500 } as const;
const ASSISTANT_STATUS = { input: 400, llm: 503 } as const;

export function createHandler(deps: ApiDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new RateLimiter(20, 60_000);
  const assistantLimiter = deps.assistantLimiter ?? new RateLimiter(8, 60_000);
  const log = deps.log ?? ((m: string) => console.error(m));
  const examples = exampleQuestions(deps.config.asOf);

  const askDeps = () => ({
    llm: deps.llm,
    erp: deps.erp,
    audit: deps.store,
    allowedTables: QUERYABLE_TABLES,
    rowLimit: deps.config.queryRowLimit,
    asOf: deps.config.asOf,
    examples,
  });

  /**
   * Reads at most `max` bytes. The declared length is checked first, and the stream is
   * cancelled the moment it exceeds the cap, so an oversized upload is never buffered.
   */
  async function readCapped(req: Request, max: number): Promise<string | null> {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > max) return null;
    if (!req.body) return "";
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  async function readJson(req: Request, maxBody = MAX_BODY): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
    const text = await readCapped(req, maxBody);
    if (text === null) return { ok: false, res: json(413, { error: "Request body too large." }) };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, res: json(400, { error: "Body must be valid JSON." }) };
    }
  }

  async function route(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const method = req.method;
    const only = (m: string) => (method === m ? null : json(405, { error: "Method not allowed." }, { Allow: m }));

    if (pathname === "/api/health") {
      return only("GET") ?? json(200, { ok: true, aiEnabled: deps.llm !== null, publicDemo: deps.publicDemo === true });
    }

    if (pathname === "/api/examples") {
      return only("GET") ?? json(200, { questions: examples.map((e) => e.question) });
    }

    if (pathname === "/api/reports") {
      return (
        only("GET") ??
        json(200, { reports: REPORTS.map(({ id, title, description }) => ({ id, title, description })) })
      );
    }

    const reportMatch = pathname.match(/^\/api\/reports\/([a-z_]+?)(\.csv)?$/);
    if (reportMatch) {
      const denied = only("GET");
      if (denied) return denied;
      const report = getReport(reportMatch[1]!);
      if (!report) return json(404, { error: "Unknown report." });
      const result = await runReport(report, { erp: deps.erp, asOf: deps.config.asOf });
      if (!reportMatch[2]) return json(200, result);
      return new Response(toCsv(result.columns, result.rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report.id}.csv"`,
          ...BASE_HEADERS,
        },
      });
    }

    if (pathname === "/api/ask") {
      const denied = only("POST");
      if (denied) return denied;
      if (!limiter.allow(clientKey(req), now())) {
        return json(429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" });
      }
      const body = await readJson(req);
      if (!body.ok) return body.res;
      const parsed = askBody.safeParse(body.value);
      if (!parsed.success) return json(400, { error: "Provide a question of up to 500 characters." });
      const result = await ask(parsed.data.question, askDeps());
      return json(result.ok ? 200 : ASK_STATUS[result.stage], result);
    }

    if (pathname === "/api/assistant") {
      const denied = only("POST");
      if (denied) return denied;
      if (!assistantLimiter.allow(clientKey(req), now())) {
        return json(429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" });
      }
      const body = await readJson(req, 16_000);
      if (!body.ok) return body.res;
      const parsed = assistantBody.safeParse(body.value);
      if (!parsed.success) return json(400, { error: "Send 1 to 12 messages of up to 1000 characters." });
      const result = await runAssistant(parsed.data.messages, {
        llm: deps.llm,
        erp: deps.erp,
        audit: deps.store,
        allowedTables: QUERYABLE_TABLES,
        rowLimit: deps.config.queryRowLimit,
        asOf: deps.config.asOf,
      });
      return json(result.ok ? 200 : ASSISTANT_STATUS[result.stage], result);
    }

    if (pathname === "/api/requests") {
      if (method === "GET") {
        const impactRows = await deps.store.listRequests(25);
        return json(200, { requests: impactRows });
      }
      const denied = only("POST");
      if (denied) return denied;
      if (!limiter.allow(clientKey(req), now())) {
        return json(429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" });
      }
      const body = await readJson(req);
      if (!body.ok) return body.res;
      const parsed = requestBody.safeParse(body.value);
      if (!parsed.success) {
        return json(400, { error: "Provide a department and a request of 3 to 500 characters." });
      }

      const { department, text } = parsed.data;
      const started = now();
      const decision = triage(text);
      let answer: unknown;
      let answered = false;

      if (decision.route === "saved_report") {
        const report = getReport(decision.reportId!)!;
        answer = await runReport(report, { erp: deps.erp, asOf: deps.config.asOf });
        answered = true;
      } else if (decision.route === "ask_data") {
        const result: AskResult = await ask(text, askDeps());
        answer = result;
        answered = result.ok;
      }

      // A public demo answers the request but does not keep it: visitors cannot fill the shared
      // log with junk, and nobody's input is shown to anyone else.
      if (!deps.publicDemo) {
        await deps.store.addRequest({
          department,
          text,
          route: decision.route,
          reportId: decision.reportId,
          outcome: answered ? "answered" : "escalated",
          durationMs: now() - started,
        });
      }
      return json(200, { ...decision, outcome: answered ? "answered" : "escalated", answer, logged: !deps.publicDemo });
    }

    if (pathname === "/api/reconcile") {
      return only("GET") ?? json(200, await runReconciliation(deps.erp));
    }

    if (pathname === "/api/kpis") {
      return only("GET") ?? json(200, await computeKpis(deps.erp, deps.config.asOf));
    }

    if (pathname === "/api/impact") {
      return only("GET") ?? json(200, computeImpact(await deps.store.listRequests(5000)));
    }

    return json(404, { error: "Not found." });
  }

  return async (req) => {
    try {
      return await route(req);
    } catch (err) {
      // Log the detail server-side; never return stack traces or SQL errors to the client.
      log(`unhandled error: ${err instanceof Error ? err.message : String(err)}`);
      return json(500, { error: "Internal error." });
    }
  };
}
