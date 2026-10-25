import { describe, expect, it } from "vitest";
import { ask } from "../src/ask/index.js";
import { runAssistant } from "../src/assistant/index.js";
import { BudgetExceededError, BudgetedLlm, UsageBudget } from "../src/budget/index.js";
import { APP_DDL, QUERYABLE_TABLES } from "../src/db/schema.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import type { Database } from "../src/db/types.js";
import { AppStore } from "../src/store/index.js";
import { FakeLlm, createTestEnv, says } from "./helpers.js";

const freshDb = () => {
  const db = SqliteDatabase.open(":memory:");
  db.exec(APP_DDL);
  return db;
};
const ok = async (p: Promise<unknown>) => p.then(() => true, () => false);
const usageRows = (db: Database) => db.query<{ key: string; count: number }>("SELECT key, count FROM usage");

describe("UsageBudget", () => {
  it("allows a visitor up to their daily allowance, then refuses, without affecting others", async () => {
    const budget = new UsageBudget(freshDb(), { global: 100, client: 3 });
    for (let i = 0; i < 3; i++) await budget.consume("1.1.1.1");
    await expect(budget.consume("1.1.1.1")).rejects.toMatchObject({ scope: "client" });
    await expect(budget.consume("2.2.2.2")).resolves.toBeUndefined();
  });

  it("enforces a global cap across all visitors", async () => {
    const budget = new UsageBudget(freshDb(), { global: 3, client: 10 });
    for (const ip of ["a", "b", "c"]) await budget.consume(ip);
    await expect(budget.consume("d")).rejects.toMatchObject({ scope: "global" });
  });

  it("does not spend the shared budget on a visitor who is already over their own limit", async () => {
    const db = freshDb();
    const budget = new UsageBudget(db, { global: 100, client: 1 });
    await budget.consume("heavy");
    for (let i = 0; i < 5; i++) await ok(budget.consume("heavy"));
    const global = (await usageRows(db)).find((r) => r.key.startsWith("g:"));
    expect(global?.count).toBe(1);
  });

  it("starts fresh each UTC day", async () => {
    let now = new Date("2026-10-25T23:59:00Z");
    const budget = new UsageBudget(freshDb(), { global: 1, client: 1 }, () => now);
    await budget.consume("x");
    await expect(budget.consume("x")).rejects.toBeInstanceOf(BudgetExceededError);
    now = new Date("2026-10-26T00:01:00Z");
    await expect(budget.consume("x")).resolves.toBeUndefined();
  });

  it("never stores a visitor's address", async () => {
    const db = freshDb();
    await new UsageBudget(db, { global: 10, client: 10 }).consume("203.0.113.77");
    const keys = (await usageRows(db)).map((r) => r.key).join(" ");
    expect(keys).not.toContain("203.0.113.77");
    expect(keys).toMatch(/^c:[0-9a-f]{16}:\d{4}-\d{2}-\d{2} g:\d{4}-\d{2}-\d{2}$/);
  });

  it("holds under concurrent requests: exactly the allowance gets through", async () => {
    const budget = new UsageBudget(freshDb(), { global: 5, client: 100 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => ok(budget.consume(`ip-${i}`))));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("fails closed: if the counter cannot be updated, the call is refused", async () => {
    const broken: Database = { query: async () => { throw new Error("D1 unavailable"); }, run: async () => {} };
    await expect(new UsageBudget(broken, { global: 10, client: 10 }).consume("x")).rejects.toThrow();
  });
});

describe("BudgetedLlm", () => {
  it("spends one unit per model call, for plain and tool-using calls, and stops calling the model when exhausted", async () => {
    const inner = new FakeLlm(["a", "b"], [says("c")]);
    const llm = new BudgetedLlm(inner, new UsageBudget(freshDb(), { global: 100, client: 3 }), "visitor");

    await llm.complete([]);
    await llm.chatWithTools([], []);
    await llm.complete([]);
    await expect(llm.complete([])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(inner.calls.length + inner.toolCalls.length).toBe(3);
  });
});

describe("what visitors see when the budget runs out", () => {
  const { erp, store, asOf } = createTestEnv();
  const exhausted = () => new BudgetedLlm(new FakeLlm(), new UsageBudget(freshDb(), { global: 100, client: 0 }), "v");

  it("Ask explains the limit, and examples keep working", async () => {
    const deps = { llm: exhausted(), erp, audit: store, allowedTables: QUERYABLE_TABLES, rowLimit: 100, asOf };
    const free = await ask("What is our churn rate?", deps);
    expect(free).toMatchObject({ ok: false, stage: "llm" });
    expect(!free.ok && free.reason).toMatch(/AI limit/);
    expect(!free.ok && free.reason).not.toMatch(/Budget|scope/);

    const cached = await ask("How many customers do we have in each region?", {
      ...deps,
      examples: [{ question: "How many customers do we have in each region?", sql: "SELECT region, COUNT(*) AS n FROM customers GROUP BY region" }],
    });
    expect(cached.ok).toBe(true);
  });

  it("the assistant explains the limit", async () => {
    const r = await runAssistant([{ role: "user", content: "hello" }], { llm: exhausted(), erp, audit: store, allowedTables: QUERYABLE_TABLES, rowLimit: 100, asOf });
    expect(r).toMatchObject({ ok: false, stage: "llm" });
    expect(!r.ok && r.reason).toMatch(/AI limit/);
  });

  it("a shared-budget stop gets its own wording and the audit log records why", async () => {
    const llm = new BudgetedLlm(new FakeLlm(), new UsageBudget(freshDb(), { global: 0, client: 100 }), "v");
    const r = await runAssistant([{ role: "user", content: "hello" }], { llm, erp, audit: store, allowedTables: QUERYABLE_TABLES, rowLimit: 100, asOf });
    expect(!r.ok && r.reason).toMatch(/budget for today/);
    const [entry] = await new AppStore(freshDb()).listAudit(1).catch(() => []);
    expect(entry).toBeUndefined(); // separate store; the real one is checked below
    const [latest] = await store.listAudit(1);
    expect(latest?.reason).toMatch(/budget exhausted \(global\)/);
  });
});
