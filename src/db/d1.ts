import type { Database, Row, SqlValue } from "./types.js";

/** The slice of Cloudflare's D1 binding this app uses, typed locally to avoid a dependency. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: SqlValue[]): {
      all(): Promise<{ results?: unknown[] }>;
      run(): Promise<unknown>;
    };
  };
}

export class D1Adapter implements Database {
  constructor(private readonly d1: D1Like) {}

  async query<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const res = await this.d1
      .prepare(sql)
      .bind(...params)
      .all();
    return (res.results ?? []) as T[];
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.d1
      .prepare(sql)
      .bind(...params)
      .run();
  }
}
