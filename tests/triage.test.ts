import { describe, expect, it } from "vitest";
import { DEMO_REQUESTS } from "../src/demo/requests.js";
import { REPORTS } from "../src/reports/index.js";
import { triage } from "../src/triage/index.js";

describe("triage: saved reports", () => {
  it.each([
    ["Can I get the receivables aging report for month end?", "ar_aging"],
    ["Need the unpaid invoices list for the collections call", "ar_aging"],
    ["Send me the AR report again", "ar_aging"],
    ["Which customers are past due and how much do they owe?", "overdue_by_customer"],
    ["Monthly sales report for the board deck", "sales_by_month"],
    ["Revenue by month, same as last quarter", "sales_by_month"],
    ["Who are our top customers this year?", "top_customers"],
    ["Which products are low on stock right now?", "low_stock"],
    ["Inventory below reorder point by warehouse", "low_stock"],
    ["Which purchase orders are late?", "late_purchase_orders"],
    ["Any vendor delays I should know about?", "late_purchase_orders"],
  ])("%s -> %s", (text, reportId) => {
    expect(triage(text)).toMatchObject({ route: "saved_report", reportId });
  });

  it("only ever points at reports that exist", () => {
    const ids = new Set(REPORTS.map((r) => r.id));
    for (const req of DEMO_REQUESTS) {
      const t = triage(req.text);
      if (t.reportId) expect(ids.has(t.reportId), req.text).toBe(true);
    }
  });
});

describe("triage: ad-hoc data questions", () => {
  it.each([
    "How many customers do we have in each region?",
    "What are our top 5 products by units sold?",
    "Which vendors have the most open purchase orders?",
    "What is the average order value by customer segment?",
  ])("%s -> ask_data", (text) => {
    expect(triage(text).route).toBe("ask_data");
  });
});

describe("triage: needs IT", () => {
  it.each([
    "Please give me access to the billing export",
    "Reset my password for the reporting tool",
    "The warehouse dashboard is broken again",
    "We need a new integration with the freight portal",
    "Add a column for sales rep to the orders export",
  ])("%s -> needs_it", (text) => {
    expect(triage(text).route).toBe("needs_it");
  });

  it("sends access requests to IT even when they mention a report", () => {
    expect(triage("give me access to the aging report").route).toBe("needs_it");
  });

  it("routes unclear requests to IT rather than guessing", () => {
    expect(triage("thanks").route).toBe("needs_it");
  });
});
