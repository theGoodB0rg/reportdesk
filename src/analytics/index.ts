import type { Database } from "../db/types.js";

/**
 * Privacy-first usage counts. An event is a name from a fixed list, plus where the visitor came from
 * and their country, counted per hour. No cookies, no addresses, no identifiers and no free text are
 * stored, so there is nothing personal to leak, and unknown names are rejected.
 */

export const EVENT_NAMES = [
  "session_start",
  "view_overview",
  "view_assistant",
  "view_reports",
  "view_ask",
  "view_requests",
  "view_reconcile",
  "view_impact",
  "view_about",
  "assistant_run",
  "ask_run",
  "request_submit",
  "export_csv",
  "click_portfolio",
  "click_repo",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const isEventName = (value: unknown): value is EventName => EVENT_NAMES.includes(value as EventName);

/** A short, safe label such as "application", "github" or "www.linkedin.com". Anything else becomes "direct". */
export function cleanSource(raw: unknown): string {
  if (typeof raw !== "string") return "direct";
  const value = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(value) ? value : "direct";
}

/** Two-letter country code from Cloudflare's header, or "xx" when unknown. */
export function cleanCountry(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(value) ? value : "xx";
}

export class EventStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(event: { name: EventName; source?: unknown; country?: string | null }): Promise<void> {
    const hour = this.now().toISOString().slice(0, 13); // e.g. 2026-10-25T09 (UTC)
    await this.db.run(
      "INSERT INTO events (hour, name, source, country, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(hour, name, source, country) DO UPDATE SET count = count + 1",
      [hour, event.name, cleanSource(event.source), cleanCountry(event.country)],
    );
  }
}
