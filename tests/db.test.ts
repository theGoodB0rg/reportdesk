import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1Adapter } from "../src/db/d1.js";
import { dumpInserts } from "../src/db/dump.js";
import { ERP_DDL, QUERYABLE_TABLES, SCHEMA_DOC } from "../src/db/schema.js";
import { seedErp } from "../src/db/seed.js";
import { readOnly } from "../src/db/types.js";
import { createTestEnv } from "./helpers.js";

const { erp } = createTestEnv();

const count = async (table: string) => (await erp.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;

describe("seeded ERP", () => {
  it("has the expected shape", async () => {
    expect(await count("customers")).toBe(60);
    expect(await count("orders")).toBe(1200);
    expect(await count("invoices")).toBeGreaterThan(1000);
  });

  it("is internally consistent: order totals equal their line items", async () => {
    const bad = await erp.query(
      `SELECT o.id FROM orders o
       JOIN (SELECT order_id, ROUND(SUM(quantity * unit_price), 2) AS t FROM order_items GROUP BY order_id) x ON x.order_id = o.id
       WHERE ABS(o.total - x.t) > 0.01`,
    );
    expect(bad).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const make = () => {
      const db = new DatabaseSync(":memory:");
      db.exec(ERP_DDL);
      seedErp(db, { seed: 7 });
      return dumpInserts(db, ["orders"]);
    };
    expect(make()).toBe(make());
  });
});

describe("read-only enforcement", () => {
  it("SQLite itself refuses writes on a read-only open", async () => {
    await expect(erp.run("DELETE FROM customers")).rejects.toThrow();
    expect(await count("customers")).toBe(60);
  });

  it("readOnly() refuses writes whatever the driver", async () => {
    const wrapped = readOnly({ query: async () => [], run: async () => {} });
    await expect(wrapped.run("DELETE FROM customers")).rejects.toThrow(/read-only/);
  });
});

describe("D1Adapter", () => {
  it("binds params and unwraps results", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const d1 = {
      prepare: (sql: string) => ({
        bind: (...params: never[]) => ({
          all: async () => (seen.push({ sql, params }), { results: [{ a: 1 }] }),
          run: async () => void seen.push({ sql, params }),
        }),
      }),
    };
    const db = new D1Adapter(d1);
    expect(await db.query("SELECT ?", [5])).toEqual([{ a: 1 }]);
    await db.run("INSERT INTO t VALUES (?)", ["x"]);
    expect(seen).toEqual([
      { sql: "SELECT ?", params: [5] },
      { sql: "INSERT INTO t VALUES (?)", params: ["x"] },
    ]);
  });
});

describe("dumpInserts", () => {
  it("escapes quotes and handles NULL", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
    db.prepare("INSERT INTO t VALUES (?, ?)").run("O'Brien", null);
    expect(dumpInserts(db, ["t"])).toBe("INSERT INTO t (a, b) VALUES ('O''Brien', NULL);\n");
  });
});

describe("schema documentation for the LLM", () => {
  it("describes every queryable table", () => {
    for (const table of QUERYABLE_TABLES) expect(SCHEMA_DOC).toContain(`${table}(`);
  });

  it("never exposes app-internal or billing tables to the model", () => {
    for (const hidden of ["requests", "audit_log", "billing_export"]) {
      expect(SCHEMA_DOC).not.toContain(hidden);
      expect(QUERYABLE_TABLES as readonly string[]).not.toContain(hidden);
    }
  });
});
