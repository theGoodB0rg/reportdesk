/**
 * Validates LLM-generated SQL before it reaches the database.
 *
 * This is one layer of defence, not the only one: the query also runs on a
 * read-only connection (see src/db). The guard is deliberately conservative -
 * it rejects anything it cannot positively classify as a plain, bounded read.
 */

export type GuardOptions = {
  allowedTables: readonly string[];
  rowLimit: number;
};

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const fail = (reason: string): GuardResult => ({ ok: false, reason });

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|pragma|vacuum|attach|detach|reindex|analyze|truncate|recursive|load_extension|readfile|writefile|fts3_tokenizer)\b|\breplace\s+into\b/i;

type Scanned = { clean: string; skeleton: string } | { error: string };

/**
 * One pass over the input. `clean` has comments removed; `skeleton` also has
 * string literal contents blanked so keyword checks cannot be fooled by (or
 * trip over) text inside quotes. Quoted identifiers are refused outright,
 * because they would let a table name hide from the skeleton checks.
 */
function scan(sql: string): Scanned {
  let clean = "";
  let skeleton = "";
  for (let i = 0; i < sql.length; ) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      clean += " ";
      skeleton += " ";
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return { error: "unterminated block comment" };
      i = end + 2;
      clean += " ";
      skeleton += " ";
    } else if (c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return { error: "unterminated string literal" };
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      clean += sql.slice(i, j + 1);
      skeleton += "''";
      i = j + 1;
    } else if (c === '"' || c === "`" || c === "[") {
      return { error: "quoted identifiers are not allowed" };
    } else {
      clean += c;
      skeleton += c;
      i++;
    }
  }
  return { clean, skeleton };
}

/** Index of the paren matching the one at `open`, or -1. Safe on the skeleton. */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * CTE names, or an error if one reads from a table of its own name. Without
 * that check, `WITH secrets AS (SELECT * FROM secrets) ...` would exempt
 * `secrets` from the allowlist while still reading the real table.
 */
function cteNames(skeleton: string): { names: Set<string> } | { error: string } {
  const names = new Set<string>();
  const re = /\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  for (const m of skeleton.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    const open = m.index! + m[0].length - 1;
    const close = matchingParen(skeleton, open);
    if (close === -1) return { error: "unbalanced parentheses" };
    const body = skeleton.slice(open, close);
    if (new RegExp(`\\b(?:from|join)\\s+${name}\\b`, "i").test(body)) {
      return { error: `CTE "${name}" may not read from a table of the same name` };
    }
    names.add(name);
  }
  return { names };
}

export function validateReadOnlySql(input: string, opts: GuardOptions): GuardResult {
  const scanned = scan(input);
  if ("error" in scanned) return fail(scanned.error);

  let { clean, skeleton } = scanned;
  clean = clean.trim();
  skeleton = skeleton.trim();
  if (skeleton.endsWith(";")) {
    clean = clean.slice(0, -1).trimEnd();
    skeleton = skeleton.slice(0, -1).trimEnd();
  }
  if (!skeleton) return fail("empty query");
  if (skeleton.includes(";")) return fail("multiple statements are not allowed");
  if (!/^(select|with)\b/i.test(skeleton)) return fail("only SELECT queries are allowed");
  if (FORBIDDEN.test(skeleton)) return fail("query contains a forbidden keyword");
  if (/\bfrom\s+[a-z_][a-z0-9_]*(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,/i.test(skeleton)) {
    return fail("comma joins are not allowed; use an explicit JOIN");
  }

  const ctes = cteNames(skeleton);
  if ("error" in ctes) return fail(ctes.error);

  const allowed = new Set(opts.allowedTables.map((t) => t.toLowerCase()));
  for (const m of skeleton.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s*([.(])?/gi)) {
    const table = m[1]!.toLowerCase();
    if (m[2]) return fail("schema-qualified names and table functions are not allowed");
    if (!allowed.has(table) && !ctes.names.has(table)) {
      return fail(`table "${table}" is not available`);
    }
  }

  const limit = clean.match(/\blimit\s+(\d+)(\s+offset\s+\d+)?$/i);
  if (limit) {
    const capped = Math.min(Number(limit[1]), opts.rowLimit);
    clean = clean.slice(0, limit.index) + `LIMIT ${capped}${limit[2] ?? ""}`;
  } else {
    clean += ` LIMIT ${opts.rowLimit}`;
  }
  return { ok: true, sql: clean };
}
