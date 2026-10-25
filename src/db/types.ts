export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

/**
 * The only database surface the app depends on. Async so that a networked
 * driver (Cloudflare D1, Postgres) fits behind it without changing callers.
 */
export interface Database {
  query<T = Row>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
}

/** Wraps a database so writes are refused regardless of the driver. */
export function readOnly(db: Database): Database {
  return {
    query: (sql, params) => db.query(sql, params),
    run: () => Promise.reject(new Error("database is read-only")),
  };
}
