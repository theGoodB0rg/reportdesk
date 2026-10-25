export type Example = { question: string; sql: string };

/**
 * Pre-written questions with hand-verified SQL. They keep the public demo
 * working when no LLM key is configured or the free quota is spent, and the
 * tests check every one still passes the guard and runs.
 */
export function exampleQuestions(asOf: string): Example[] {
  return [
    {
      question: "How many customers do we have in each region?",
      sql: "SELECT region, COUNT(*) AS customers FROM customers GROUP BY region ORDER BY customers DESC",
    },
    {
      question: "What are our top 5 products by units sold?",
      sql: `SELECT p.name AS product, SUM(oi.quantity) AS units
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN orders o ON o.id = oi.order_id
WHERE o.status != 'cancelled'
GROUP BY p.id ORDER BY units DESC LIMIT 5`,
    },
    {
      question: "What is the average order value by customer segment?",
      sql: `SELECT c.segment, ROUND(AVG(o.total), 2) AS avg_order_value, COUNT(*) AS orders
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE o.status != 'cancelled'
GROUP BY c.segment ORDER BY avg_order_value DESC`,
    },
    {
      question: "Which vendors have the most open purchase orders?",
      sql: `SELECT v.name AS vendor, COUNT(*) AS open_orders
FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
WHERE po.status = 'open'
GROUP BY v.id ORDER BY open_orders DESC`,
    },
    {
      question: "How much revenue did we book in the last 30 days?",
      sql: `SELECT ROUND(SUM(total), 2) AS revenue_last_30_days
FROM orders
WHERE status != 'cancelled' AND order_date > date('${asOf}', '-30 days')`,
    },
  ];
}
