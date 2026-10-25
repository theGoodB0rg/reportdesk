import { describe, expect, it } from "vitest";
import { EVENT_NAMES, EventStore, cleanCountry, cleanSource, isEventName } from "../src/analytics/index.js";
import { RateLimiter } from "../src/api/rate-limit.js";
import { createHandler } from "../src/api/handler.js";
import { APP_DDL } from "../src/db/schema.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import type { Database } from "../src/db/types.js";
import { createTestEnv } from "./helpers.js";

const freshDb = () => {
  const db = SqliteDatabase.open(":memory:");
  db.exec(APP_DDL);
  return db;
};
const rows = (db: Database) => db.query<{ hour: string; name: string; source: string; country: string; count: number }>("SELECT * FROM events ORDER BY name, source");

describe("cleaning", () => {
  it("keeps short safe source labels and turns anything else into 'direct'", () => {
    expect(cleanSource("application")).toBe("application");
    expect(cleanSource("  GitHub ")).toBe("github");
    expect(cleanSource("www.linkedin.com")).toBe("www.linkedin.com");
    for (const bad of [undefined, null, 42, "", "<script>", "a b", "x".repeat(41), "-start", "../etc", "ref=1&x=2"]) {
      expect(cleanSource(bad), String(bad)).toBe("direct");
    }
  });

  it("accepts only two-letter country codes", () => {
    expect(cleanCountry("NG")).toBe("ng");
    for (const bad of [null, undefined, "", "USA", "1", "N G", "<b>"]) expect(cleanCountry(bad as never)).toBe("xx");
  });

  it("recognises only listed event names", () => {
    for (const name of EVENT_NAMES) expect(isEventName(name)).toBe(true);
    for (const bad of ["", "view_secret", "VIEW_OVERVIEW", "'; DROP TABLE events; --", 7, null]) expect(isEventName(bad)).toBe(false);
  });
});

describe("EventStore", () => {
  it("counts events per hour, source and country", async () => {
    const db = freshDb();
    let now = new Date("2026-10-25T09:15:00Z");
    const store = new EventStore(db, () => now);

    await store.record({ name: "view_overview", source: "application", country: "US" });
    await store.record({ name: "view_overview", source: "application", country: "US" });
    await store.record({ name: "view_overview", source: "github", country: "US" });
    now = new Date("2026-10-25T10:01:00Z");
    await store.record({ name: "view_overview", source: "application", country: "US" });

    expect(await rows(db)).toEqual([
      { hour: "2026-10-25T09", name: "view_overview", source: "application", country: "us", count: 2 },
      { hour: "2026-10-25T10", name: "view_overview", source: "application", country: "us", count: 1 },
      { hour: "2026-10-25T09", name: "view_overview", source: "github", country: "us", count: 1 },
    ]);
  });

  it("stores no identifying columns at all", async () => {
    const db = freshDb();
    await new EventStore(db).record({ name: "session_start", source: "203.0.113.9", country: "NG" });
    const columns = (await db.query<{ name: string }>("SELECT name FROM pragma_table_info('events')")).map((c) => c.name);
    expect(columns).toEqual(["hour", "name", "source", "country", "count"]);
  });
});

describe("POST /api/event", () => {
  const { erp, store, asOf } = createTestEnv();
  const send = (h: ReturnType<typeof createHandler>, body: unknown, headers: Record<string, string> = {}) =>
    h(new Request("http://t/api/event", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("records a valid event with the visitor's country and returns 204", async () => {
    const db = freshDb();
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, analytics: new EventStore(db), log: () => {} });
    const res = await send(h, { name: "view_assistant", source: "application" }, { "cf-ipcountry": "NG" });
    expect(res.status).toBe(204);
    expect(await rows(db)).toMatchObject([{ name: "view_assistant", source: "application", country: "ng", count: 1 }]);
  });

  it("rejects unknown event names and bad bodies, and stores nothing", async () => {
    const db = freshDb();
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, analytics: new EventStore(db), log: () => {} });
    expect((await send(h, { name: "view_secret" })).status).toBe(400);
    expect((await send(h, { name: "x".repeat(500) })).status).toBe(400);
    expect((await send(h, "{bad")).status).toBe(400);
    expect((await send(h, "x".repeat(2000))).status).toBe(413);
    expect(await rows(db)).toEqual([]);
  });

  it("is POST only", async () => {
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, log: () => {} });
    expect((await h(new Request("http://t/api/event"))).status).toBe(405);
  });

  it("accepts and discards when analytics is not configured", async () => {
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, log: () => {} });
    expect((await send(h, { name: "view_overview" })).status).toBe(204);
  });

  it("quietly drops floods without storing the excess", async () => {
    const db = freshDb();
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, analytics: new EventStore(db), eventLimiter: new RateLimiter(2, 60_000), now: () => 1, log: () => {} });
    for (let i = 0; i < 6; i++) expect((await send(h, { name: "view_overview" }, { "cf-connecting-ip": "5.5.5.5" })).status).toBe(204);
    expect((await rows(db))[0]?.count).toBe(2);
  });

  it("never lets a failing counter break the visit", async () => {
    const broken: Database = { query: async () => [], run: async () => { throw new Error("D1 down"); } };
    const logged: string[] = [];
    const h = createHandler({ erp, store, llm: null, config: { asOf, queryRowLimit: 100 }, analytics: new EventStore(broken), log: (m) => logged.push(m) });
    expect((await send(h, { name: "view_overview" })).status).toBe(204);
    expect(logged.join()).toMatch(/analytics write failed/);
  });
});

