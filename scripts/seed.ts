import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { seedDemoRequests } from "../src/demo/requests.js";
import { APP_DDL, ERP_DDL } from "../src/db/schema.js";
import { seedErp } from "../src/db/seed.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { loadDotEnv } from "../src/env.js";

loadDotEnv();
const config = loadConfig();

for (const path of [config.erpDbPath, config.appDbPath]) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
}

const erp = SqliteDatabase.open(config.erpDbPath);
erp.exec(ERP_DDL);
seedErp(erp.raw, { asOf: config.asOf });
erp.close();

const app = SqliteDatabase.open(config.appDbPath);
app.exec(APP_DDL);
const demo = await seedDemoRequests(app);
app.close();

console.log(`Seeded ${config.erpDbPath} and ${config.appDbPath} (${demo} demo requests, as of ${config.asOf}).`);
