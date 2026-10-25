import type { Database } from "../db/types.js";

export type ErpInvoice = { id: number; amount: number; status: string };
export type BillingRow = { invoice_id: number; amount: number; status: string };

export type Issue =
  | { type: "missing_in_billing"; invoiceId: number; erpAmount: number }
  | { type: "missing_in_erp"; invoiceId: number; billingAmount: number }
  | { type: "amount_mismatch"; invoiceId: number; erpAmount: number; billingAmount: number; difference: number }
  | { type: "status_mismatch"; invoiceId: number; erpStatus: string; billingStatus: string };

export type Reconciliation = {
  summary: { erpCount: number; billingCount: number; matched: number; issues: number };
  issues: Issue[];
};

const cents = (n: number) => Math.round(n * 100);

/** Pure comparison of two systems' view of the same invoices. */
export function reconcile(erp: readonly ErpInvoice[], billing: readonly BillingRow[]): Reconciliation {
  const billed = new Map(billing.map((b) => [b.invoice_id, b]));
  const erpIds = new Set(erp.map((e) => e.id));
  const issues: Issue[] = [];
  let matched = 0;

  for (const inv of erp) {
    const b = billed.get(inv.id);
    if (!b) {
      issues.push({ type: "missing_in_billing", invoiceId: inv.id, erpAmount: inv.amount });
      continue;
    }
    if (cents(inv.amount) !== cents(b.amount)) {
      issues.push({
        type: "amount_mismatch",
        invoiceId: inv.id,
        erpAmount: inv.amount,
        billingAmount: b.amount,
        difference: (cents(b.amount) - cents(inv.amount)) / 100,
      });
    } else if (inv.status !== b.status) {
      issues.push({ type: "status_mismatch", invoiceId: inv.id, erpStatus: inv.status, billingStatus: b.status });
    } else {
      matched++;
    }
  }
  for (const b of billing) {
    if (!erpIds.has(b.invoice_id)) {
      issues.push({ type: "missing_in_erp", invoiceId: b.invoice_id, billingAmount: b.amount });
    }
  }

  return {
    summary: { erpCount: erp.length, billingCount: billing.length, matched, issues: issues.length },
    issues,
  };
}

export async function runReconciliation(erp: Database, billing: Database = erp): Promise<Reconciliation> {
  const [invoices, exported] = await Promise.all([
    erp.query<ErpInvoice>("SELECT id, amount, status FROM invoices"),
    billing.query<BillingRow>("SELECT invoice_id, amount, status FROM billing_export"),
  ]);
  return reconcile(invoices, exported);
}
