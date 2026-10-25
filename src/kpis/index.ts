import type { Database } from "../db/types.js";

export type Kpis = {
  asOf: string;
  openReceivables: number;
  overdueReceivables: number;
  /** Overdue as a percentage of open receivables, one decimal. */
  overdueShare: number;
  over90Receivables: number;
  revenueLast30: number;
  revenuePrev30: number;
  /** Change vs the previous 30 days, one decimal; null when there is no prior period to compare. */
  revenueChangePct: number | null;
  lowStockItems: number;
  latePurchaseOrders: number;
};

const BALANCE = "i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Headline numbers for the overview. Plain SQL, so each is easy to audit against the saved reports. */
export async function computeKpis(erp: Database, asOf: string): Promise<Kpis> {
  const one = async (sql: string, params: (string | number)[] = []): Promise<number> => {
    const rows = await erp.query<{ v: number | null }>(sql, params);
    return Number(rows[0]?.v ?? 0);
  };

  const [open, overdue, over90, rev30, revPrev, lowStock, latePos] = await Promise.all([
    one(`SELECT SUM(${BALANCE}) AS v FROM invoices i WHERE i.status = 'open'`),
    one(`SELECT SUM(${BALANCE}) AS v FROM invoices i WHERE i.status = 'open' AND i.due_date < ?`, [asOf]),
    one(`SELECT SUM(${BALANCE}) AS v FROM invoices i WHERE i.status = 'open' AND i.due_date < date(?, '-90 days')`, [asOf]),
    one(
      `SELECT SUM(total) AS v FROM orders
       WHERE status != 'cancelled' AND order_date > date(?, '-30 days') AND order_date <= ?`,
      [asOf, asOf],
    ),
    one(
      `SELECT SUM(total) AS v FROM orders
       WHERE status != 'cancelled' AND order_date > date(?, '-60 days') AND order_date <= date(?, '-30 days')`,
      [asOf, asOf],
    ),
    one("SELECT COUNT(*) AS v FROM inventory WHERE on_hand < reorder_point"),
    one("SELECT COUNT(*) AS v FROM purchase_orders WHERE status = 'open' AND expected_date < ?", [asOf]),
  ]);

  return {
    asOf,
    openReceivables: round2(open),
    overdueReceivables: round2(overdue),
    overdueShare: open > 0 ? Math.round((overdue / open) * 1000) / 10 : 0,
    over90Receivables: round2(over90),
    revenueLast30: round2(rev30),
    revenuePrev30: round2(revPrev),
    revenueChangePct: revPrev > 0 ? Math.round(((rev30 - revPrev) / revPrev) * 1000) / 10 : null,
    lowStockItems: lowStock,
    latePurchaseOrders: latePos,
  };
}
