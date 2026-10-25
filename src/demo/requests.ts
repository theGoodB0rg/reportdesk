import type { Database } from "../db/types.js";
import { AppStore } from "../store/index.js";
import { triage } from "../triage/index.js";

/**
 * Sample requests of the kind a reporting inbox accumulates. Seeded so the
 * Impact page has something to show on a fresh deploy. This is illustrative
 * demo traffic, and the UI labels it as such.
 */
export const DEMO_REQUESTS: { department: string; text: string }[] = [
  { department: "finance", text: "Can I get the receivables aging report for month end?" },
  { department: "finance", text: "Which customers are past due and how much do they owe?" },
  { department: "finance", text: "Need the unpaid invoices list for the collections call" },
  { department: "finance", text: "Send me the AR report again, the Friday one" },
  { department: "finance", text: "What is the average order value by customer segment?" },
  { department: "finance", text: "Please give me access to the billing export" },
  { department: "sales", text: "Monthly sales report for the board deck" },
  { department: "sales", text: "Who are our top customers this year?" },
  { department: "sales", text: "Revenue by month, same as last quarter" },
  { department: "sales", text: "How many customers do we have in each region?" },
  { department: "sales", text: "What are our top 5 products by units sold?" },
  { department: "sales", text: "Sales trend for the last twelve months please" },
  { department: "sales", text: "Add a column for sales rep to the orders export" },
  { department: "operations", text: "Which products are low on stock right now?" },
  { department: "operations", text: "Inventory below reorder point by warehouse" },
  { department: "operations", text: "Are any items about to be out of stock?" },
  { department: "operations", text: "Show me the stock level report" },
  { department: "operations", text: "How much revenue did we book in the last 30 days?" },
  { department: "operations", text: "The warehouse dashboard is broken again" },
  { department: "procurement", text: "Which purchase orders are late?" },
  { department: "procurement", text: "Any vendor delays I should know about?" },
  { department: "procurement", text: "Which vendors have the most open purchase orders?" },
  { department: "procurement", text: "List late POs ahead of the supplier review" },
  { department: "procurement", text: "Supplier delay summary for this quarter" },
  { department: "procurement", text: "We need a new integration with the freight portal" },
  { department: "other", text: "Who are our largest customers by revenue?" },
  { department: "other", text: "Outstanding invoices older than 60 days?" },
  { department: "other", text: "Reset my password for the reporting tool" },
];

/**
 * Triage each sample and record it, spread evenly over the 28 days before
 * `now` so the weekly chart has a shape. Durations are fixed, plausible
 * values, so apart from `now` the output is deterministic.
 */
export async function seedDemoRequests(db: Database, now: Date = new Date()): Promise<number> {
  let current = now;
  const store = new AppStore(db, () => current);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  let i = 0;
  for (const req of DEMO_REQUESTS) {
    const daysAgo = 27 - Math.floor((i * 28) / DEMO_REQUESTS.length);
    current = new Date(midnight - daysAgo * 864e5 + (9 + ((i * 5) % 8)) * 36e5);
    const decision = triage(req.text);
    const answered = decision.route !== "needs_it";
    const durationMs = !answered ? 0 : decision.route === "saved_report" ? 180 + ((i * 37) % 300) : 1100 + ((i * 91) % 1400);
    await store.addRequest({
      department: req.department,
      text: req.text,
      route: decision.route,
      reportId: decision.reportId,
      outcome: answered ? "answered" : "escalated",
      durationMs,
    });
    i++;
  }
  return DEMO_REQUESTS.length;
}
