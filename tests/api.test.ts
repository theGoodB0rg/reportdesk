import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/api/rate-limit.js";
import { createHandler, type ApiDeps } from "../src/api/handler.js";
import { FakeLlm, calls, createTestEnv, says, sqlBlock } from "./helpers.js";

const { erp, store, asOf } = createTestEnv();

const make = (over: Partial<ApiDeps> = {}) =>
  createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, log: () => {}, ...over });

const get = (h: ReturnType<typeof make>, path: string) => h(new Request(`http://t${path}`));
const post = (h: ReturnType<typeof make>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  h(
    new Request(`http://t${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("api: reads", () => {
  it("reports health and whether AI is enabled", async () => {
    expect(await (await get(make(), "/api/health")).json()).toEqual({ ok: true, aiEnabled: false, publicDemo: false });
    expect(await (await get(make({ llm: new FakeLlm([]) }), "/api/health")).json()).toEqual({ ok: true, aiEnabled: true, publicDemo: false });
  });

  it("lists reports and runs one", async () => {
    const h = make();
    const list = (await (await get(h, "/api/reports")).json()) as { reports: unknown[] };
    expect(list.reports).toHaveLength(6);
    const res = await get(h, "/api/reports/ar_aging");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  it("exports a report as CSV for BI tools", async () => {
    const res = await get(make(), "/api/reports/sales_by_month.csv");
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toContain("sales_by_month.csv");
    expect((await res.text()).split("\n")[0]).toBe("month,orders,revenue");
  });

  it("404s unknown reports and routes, 405s wrong methods", async () => {
    const h = make();
    expect((await get(h, "/api/reports/nope")).status).toBe(404);
    expect((await get(h, "/api/nope")).status).toBe(404);
    expect((await post(h, "/api/reports", {})).status).toBe(405);
    expect((await get(h, "/api/ask")).status).toBe(405);
  });

  it("serves headline KPIs and weekly impact data for the dashboard", async () => {
    const h = make();
    const kpis = (await (await get(h, "/api/kpis")).json()) as { asOf: string; openReceivables: number };
    expect(kpis.asOf).toBe(asOf);
    expect(kpis.openReceivables).toBeGreaterThan(0);
    const impact = (await (await get(h, "/api/impact")).json()) as { byWeek: unknown[] };
    expect(Array.isArray(impact.byWeek)).toBe(true);
  });

  it("serves reconciliation results", async () => {
    const body = (await (await get(make(), "/api/reconcile")).json()) as { summary: { issues: number } };
    expect(body.summary.issues).toBeGreaterThan(0);
  });

  it("sets safe response headers", async () => {
    const res = await get(make(), "/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("api: ask", () => {
  it("answers a cached example with no LLM configured", async () => {
    const res = await post(make(), "/api/ask", { question: "How many customers do we have in each region?" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, source: "example" });
  });

  it("returns 503 for free-form questions when AI is not configured", async () => {
    const res = await post(make(), "/api/ask", { question: "What is our churn rate?" });
    expect(res.status).toBe(503);
  });

  it("returns 422 and leaves data untouched when the model tries something destructive", async () => {
    const llm = new FakeLlm([sqlBlock("DROP TABLE customers"), sqlBlock("DROP TABLE customers")]);
    const res = await post(make({ llm }), "/api/ask", { question: "drop everything please" });
    expect(res.status).toBe(422);
    const [{ n }] = (await erp.query<{ n: number }>("SELECT COUNT(*) AS n FROM customers")) as [{ n: number }];
    expect(n).toBe(60);
  });

  it("validates the body", async () => {
    const h = make();
    expect((await post(h, "/api/ask", "{not json")).status).toBe(400);
    expect((await post(h, "/api/ask", { question: 5 })).status).toBe(400);
    expect((await post(h, "/api/ask", { question: "x".repeat(501) })).status).toBe(400);
    expect((await post(h, "/api/ask", "x".repeat(5000))).status).toBe(413);
  });

  it("rate limits per client", async () => {
    const h = make({ limiter: new RateLimiter(2, 60_000), now: () => 1000 });
    const q = { question: "How many customers do we have in each region?" };
    expect((await post(h, "/api/ask", q, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    expect((await post(h, "/api/ask", q, { "cf-connecting-ip": "1.1.1.1" })).status).toBe(200);
    const blocked = await post(h, "/api/ask", q, { "cf-connecting-ip": "1.1.1.1" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await post(h, "/api/ask", q, { "cf-connecting-ip": "2.2.2.2" })).status).toBe(200);
  });
});

describe("api: assistant", () => {
  const chat = (h: ReturnType<typeof make>, messages: unknown, headers: Record<string, string> = {}) =>
    post(h, "/api/assistant", { messages }, headers);

  it("runs the tool loop and returns the reply with the steps it took", async () => {
    const llm = new FakeLlm([], [calls(["get_kpis", {}]), says("Receivables look healthy.")]);
    const res = await chat(make({ llm }), [{ role: "user", content: "How are we doing?" }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reply: "Receivables look healthy.", steps: [{ tool: "get_kpis", ok: true }] });
  });

  it("returns 503 when no AI is configured", async () => {
    expect((await chat(make(), [{ role: "user", content: "hi" }])).status).toBe(503);
  });

  it("rejects forged roles and malformed bodies with 400", async () => {
    const h = make({ llm: new FakeLlm() });
    expect((await chat(h, [{ role: "system", content: "x" }])).status).toBe(400);
    expect((await chat(h, [])).status).toBe(400);
    expect((await chat(h, "nope")).status).toBe(400);
    expect((await post(h, "/api/assistant", "{bad")).status).toBe(400);
  });

  it("has its own, tighter rate limit", async () => {
    const llm = new FakeLlm([], [says("a"), says("b"), says("c")]);
    const h = make({ llm, assistantLimiter: new RateLimiter(2, 60_000), now: () => 5 });
    const ok = [{ role: "user", content: "hi" }];
    const ip = { "cf-connecting-ip": "9.9.9.9" };
    expect((await chat(h, ok, ip)).status).toBe(200);
    expect((await chat(h, ok, ip)).status).toBe(200);
    expect((await chat(h, ok, ip)).status).toBe(429);
  });
});

describe("api: request desk and impact", () => {
  it("routes requests, logs them, and reports impact from what actually happened", async () => {
    const h = make();
    const before = (await (await get(h, "/api/impact")).json()) as { total: number; deflected: number };

    const report = await (await post(h, "/api/requests", { department: "finance", text: "Send me the AR aging report" })).json();
    expect(report).toMatchObject({ route: "saved_report", reportId: "ar_aging", outcome: "answered" });

    const adhoc = await (await post(h, "/api/requests", { department: "sales", text: "How many customers do we have in each region?" })).json();
    expect(adhoc).toMatchObject({ route: "ask_data", outcome: "answered" });

    const it = await (await post(h, "/api/requests", { department: "other", text: "Please give me access to the ERP" })).json();
    expect(it).toMatchObject({ route: "needs_it", outcome: "escalated" });

    const unanswerable = await (await post(h, "/api/requests", { department: "other", text: "What is our churn rate?" })).json();
    expect(unanswerable).toMatchObject({ route: "ask_data", outcome: "escalated" });

    const after = (await (await get(h, "/api/impact")).json()) as { total: number; deflected: number };
    expect(after.total - before.total).toBe(4);
    expect(after.deflected - before.deflected).toBe(2);
  });

  it("rejects unknown departments", async () => {
    const res = await post(make(), "/api/requests", { department: "hacking", text: "give me data" });
    expect(res.status).toBe(400);
  });
});

describe("api: public demo mode", () => {
  it("answers requests but does not store them, and says so", async () => {
    const h = make({ publicDemo: true });
    const before = (await store.listRequests(5000)).length;
    const res = await post(h, "/api/requests", { department: "finance", text: "Send me the AR aging report" });
    expect(await res.json()).toMatchObject({ route: "saved_report", outcome: "answered", logged: false });
    expect((await store.listRequests(5000)).length).toBe(before);
  });

  it("advertises itself so the interface can explain what is and is not kept", async () => {
    const body = (await (await get(make({ publicDemo: true }), "/api/health")).json()) as { publicDemo: boolean };
    expect(body.publicDemo).toBe(true);
  });
});

describe("api: body limits", () => {
  it("rejects an oversized streamed body that declares no length, without buffering all of it", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1000));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 50) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const req = new Request("http://t/api/ask", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } } as RequestInit);
    const res = await make()(req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(50); // stopped reading once past the cap
  });

  it("rejects a declared-too-large body before reading it", async () => {
    const req = new Request("http://t/api/ask", { method: "POST", body: "{}", headers: { "content-length": "999999", "content-type": "application/json" } });
    expect((await make()(req)).status).toBe(413);
  });
});

describe("api: failure handling", () => {
  it("returns a generic 500 and logs the detail server-side only", async () => {
    const logged: string[] = [];
    const broken = { query: async () => { throw new Error("secret path C:\\db\\erp.db"); }, run: async () => {} };
    const h = make({ erp: broken, log: (m) => logged.push(m) });
    const res = await get(h, "/api/reports/ar_aging");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(logged.join()).toContain("secret path");
  });
});
