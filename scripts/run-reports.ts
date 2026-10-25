/**
 * Runs every saved report plus the reconciliation and writes out/digest.md.
 * Posts a summary to Slack when SLACK_WEBHOOK_URL is set. Run on a schedule by
 * .github/workflows/weekly-digest.yml.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config/index.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { loadDotEnv } from "../src/env.js";
import { postToSlack } from "../src/notify/index.js";
import { runReconciliation } from "../src/reconcile/index.js";
import { REPORTS, buildDigest, runReport } from "../src/reports/index.js";

loadDotEnv();
const config = loadConfig();
const erp = SqliteDatabase.open(config.erpDbPath, { readOnly: true });

const results = [];
for (const report of REPORTS) results.push(await runReport(report, { erp, asOf: config.asOf }));
const recon = await runReconciliation(erp);
erp.close();

const reconLine = `Reconciliation: ${recon.summary.matched} of ${recon.summary.erpCount} invoices match billing; ${recon.summary.issues} need review.`;
const digest = `${buildDigest(results, config.asOf)}\n## Reconciliation\n${reconLine}\n`;

mkdirSync("out", { recursive: true });
writeFileSync("out/digest.md", digest);
console.log(digest);

const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
if (webhook) {
  await postToSlack(webhook, digest);
  console.log("Posted digest to Slack.");
} else {
  console.log("SLACK_WEBHOOK_URL not set; skipped Slack.");
}
