import type { RequestRow, Route } from "../store/index.js";

/**
 * Assumptions behind the "hours saved" figure. They are estimates about a
 * manual process, not measurements, and are returned with every result so the
 * UI can say so. Change them to match a real organisation.
 */
export const ASSUMPTIONS = {
  minutesPerManualRequest: 45,
  hoursToAnswerManually: 16,
  note: "Baselines are assumptions about a manual process, not measured data.",
} as const;

export type WeekBucket = { weekStart: string; answered: number; escalated: number };

export type Impact = {
  /** Oldest to newest, gaps filled with zeros, at most the last 8 weeks. */
  byWeek: WeekBucket[];
  total: number;
  byRoute: Record<Route, number>;
  deflected: number;
  deflectionRate: number;
  estimatedHoursSaved: number;
  medianSelfServeSeconds: number | null;
  assumptions: typeof ASSUMPTIONS;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const DAY_MS = 864e5;

/** UTC Monday of the week containing the given ISO timestamp, as YYYY-MM-DD. */
function weekStart(iso: string): string {
  const day = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

function bucketByWeek(requests: readonly RequestRow[], isAnswered: (r: RequestRow) => boolean): WeekBucket[] {
  if (!requests.length) return [];
  const counts = new Map<string, { answered: number; escalated: number }>();
  for (const r of requests) {
    const key = weekStart(r.createdAt);
    const b = counts.get(key) ?? { answered: 0, escalated: 0 };
    if (isAnswered(r)) b.answered++;
    else b.escalated++;
    counts.set(key, b);
  }
  const keys = [...counts.keys()].sort();
  const out: WeekBucket[] = [];
  const last = Date.parse(keys.at(-1)! + "T00:00:00Z");
  for (let t = Date.parse(keys[0]! + "T00:00:00Z"); t <= last; t += 7 * DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ weekStart: key, ...(counts.get(key) ?? { answered: 0, escalated: 0 }) });
  }
  return out.slice(-8);
}

/** A request is deflected from IT when self-service actually answered it. */
export function computeImpact(requests: readonly RequestRow[]): Impact {
  const byRoute: Record<Route, number> = { saved_report: 0, ask_data: 0, needs_it: 0 };
  for (const r of requests) byRoute[r.route]++;

  const isAnswered = (r: RequestRow) => r.route !== "needs_it" && r.outcome === "answered";
  const answered = requests.filter(isAnswered);
  const total = requests.length;
  const seconds = median(answered.map((r) => r.durationMs / 1000));

  return {
    byWeek: bucketByWeek(requests, isAnswered),
    total,
    byRoute,
    deflected: answered.length,
    deflectionRate: total ? Math.round((answered.length / total) * 1000) / 10 : 0,
    estimatedHoursSaved: Math.round(((answered.length * ASSUMPTIONS.minutesPerManualRequest) / 60) * 10) / 10,
    medianSelfServeSeconds: seconds === null ? null : Math.round(seconds * 10) / 10,
    assumptions: ASSUMPTIONS,
  };
}
