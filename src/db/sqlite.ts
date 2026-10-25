import { DatabaseSync } from "node:sqlite";
import type { Database, Row, SqlValue } from "./types.js";

export class SqliteDatabase implements Database {
  private constructor(readonly raw: DatabaseSync) {}

  /** A read-only open makes SQLite itself refuse writes, independent of the SQL guard. */
  static open(path: string, opts: { readOnly?: boolean } = {}): SqliteDatabase {
    return new SqliteDatabase(new DatabaseSync(path, { readOnly: opts.readOnly ?? false }));
  }

  async query<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.raw.prepare(sql).run(...params);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }
}
