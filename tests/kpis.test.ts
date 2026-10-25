import { describe, expect, it } from "vitest";
import { computeKpis } from "../src/kpis/index.js";
import { REPORTS, runReport } from "../src/reports/index.js";
import { createTestEnv } from "./helpers.js";

const { erp, asOf } = createTestEnv();
const report = (id: string) => runReport(REPORTS.find((r) => r.id === id)!, { erp, asOf });

describe("computeKpis", () => {
  it("agrees with the saved aging report: open balance is the sum of its buckets", async () => {
    const [kpis, aging] = await Promise.all([computeKpis(erp, asOf), report("ar_aging")]);
    const bucketTotal = aging.rows.reduce((s, r) => s + (r.balance as number), 0);
    expect(kpis.openReceivables).toBeCloseTo(bucketTotal, 1);
  });

  it("keeps overdue and 90+ nested inside open receivables", async () => {
    const k = await computeKpis(erp, asOf);
    expect(k.over90Receivables).toBeGreaterThan(0);
    expect(k.over90Receivables).toBeLessThanOrEqual(k.overdueReceivables);
    expect(k.overdueReceivables).toBeLessThanOrEqual(k.openReceivables);
    expect(k.overdueShare).toBeCloseTo((k.overdueReceivables / k.openReceivables) * 100, 0);
  });

  it("counts match the low-stock and late-PO reports", async () => {
    const [k, low, late] = await Promise.all([computeKpis(erp, asOf), report("low_stock"), report("late_purchase_orders")]);
    expect(k.lowStockItems).toBe(low.rows.length);
    expect(k.latePurchaseOrders).toBe(late.rows.length);
  });

  it("reports revenue for the last 30 days and the change against the 30 before", async () => {
    const k = await computeKpis(erp, asOf);
    expect(k.revenueLast30).toBeGreaterThan(0);
    expect(k.revenuePrev30).toBeGreaterThan(0);
    const expected = ((k.revenueLast30 - k.revenuePrev30) / k.revenuePrev30) * 100;
    expect(k.revenueChangePct).toBeCloseTo(expected, 0);
  });

  it("returns null change when there is no earlier period", async () => {
    const k = await computeKpis(erp, "2000-01-01");
    expect(k.revenueChangePct).toBeNull();
    expect(k.openReceivables).toBeGreaterThanOrEqual(0);
  });
});
