import { describe, expect, it } from "vitest";
import { QUERYABLE_TABLES } from "../src/db/schema.js";
import { REPORTS, buildDigest, runReport, toCsv } from "../src/reports/index.js";
import { validateReadOnlySql } from "../src/sql-guard/index.js";
import { createTestEnv } from "./helpers.js";

const { erp, asOf } = createTestEnv();

describe("saved reports", () => {
  it.each(REPORTS.map((r) => [r.id, r] as const))("%s runs and returns rows", async (_id, report) => {
    const result = await runReport(report, { erp, asOf });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it.each(REPORTS.map((r) => [r.id, r] as const))("%s also passes the SQL guard", (_id, report) => {
    const checked = validateReadOnlySql(report.sql, { allowedTables: QUERYABLE_TABLES, rowLimit: 500 });
    expect(checked).toMatchObject({ ok: true });
  });

  it("has unique ids", () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length);
  });

  it("aging buckets add up to the open balance computed independently", async () => {
    const aging = await runReport(REPORTS.find((r) => r.id === "ar_aging")!, { erp, asOf });
    const bucketTotal = aging.rows.reduce((s, r) => s + (r.balance as number), 0);

    const [{ total }] = await erp.query<{ total: number }>(
      `SELECT ROUND(SUM(i.amount) - COALESCE(SUM((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id)), 0), 2) AS total
       FROM invoices i WHERE i.status = 'open'`,
    ) as [{ total: number }];
    expect(bucketTotal).toBeCloseTo(total, 1);
  });

  it("low stock only lists items below their reorder point", async () => {
    const r = await runReport(REPORTS.find((x) => x.id === "low_stock")!, { erp, asOf });
    for (const row of r.rows) expect(row.on_hand as number).toBeLessThan(row.reorder_point as number);
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["a"], [{ a: 'x,"y"\nz' }])).toBe('a\n"x,""y""\nz"\n');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    const csv = toCsv(["name"], [{ name: "=HYPERLINK(\"http://evil\")" }, { name: "+1" }, { name: "@SUM(A1)" }]);
    for (const line of csv.trim().split("\n").slice(1)) expect(line.replace(/^"/, "")).toMatch(/^'/);
  });

  it("leaves real negative numbers alone", () => {
    expect(toCsv(["n"], [{ n: -5 }])).toBe("n\n-5\n");
  });
});

describe("buildDigest", () => {
  it("includes every report and truncates long tables", async () => {
    const results = [];
    for (const r of REPORTS) results.push(await runReport(r, { erp, asOf }));
    const digest = buildDigest(results, asOf, 3);
    for (const r of REPORTS) expect(digest).toContain(r.title);
    expect(digest).toContain(`as of ${asOf}`);
    expect(digest).toMatch(/more rows not shown/);
  });
});
