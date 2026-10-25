/**
 * Writes d1/erp.sql and d1/app.sql for loading into Cloudflare D1:
 *   npx wrangler d1 execute reportdesk-erp --remote --file=d1/erp.sql
 *   npx wrangler d1 execute reportdesk-app --remote --file=d1/app.sql
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/config/index.js";
import { seedDemoRequests } from "../src/demo/requests.js";
import { dumpInserts } from "../src/db/dump.js";
import { APP_DDL, ERP_DDL } from "../src/db/schema.js";
import { seedErp } from "../src/db/seed.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { loadDotEnv } from "../src/env.js";

loadDotEnv();
const { asOf } = loadConfig();
mkdirSync("d1", { recursive: true });

const erp = new DatabaseSync(":memory:");
erp.exec(ERP_DDL);
seedErp(erp, { asOf });
const erpTables = [
  "customers", "products", "orders", "order_items", "invoices", "payments",
  "inventory", "vendors", "purchase_orders", "billing_export",
];
writeFileSync("d1/erp.sql", ERP_DDL + "\n" + dumpInserts(erp, erpTables));

const app = SqliteDatabase.open(":memory:");
app.exec(APP_DDL);
await seedDemoRequests(app);
writeFileSync("d1/app.sql", APP_DDL + "\n" + dumpInserts(app.raw, ["requests"]));

console.log("Wrote d1/erp.sql and d1/app.sql");
