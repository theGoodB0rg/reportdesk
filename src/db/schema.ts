/** Mock ERP, shaped like the order-to-cash and procure-to-pay core of a typical mid-size ERP. */
export const ERP_DDL = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('Enterprise','Mid-Market','SMB')),
  region TEXT NOT NULL,
  credit_limit REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','shipped','cancelled')),
  total REAL NOT NULL
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','paid'))
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  paid_date TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE TABLE inventory (
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse TEXT NOT NULL,
  on_hand INTEGER NOT NULL,
  reorder_point INTEGER NOT NULL,
  PRIMARY KEY (product_id, warehouse)
);
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL
);
CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  ordered_date TEXT NOT NULL,
  expected_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','received'))
);
-- Second system: an export from the billing platform, used for reconciliation.
CREATE TABLE billing_export (
  invoice_id INTEGER PRIMARY KEY,
  amount REAL NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
`;

/** App-owned state (request log, audit trail). Separate from the ERP so the ERP connection can stay read-only. */
export const APP_DDL = `
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  department TEXT NOT NULL,
  text TEXT NOT NULL,
  route TEXT NOT NULL,
  report_id TEXT,
  outcome TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE TABLE events (
  hour TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (hour, name, source, country)
);
CREATE TABLE usage (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  question TEXT NOT NULL,
  sql TEXT,
  outcome TEXT NOT NULL,
  row_count INTEGER,
  reason TEXT
);
`;

/** Tables the natural-language endpoint may read. */
export const QUERYABLE_TABLES = [
  "customers",
  "products",
  "orders",
  "order_items",
  "invoices",
  "payments",
  "inventory",
  "vendors",
  "purchase_orders",
] as const;

/** Schema description handed to the LLM. Dates are ISO text (YYYY-MM-DD). */
export const SCHEMA_DOC = `
customers(id, name, segment['Enterprise'|'Mid-Market'|'SMB'], region, credit_limit, created_at)
products(id, sku, name, category, unit_price, unit_cost)
orders(id, customer_id -> customers.id, order_date, status['open'|'shipped'|'cancelled'], total)
order_items(id, order_id -> orders.id, product_id -> products.id, quantity, unit_price)
invoices(id, order_id -> orders.id, customer_id -> customers.id, issue_date, due_date, amount, status['open'|'paid'])
payments(id, invoice_id -> invoices.id, paid_date, amount)   -- an open invoice may have partial payments
inventory(product_id -> products.id, warehouse, on_hand, reorder_point)
vendors(id, name, lead_time_days)
purchase_orders(id, vendor_id -> vendors.id, product_id -> products.id, quantity, ordered_date, expected_date, status['open'|'received'])
`.trim();

/** How the business talks about the data. Shared by every prompt so answers match the saved reports. */
export const BUSINESS_DEFINITIONS = `
- Revenue and sales mean orders.total where orders.status != 'cancelled'. Do not restrict to shipped orders unless asked.
- Revenue by product or category must come from order_items (quantity * unit_price) joined to orders where orders.status != 'cancelled'. Never SUM(orders.total) after joining order_items: that repeats each order's total once per line item.
- An invoice is overdue when invoices.status = 'open' AND invoices.due_date is before today.
- An invoice's outstanding balance is invoices.amount minus the sum of its payments.
- "Low stock" means inventory.on_hand < inventory.reorder_point.
`.trim();
