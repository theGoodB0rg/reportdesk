import type { DatabaseSync } from "node:sqlite";

const literal = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** INSERT statements for the given tables, for loading into Cloudflare D1 with `wrangler d1 execute --file`. */
export function dumpInserts(db: DatabaseSync, tables: readonly string[]): string {
  const out: string[] = [];
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    for (const row of rows) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
    }
  }
  return out.join("\n") + "\n";
}
