import { describe, expect, it } from "vitest";
import { validateReadOnlySql } from "../src/sql-guard/index.js";

const opts = { allowedTables: ["customers", "orders", "invoices"], rowLimit: 100 };

const ok = (sql: string) => {
  const r = validateReadOnlySql(sql, opts);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.sql;
};
const rejected = (sql: string) => {
  const r = validateReadOnlySql(sql, opts);
  expect(r.ok, `should reject: ${sql}`).toBe(false);
};

describe("validateReadOnlySql: accepts", () => {
  it("a plain select", () => {
    expect(ok("SELECT id FROM customers")).toMatch(/SELECT id FROM customers/i);
  });

  it("joins across allowed tables", () => {
    ok("SELECT c.id FROM customers c JOIN orders o ON o.customer_id = c.id");
  });

  it("CTEs, without treating the CTE name as a forbidden table", () => {
    ok("WITH t AS (SELECT id FROM orders) SELECT * FROM t");
  });

  it("a trailing semicolon", () => {
    ok("SELECT 1 FROM customers;");
  });

  it("keywords that only appear inside string literals or comments", () => {
    ok("SELECT id FROM customers WHERE name = 'drop table x; delete'");
    ok("SELECT id FROM customers -- delete everything\n");
  });
});

describe("validateReadOnlySql: rejects", () => {
  it.each([
    "INSERT INTO customers VALUES (1)",
    "UPDATE customers SET name = 'x'",
    "DELETE FROM customers",
    "DROP TABLE customers",
    "ALTER TABLE customers ADD COLUMN x TEXT",
    "CREATE TABLE t (x)",
    "REPLACE INTO customers VALUES (1)",
    "PRAGMA table_info(customers)",
    "VACUUM",
    "ATTACH DATABASE 'x.db' AS x",
  ])("write or admin statement: %s", rejected);

  it("multiple statements", () => {
    rejected("SELECT 1 FROM customers; DROP TABLE customers");
    rejected("SELECT 1 FROM customers; SELECT 2 FROM orders");
  });

  it("a write hidden inside a CTE", () => {
    rejected("WITH x AS (SELECT 1) DELETE FROM customers");
  });

  it("tables outside the allowlist", () => {
    rejected("SELECT * FROM sqlite_master");
    rejected("SELECT * FROM users");
    rejected("SELECT * FROM customers JOIN secrets ON 1=1");
  });

  it("subquery tables outside the allowlist", () => {
    rejected("SELECT * FROM customers WHERE id IN (SELECT id FROM secrets)");
  });

  it("a CTE named after a forbidden table that reads the real table", () => {
    rejected("WITH secrets AS (SELECT * FROM secrets) SELECT * FROM secrets");
    rejected("WITH sqlite_master AS (SELECT * FROM sqlite_master) SELECT * FROM sqlite_master");
  });

  it("recursive CTEs, which can run unbounded", () => {
    rejected("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT n FROM r");
  });

  it("quoted identifiers, schema-qualified names and table functions", () => {
    rejected('SELECT * FROM "sqlite_master"');
    rejected("SELECT * FROM `sqlite_master`");
    rejected("SELECT * FROM [sqlite_master]");
    rejected("SELECT * FROM main.customers");
    rejected("SELECT * FROM pragma_table_info('customers')");
  });

  it("comma joins, which hide a second table from the allowlist check", () => {
    rejected("SELECT * FROM customers, secrets");
  });

  it("unterminated comments and strings", () => {
    rejected("SELECT 1 FROM customers /* never closed");
    rejected("SELECT 'oops FROM customers");
  });

  it("extension loading and file functions", () => {
    rejected("SELECT load_extension('x') FROM customers");
    rejected("SELECT readfile('/etc/passwd') FROM customers");
  });

  it("comment tricks that hide a second statement", () => {
    rejected("SELECT 1 FROM customers /* ; */ ; DROP TABLE customers");
  });

  it("empty or non-select input", () => {
    rejected("");
    rejected("   ");
    rejected("hello world");
  });
});

describe("validateReadOnlySql: row limit", () => {
  it("appends a LIMIT when none is present", () => {
    expect(ok("SELECT id FROM customers")).toMatch(/LIMIT 100$/i);
  });

  it("clamps a larger LIMIT down to the cap", () => {
    expect(ok("SELECT id FROM customers LIMIT 100000")).toMatch(/LIMIT 100$/i);
  });

  it("keeps a smaller LIMIT", () => {
    expect(ok("SELECT id FROM customers LIMIT 5")).toMatch(/LIMIT 5$/i);
  });
});
