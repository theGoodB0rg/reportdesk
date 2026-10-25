import { describe, expect, it } from "vitest";
import { reconcile, runReconciliation } from "../src/reconcile/index.js";
import { createTestEnv } from "./helpers.js";

const { erp } = createTestEnv();

describe("reconcile (pure)", () => {
  it("reports a clean match", () => {
    const r = reconcile([{ id: 1, amount: 10, status: "paid" }], [{ invoice_id: 1, amount: 10, status: "paid" }]);
    expect(r).toEqual({ summary: { erpCount: 1, billingCount: 1, matched: 1, issues: 0 }, issues: [] });
  });

  it("finds each kind of discrepancy", () => {
    const r = reconcile(
      [
        { id: 1, amount: 10, status: "paid" },
        { id: 2, amount: 20, status: "open" },
        { id: 3, amount: 30, status: "open" },
      ],
      [
        { invoice_id: 1, amount: 10.5, status: "paid" },
        { invoice_id: 2, amount: 20, status: "paid" },
        { invoice_id: 9, amount: 99, status: "open" },
      ],
    );
    expect(r.issues).toEqual([
      { type: "amount_mismatch", invoiceId: 1, erpAmount: 10, billingAmount: 10.5, difference: 0.5 },
      { type: "status_mismatch", invoiceId: 2, erpStatus: "open", billingStatus: "paid" },
      { type: "missing_in_billing", invoiceId: 3, erpAmount: 30 },
      { type: "missing_in_erp", invoiceId: 9, billingAmount: 99 },
    ]);
    expect(r.summary.matched).toBe(0);
  });

  it("ignores floating point noise below a cent", () => {
    const r = reconcile([{ id: 1, amount: 0.1 + 0.2, status: "open" }], [{ invoice_id: 1, amount: 0.3, status: "open" }]);
    expect(r.issues).toEqual([]);
  });
});

describe("runReconciliation on the seeded systems", () => {
  it("surfaces every issue type and accounts for every ERP invoice", async () => {
    const r = await runReconciliation(erp);
    const types = new Set(r.issues.map((i) => i.type));
    expect(types).toEqual(new Set(["missing_in_billing", "missing_in_erp", "amount_mismatch", "status_mismatch"]));
    expect(r.issues.filter((i) => i.type === "missing_in_erp")).toHaveLength(2);
    expect(r.summary.matched).toBeGreaterThan(r.summary.issues);

    const erpSideIssues = r.issues.filter((i) => i.type !== "missing_in_erp").length;
    expect(r.summary.matched + erpSideIssues).toBe(r.summary.erpCount);
  });
});
