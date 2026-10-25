import type { Database, Row, SqlValue } from "../db/types.js";

export type Report = {
  id: string;
  title: string;
  description: string;
  /** Phrases the triage step uses to recognise a request this report already answers. */
  keywords: string[];
  sql: string;
  params: (ctx: { asOf: string }) => SqlValue[];
};

export type ReportResult = {
  id: string;
  title: string;
  description: string;
  columns: string[];
  rows: Row[];
};

const BALANCE = "i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)";

export const REPORTS: readonly Report[] = [
  {
    id: "ar_aging",
    title: "Receivables aging",
    description: "Open invoice balances grouped by how long they are past due.",
    keywords: ["aging", "ageing", "receivable", "ar report", "outstanding invoices", "unpaid invoices"],
    sql: `WITH ctx AS (SELECT ? AS as_of),
open_inv AS (
  SELECT ${BALANCE} AS balance,
         CAST(julianday(ctx.as_of) - julianday(i.due_date) AS INTEGER) AS days_overdue
  FROM invoices i CROSS JOIN ctx
  WHERE i.status = 'open'
)
SELECT CASE WHEN days_overdue <= 0 THEN '1. Current'
            WHEN days_overdue <= 30 THEN '2. 1-30 days'
            WHEN days_overdue <= 60 THEN '3. 31-60 days'
            WHEN days_overdue <= 90 THEN '4. 61-90 days'
            ELSE '5. 90+ days' END AS bucket,
       COUNT(*) AS invoices,
       ROUND(SUM(balance), 2) AS balance
FROM open_inv GROUP BY bucket ORDER BY bucket`,
    params: ({ asOf }) => [asOf],
  },
  {
    id: "overdue_by_customer",
    title: "Overdue balances by customer",
    description: "The ten customers owing the most on invoices past their due date.",
    keywords: ["overdue", "past due", "late payment", "who owes", "collections"],
    sql: `WITH ctx AS (SELECT ? AS as_of)
SELECT c.name AS customer,
       COUNT(*) AS overdue_invoices,
       ROUND(SUM(${BALANCE}), 2) AS balance_overdue
FROM invoices i JOIN customers c ON c.id = i.customer_id CROSS JOIN ctx
WHERE i.status = 'open' AND i.due_date < ctx.as_of
GROUP BY c.id ORDER BY balance_overdue DESC LIMIT 10`,
    params: ({ asOf }) => [asOf],
  },
  {
    id: "sales_by_month",
    title: "Sales by month",
    description: "Order count and revenue per month, excluding cancelled orders.",
    keywords: ["sales by month", "monthly sales", "revenue by month", "monthly revenue", "sales trend", "sales report"],
    sql: `SELECT strftime('%Y-%m', order_date) AS month, COUNT(*) AS orders, ROUND(SUM(total), 2) AS revenue
FROM orders WHERE status != 'cancelled' GROUP BY month ORDER BY month`,
    params: () => [],
  },
  {
    id: "top_customers",
    title: "Top customers by revenue",
    description: "The ten highest-revenue customers over the period, excluding cancelled orders.",
    keywords: ["top customers", "best customers", "biggest customers", "largest customers", "customer ranking"],
    sql: `SELECT c.name AS customer, c.segment, COUNT(o.id) AS orders, ROUND(SUM(o.total), 2) AS revenue
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.status != 'cancelled' GROUP BY c.id ORDER BY revenue DESC LIMIT 10`,
    params: () => [],
  },
  {
    id: "low_stock",
    title: "Low stock",
    description: "Products below their reorder point, by warehouse, largest shortfall first.",
    keywords: ["low stock", "low on stock", "stock level", "reorder", "inventory", "out of stock", "stockout"],
    sql: `SELECT p.sku, p.name AS product, i.warehouse, i.on_hand, i.reorder_point,
       (i.reorder_point - i.on_hand) AS shortfall
FROM inventory i JOIN products p ON p.id = i.product_id
WHERE i.on_hand < i.reorder_point ORDER BY shortfall DESC`,
    params: () => [],
  },
  {
    id: "late_purchase_orders",
    title: "Late purchase orders",
    description: "Open purchase orders past their expected delivery date.",
    keywords: ["late purchase", "overdue purchase", "late po", "orders are late", "vendor delay", "supplier delay"],
    sql: `SELECT po.id AS po, v.name AS vendor, p.name AS product, po.quantity, po.expected_date,
       CAST(julianday(?) - julianday(po.expected_date) AS INTEGER) AS days_late
FROM purchase_orders po
JOIN vendors v ON v.id = po.vendor_id
JOIN products p ON p.id = po.product_id
WHERE po.status = 'open' AND po.expected_date < ?
ORDER BY days_late DESC`,
    params: ({ asOf }) => [asOf, asOf],
  },
];

export const getReport = (id: string): Report | undefined => REPORTS.find((r) => r.id === id);

export async function runReport(
  report: Report,
  deps: { erp: Database; asOf: string },
): Promise<ReportResult> {
  const rows = await deps.erp.query(report.sql, report.params({ asOf: deps.asOf }));
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    rows,
  };
}

/**
 * CSV for Excel / Power BI / Tableau. Text cells that start with a formula
 * character are prefixed so a spreadsheet won't execute them (CSV injection).
 */
export function toCsv(columns: string[], rows: Row[]): string {
  const cell = (v: unknown): string => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

function markdownTable(columns: string[], rows: Row[]): string {
  if (!columns.length) return "_No rows._";
  const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|");
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${columns.map((c) => esc(r[c])).join(" | ")} |`),
  ].join("\n");
}

/** A plain-text digest of every report, for email, Slack or an Actions artifact. */
export function buildDigest(results: ReportResult[], asOf: string, rowsPerReport = 10): string {
  const sections = results.map((r) => {
    const shown = r.rows.slice(0, rowsPerReport);
    const more = r.rows.length > shown.length ? `\n_${r.rows.length - shown.length} more rows not shown._` : "";
    return `## ${r.title}\n${r.description}\n\n${markdownTable(r.columns, shown)}${more}`;
  });
  return `# Weekly operations digest (as of ${asOf})\n\n${sections.join("\n\n")}\n`;
}
