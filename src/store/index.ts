import type { Database } from "../db/types.js";

export type Route = "saved_report" | "ask_data" | "needs_it";
export type Outcome = "answered" | "escalated";

export type RequestRecord = {
  department: string;
  text: string;
  route: Route;
  reportId?: string;
  outcome: Outcome;
  durationMs: number;
};

export type RequestRow = RequestRecord & { id: number; createdAt: string };

export type AuditEntry = {
  question: string;
  sql?: string;
  outcome: "ok" | "rejected" | "error";
  rowCount?: number;
  reason?: string;
};

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

/** App-owned state: the request log and the audit trail of every generated query. */
export class AppStore implements AuditSink {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async addRequest(r: RequestRecord): Promise<void> {
    await this.db.run(
      "INSERT INTO requests (created_at, department, text, route, report_id, outcome, duration_ms) VALUES (?,?,?,?,?,?,?)",
      [this.now().toISOString(), r.department, r.text, r.route, r.reportId ?? null, r.outcome, Math.round(r.durationMs)],
    );
  }

  async listRequests(limit = 1000): Promise<RequestRow[]> {
    const rows = await this.db.query<{
      id: number;
      created_at: string;
      department: string;
      text: string;
      route: Route;
      report_id: string | null;
      outcome: Outcome;
      duration_ms: number;
    }>("SELECT * FROM requests ORDER BY id DESC LIMIT ?", [limit]);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      department: r.department,
      text: r.text,
      route: r.route,
      reportId: r.report_id ?? undefined,
      outcome: r.outcome,
      durationMs: r.duration_ms,
    }));
  }

  async record(e: AuditEntry): Promise<void> {
    await this.db.run(
      "INSERT INTO audit_log (ts, question, sql, outcome, row_count, reason) VALUES (?,?,?,?,?,?)",
      [this.now().toISOString(), e.question, e.sql ?? null, e.outcome, e.rowCount ?? null, e.reason ?? null],
    );
  }

  async listAudit(limit = 50): Promise<(AuditEntry & { ts: string })[]> {
    const rows = await this.db.query<{
      ts: string;
      question: string;
      sql: string | null;
      outcome: AuditEntry["outcome"];
      row_count: number | null;
      reason: string | null;
    }>("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", [limit]);
    return rows.map((r) => ({
      ts: r.ts,
      question: r.question,
      sql: r.sql ?? undefined,
      outcome: r.outcome,
      rowCount: r.row_count ?? undefined,
      reason: r.reason ?? undefined,
    }));
  }
}
