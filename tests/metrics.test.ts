import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, computeImpact } from "../src/metrics/index.js";
import type { RequestRow } from "../src/store/index.js";

const row = (over: Partial<RequestRow>): RequestRow => ({
  id: 1,
  createdAt: "2026-09-30T00:00:00.000Z",
  department: "finance",
  text: "x",
  route: "saved_report",
  outcome: "answered",
  durationMs: 1000,
  ...over,
});

describe("computeImpact", () => {
  it("handles no data", () => {
    expect(computeImpact([])).toMatchObject({
      total: 0,
      deflected: 0,
      deflectionRate: 0,
      medianSelfServeSeconds: null,
      byWeek: [],
    });
  });

  it("counts only self-service requests that were actually answered as deflected", () => {
    const impact = computeImpact([
      row({ route: "saved_report", durationMs: 200 }),
      row({ route: "ask_data", durationMs: 1000 }),
      row({ route: "ask_data", outcome: "escalated", durationMs: 50 }),
      row({ route: "needs_it", outcome: "escalated", durationMs: 0 }),
    ]);
    expect(impact.total).toBe(4);
    expect(impact.deflected).toBe(2);
    expect(impact.deflectionRate).toBe(50);
    expect(impact.byRoute).toEqual({ saved_report: 1, ask_data: 2, needs_it: 1 });
    expect(impact.medianSelfServeSeconds).toBe(0.6);
  });

  it("buckets by week starting Monday, filling empty weeks with zeros", () => {
    const impact = computeImpact([
      row({ createdAt: "2026-09-02T10:00:00.000Z" }), // Wednesday, week of Aug 31
      row({ createdAt: "2026-09-06T23:00:00.000Z", route: "needs_it", outcome: "escalated" }), // Sunday, same week
      row({ createdAt: "2026-09-21T09:00:00.000Z" }), // Monday, week of Sep 21
    ]);
    expect(impact.byWeek).toEqual([
      { weekStart: "2026-08-31", answered: 1, escalated: 1 },
      { weekStart: "2026-09-07", answered: 0, escalated: 0 },
      { weekStart: "2026-09-14", answered: 0, escalated: 0 },
      { weekStart: "2026-09-21", answered: 1, escalated: 0 },
    ]);
  });

  it("keeps at most the latest 8 weeks", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ createdAt: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString() }),
    );
    const { byWeek } = computeImpact(rows);
    expect(byWeek).toHaveLength(8);
    expect(byWeek.at(-1)!.weekStart).toBe("2026-03-23");
  });

  it("derives hours saved from the stated assumption and ships the assumptions with the result", () => {
    const impact = computeImpact(Array.from({ length: 4 }, () => row({})));
    expect(impact.estimatedHoursSaved).toBe((4 * ASSUMPTIONS.minutesPerManualRequest) / 60);
    expect(impact.assumptions.note).toMatch(/assumptions/i);
  });
});
