import { REPORTS, type Report } from "../reports/index.js";
import type { Route } from "../store/index.js";

export type TriageResult = { route: Route; reportId?: string; reason: string };

/** Work that changes systems or permissions is IT's, however the request is phrased. */
const IT_WORK =
  /\b(access|permission|password|log ?in|install|bug|broken|not working|migrat\w*|new (field|column|table|integration|connector)|add (a )?(field|column))\b/i;

const QUESTION_LIKE = /^(what|which|who|how|when|where|show|list|give me|top|total|average|count|compare)\b/i;

/**
 * Decides where a reporting request should go. Deliberately rule-based: it is
 * instant, free, explainable to the requester, and testable line by line.
 * An LLM classifier could replace it behind the same signature.
 */
export function triage(text: string, reports: readonly Report[] = REPORTS): TriageResult {
  const t = text.toLowerCase();

  if (IT_WORK.test(t)) {
    return { route: "needs_it", reason: "Involves access or a change to a system, which needs IT." };
  }

  let best: { report: Report; score: number } | null = null;
  for (const report of reports) {
    const score = report.keywords.filter((k) => t.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) best = { report, score };
  }
  if (best) {
    return {
      route: "saved_report",
      reportId: best.report.id,
      reason: `Already answered by the "${best.report.title}" report.`,
    };
  }

  if (QUESTION_LIKE.test(t.trim()) || t.includes("?")) {
    return { route: "ask_data", reason: "A data question that can be answered with a generated query." };
  }

  return { route: "needs_it", reason: "Unclear request; routed to IT for follow-up." };
}
