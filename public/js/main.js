import { barChart, chartCard, columnChart, stackedColumns } from "./charts.js";
import { PORTFOLIO_URL, REPO_URL, api, compactMoney, compactNumber, dateLabel, el, humanize, icon, int, labelize, money, moneyWhole, postJson, richText, shortDate, track, trackSessionStart } from "./lib.js";
import { dataTable, formatValue, inferType, pill } from "./table.js";

const $ = (id) => document.getElementById(id);
const stripOrder = (s) => String(s).replace(/^\d+\.\s*/, "");

/* Small building blocks -------------------------------------------------- */

function tile({ label, value, note, delta, href }) {
  const body = [
    el("span", { class: "tile-label" }, label),
    el("span", { class: "tile-value" }, value),
    delta
      ? el("span", { class: `tile-note delta delta-${delta.good ? "good" : "warn"}` }, el("span", { "aria-hidden": "true" }, delta.up ? "▲ " : "▼ "), delta.text)
      : el("span", { class: "tile-note" }, note ?? ""),
  ];
  return href ? el("a", { class: "tile tile-link", href }, ...body) : el("div", { class: "tile" }, ...body);
}

const callout = (title, body, tone = "info") =>
  el("aside", { class: `callout callout-${tone}` }, el("strong", {}, title), el("p", {}, body));

const message = (text, kind = "") => el("p", { class: `msg ${kind}`.trim(), role: kind === "error" ? "alert" : "status" }, text);

function card(...children) {
  return el("section", { class: "card" }, ...children);
}

const REPORT_BAR = {
  ar_aging: "balance",
  overdue_by_customer: "balance_overdue",
  top_customers: "revenue",
  low_stock: "shortfall",
  late_purchase_orders: "days_late",
  sales_by_month: "revenue",
};

const REPORT_OVERRIDES = {
  ar_aging: { bucket: { label: "Age bucket", render: stripOrder } },
  late_purchase_orders: { po: { type: "text", label: "PO" } },
};

const SAFEGUARDS = ["Read-only connection", "Approved tables only", "Row-limited", "Logged for audit"];

/* Pages ------------------------------------------------------------------ */

async function overview() {
  const [kpi, aging, sales, overdue] = await Promise.all([
    api("/api/kpis"),
    api("/api/reports/ar_aging"),
    api("/api/reports/sales_by_month"),
    api("/api/reports/overdue_by_customer"),
  ]);
  if (![kpi, aging, sales, overdue].every((r) => r.ok)) throw new Error("load");
  const k = kpi.data;
  const openInvoices = aging.data.rows.reduce((s, r) => s + r.invoices, 0);
  const pctOfOpen = (v) => (k.openReceivables ? `${((v / k.openReceivables) * 100).toFixed(1)}% of open balance` : "");
  const change = k.revenueChangePct;

  const tiles = el(
    "div",
    { class: "tiles tiles-3" },
    tile({ label: "Open receivables", value: moneyWhole(k.openReceivables), note: `${int(openInvoices)} open invoices`, href: "#reports/ar_aging" }),
    tile({ label: "Overdue", value: moneyWhole(k.overdueReceivables), note: pctOfOpen(k.overdueReceivables), href: "#reports/overdue_by_customer" }),
    tile({ label: "Over 90 days", value: moneyWhole(k.over90Receivables), note: pctOfOpen(k.over90Receivables), href: "#reports/ar_aging" }),
    tile({
      label: "Revenue, last 30 days",
      value: moneyWhole(k.revenueLast30),
      note: "",
      delta: change == null ? null : { up: change >= 0, good: change >= 0, text: `${Math.abs(change)}% vs prior 30 days` },
      href: "#reports/sales_by_month",
    }),
    tile({ label: "Low-stock items", value: int(k.lowStockItems), note: "Below reorder point, by warehouse", href: "#reports/low_stock" }),
    tile({ label: "Late purchase orders", value: int(k.latePurchaseOrders), note: "Open and past expected date", href: "#reports/late_purchase_orders" }),
  );

  const agingData = aging.data.rows.map((r) => ({ label: stripOrder(r.bucket), value: r.balance, detail: `${int(r.invoices)} invoices` }));
  const agingCard = chartCard({
    title: "Receivables by age",
    subtitle: "Open balance, by days past due",
    build: (box) => barChart(box, { data: agingData, format: compactMoney, tipFormat: moneyWhole, ariaLabel: "Open receivables by age bucket" }),
    tableView: () =>
      dataTable({ title: "Receivables by age", rows: agingData.map((d) => ({ bucket: d.label, balance: d.value, detail: d.detail })), columns: ["bucket", "balance", "detail"], overrides: { bucket: { label: "Age bucket" }, detail: { label: "Invoices" } } }),
  });

  const monthName = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const monthLong = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const salesData = sales.data.rows.map((r, i) => {
    const d = new Date(`${r.month}-01T00:00:00Z`);
    const yearTag = i === 0 || r.month.endsWith("-01") ? ` '${String(d.getUTCFullYear()).slice(2)}` : "";
    return { label: monthName.format(d) + yearTag, title: monthLong.format(d), value: r.revenue, detail: `${int(r.orders)} orders` };
  });
  const salesCard = chartCard({
    title: "Revenue by month",
    subtitle: "Excludes cancelled orders",
    build: (box) => columnChart(box, { data: salesData, format: compactMoney, tipFormat: moneyWhole, axisFormat: compactMoney, ariaLabel: "Revenue by month" }),
    tableView: () => dataTable({ title: "Revenue by month", rows: sales.data.rows, columns: ["month", "orders", "revenue"], pageSize: 12 }),
  });

  const top = dataTable({
    title: "Largest overdue balances",
    subtitle: "Top five customers by balance past due",
    rows: overdue.data.rows.slice(0, 5),
    bar: "balance_overdue",
    overrides: { overdue_invoices: { label: "Overdue invoices" }, balance_overdue: { label: "Balance overdue" } },
    exportHref: "/api/reports/overdue_by_customer.csv",
  });

  return {
    title: "Operations overview",
    subtitle: `Receivables, revenue and supply signals as of ${dateLabel(k.asOf)}.`,
    nodes: [tiles, el("div", { class: "grid-2" }, agingCard, salesCard), top],
  };
}

async function reports({ param }) {
  const list = await api("/api/reports");
  if (!list.ok) throw new Error("load");
  const active = list.data.reports.find((r) => r.id === param) ?? list.data.reports[0];
  const result = await api(`/api/reports/${active.id}`);
  if (!result.ok) throw new Error("load");

  const nav = el(
    "nav",
    { class: "report-list", "aria-label": "Saved reports" },
    ...list.data.reports.map((r) =>
      el("a", { class: "report-link", href: `#reports/${r.id}`, "aria-current": r.id === active.id ? "page" : null }, el("span", { class: "report-link-title" }, r.title), el("span", { class: "report-link-desc" }, r.description)),
    ),
  );

  const table = dataTable({
    title: active.title,
    subtitle: active.description,
    rows: result.data.rows,
    bar: REPORT_BAR[active.id],
    overrides: REPORT_OVERRIDES[active.id] ?? {},
    exportHref: `/api/reports/${active.id}.csv`,
  });

  return {
    title: "Saved reports",
    subtitle: "Answers to the requests IT used to get by email. Every report exports as CSV for Excel, Power BI or Tableau.",
    nodes: [el("div", { class: "split" }, nav, table)],
  };
}

async function ask() {
  const [health, examples] = await Promise.all([api("/api/health"), api("/api/examples")]);
  const result = el("div", { class: "ask-result", "aria-live": "polite" });
  const input = el("textarea", { id: "ask-q", rows: 2, maxLength: 500, required: true, placeholder: "e.g. Which three West-region customers have the highest order value?", "data-gramm": "false", "data-enable-grammarly": "false" });
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, icon("send", 16), "Ask");

  async function run(question) {
    track("ask_run");
    submit.disabled = true;
    result.replaceChildren(message("Writing and checking the query…"));
    const { ok, data } = await postJson("/api/ask", { question });
    submit.disabled = false;
    result.replaceChildren(ok ? answerCard(question, data) : errorAnswer(data));
  }

  const form = el(
    "form",
    { class: "ask-form", onsubmit: (e) => { e.preventDefault(); run(input.value); } },
    el("label", { class: "sr-only", htmlFor: "ask-q" }, "Your question"),
    input,
    el("div", { class: "ask-row" }, el("p", { class: "ask-hint" }, icon("lock", 14), health.data.aiEnabled ? "Questions are turned into read-only SQL, checked, and logged." : "AI is not configured here, so only the example questions are available."), submit),
  );

  const chips = el(
    "div",
    { class: "chips", role: "group", "aria-label": "Example questions" },
    ...(examples.data.questions ?? []).map((q) => el("button", { type: "button", class: "chip", onclick: () => { input.value = q; run(q); } }, q)),
  );

  return {
    title: "Ask your data",
    subtitle: "Ask a business question in plain English. The generated SQL is validated before it touches the database.",
    nodes: [card(form, el("p", { class: "chips-label" }, "Try one of these"), chips), result],
  };
}

function errorAnswer(data) {
  return callout("Couldn't answer that", data.reason ?? data.error ?? "Something went wrong.", "warn");
}

function answerCard(question, data) {
  const [labelKey, valueKey] = data.columns;
  const plotable =
    data.columns.length === 2 && data.rows.length >= 2 && data.rows.length <= 12 && data.rows.every((r) => typeof r[valueKey] === "number" && typeof r[labelKey] === "string");
  const valueType = plotable ? inferType(valueKey, data.rows) : "number";
  const fmt = (v) => formatValue(valueType, v);

  const chart = plotable
    ? chartCard({
        title: humanize(valueKey),
        subtitle: `By ${humanize(labelKey).toLowerCase()}`,
        build: (box) => barChart(box, { data: data.rows.map((r) => ({ label: r[labelKey], value: r[valueKey] })), format: valueType === "money" ? compactMoney : fmt, tipFormat: fmt, ariaLabel: `${humanize(valueKey)} by ${humanize(labelKey)}` }),
        tableView: () => dataTable({ title: question, rows: data.rows, columns: data.columns }),
      })
    : null;

  const copy = el("button", { type: "button", class: "btn btn-quiet" }, icon("copy", 14), "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(data.sql);
      copy.lastChild.textContent = "Copied";
      setTimeout(() => (copy.lastChild.textContent = "Copy"), 1500);
    } catch {
      copy.lastChild.textContent = "Copy failed";
    }
  });

  return el(
    "div",
    { class: "answer" },
    el(
      "section",
      { class: "card" },
      el(
        "div",
        { class: "card-head" },
        el("div", {}, el("h2", { class: "card-title" }, question), el("p", { class: "card-sub" }, `${int(data.rows.length)} ${data.rows.length === 1 ? "row" : "rows"} · ${data.source === "example" ? "Cached example" : "AI generated"}`)),
      ),
      el("ul", { class: "safeguards", "aria-label": "Safeguards applied" }, ...SAFEGUARDS.map((s) => el("li", {}, el("span", { "aria-hidden": "true" }, "✓ "), s))),
    ),
    chart
      ? el("div", { class: "grid-2 even" }, chart, dataTable({ title: "Result", rows: data.rows, columns: data.columns, pageSize: 10 }))
      : dataTable({ title: "Result", rows: data.rows, columns: data.columns, pageSize: 10 }),
    el("details", { class: "card sql-card" }, el("summary", {}, "Query that ran"), el("div", { class: "sql-body" }, el("pre", {}, el("code", {}, data.sql)), copy)),
  );
}

async function requests() {
  const dept = el("select", { id: "req-dept" }, ...["finance", "sales", "operations", "procurement", "other"].map((d) => el("option", { value: d }, labelize(d))));
  const text = el("textarea", { id: "req-text", rows: 3, maxLength: 500, required: true, placeholder: "e.g. Send me the receivables aging report for month end", "data-gramm": "false", "data-enable-grammarly": "false" });
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, "Submit request");
  const outcome = el("div", { class: "request-outcome", "aria-live": "polite" });
  const recent = el("div");
  const health = await api("/api/health");
  const publicDemo = health.ok && health.data.publicDemo === true;

  async function loadRecent() {
    const { ok, data } = await api("/api/requests");
    recent.replaceChildren(
      ok
        ? dataTable({
            title: publicDemo ? "Sample requests" : "Recent requests",
            subtitle: publicDemo
              ? "A sample inbox that ships with the demo. Requests you submit are answered but not stored, and nobody else can see them."
              : "Visible to everyone using this demo. Please don't enter personal or confidential information.",
            rows: data.requests,
            columns: ["createdAt", "department", "text", "route", "outcome"],
            overrides: { createdAt: { label: "Date" }, department: { render: labelize }, text: { label: "Request", wrap: true } },
            pageSize: 8,
          })
        : message("Could not load recent requests.", "error"),
    );
  }

  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        track("request_submit");
        submit.disabled = true;
        outcome.replaceChildren(message("Routing your request…"));
        const { ok, data } = await postJson("/api/requests", { department: dept.value, text: text.value });
        submit.disabled = false;
        if (!ok) return outcome.replaceChildren(callout("Couldn't submit", data.error ?? "Something went wrong.", "warn"));
        outcome.replaceChildren(routingResult(dept.value, data));
        loadRecent();
      },
    },
    el("div", { class: "field" }, el("label", { htmlFor: "req-dept" }, "Department"), dept),
    el("div", { class: "field" }, el("label", { htmlFor: "req-text" }, "What do you need?"), text),
    submit,
  );

  const routes = el(
    "ul",
    { class: "route-help" },
    el("li", {}, pill("saved_report"), el("span", {}, "An existing report already answers it. Delivered instantly.")),
    el("li", {}, pill("ask_data"), el("span", {}, "A data question. A checked, read-only query answers it.")),
    el("li", {}, pill("needs_it"), el("span", {}, "Needs access, a change, or isn't clear. Escalated to IT with the reason.")),
  );

  await loadRecent();
  return {
    title: "Request desk",
    subtitle: "Where a reporting request goes first. Most never need to reach IT.",
    nodes: [el("div", { class: "grid-2 even" }, card(el("h2", { class: "card-title" }, "New request"), form), card(el("h2", { class: "card-title" }, "How requests are routed"), routes)), outcome, recent],
  };
}

function routingResult(department, data) {
  const steps = el(
    "ol",
    { class: "steps" },
    el("li", {}, el("span", { class: "step-title" }, "Received"), el("span", { class: "step-body" }, `From ${labelize(department)}`)),
    el("li", {}, el("span", { class: "step-title" }, "Triaged"), el("span", { class: "step-body" }, pill(data.route), " ", data.reason)),
    el("li", {}, el("span", { class: "step-title" }, "Outcome"), el("span", { class: "step-body" }, pill(data.outcome), " ", data.outcome === "answered" ? "Answered without IT." : "Sent to the IT queue.")),
  );

  const nodes = [card(el("h2", { class: "card-title" }, "Routing result"), steps)];
  if (data.route === "saved_report") {
    nodes.push(dataTable({ title: data.answer.title, subtitle: "Answered by a saved report", rows: data.answer.rows, bar: REPORT_BAR[data.answer.id], overrides: REPORT_OVERRIDES[data.answer.id] ?? {}, pageSize: 8 }));
  } else if (data.route === "ask_data") {
    if (data.answer.ok) nodes.push(dataTable({ title: "Answer", subtitle: "Generated by a checked, read-only query", rows: data.answer.rows, columns: data.answer.columns, pageSize: 8 }));
    else nodes.push(callout("Couldn't answer automatically", `${data.answer.reason} This request has been escalated to IT.`, "warn"));
  }
  return el("div", { class: "stack" }, ...nodes);
}

async function reconcile() {
  const { ok, data } = await api("/api/reconcile");
  if (!ok) throw new Error("load");
  const s = data.summary;
  const rows = data.issues.map((i) => ({
    invoice: i.invoiceId,
    issue: i.type.replace(/_/g, " "),
    erp: i.erpAmount != null ? money(i.erpAmount) : i.erpStatus ? labelize(i.erpStatus) : "—",
    billing: i.billingAmount != null ? money(i.billingAmount) : i.billingStatus ? labelize(i.billingStatus) : "—",
    difference: i.difference ?? null,
  }));

  const types = ["all", ...new Set(rows.map((r) => r.issue))];
  const holder = el("div");
  const chipBar = el("div", { class: "chips", role: "group", "aria-label": "Filter by issue type" });

  function show(type) {
    for (const b of chipBar.children) b.setAttribute("aria-pressed", String(b.dataset.type === type));
    const list = type === "all" ? rows : rows.filter((r) => r.issue === type);
    holder.replaceChildren(
      dataTable({
        title: "Discrepancies",
        subtitle: "ERP invoices compared with the billing platform export",
        rows: list,
        columns: ["invoice", "issue", "erp", "billing", "difference"],
        overrides: {
          invoice: { label: "Invoice", type: "text", render: (v) => `INV-${String(v).padStart(5, "0")}` },
          erp: { label: "ERP", type: "text" },
          billing: { label: "Billing", type: "text" },
          difference: { label: "Billing minus ERP", type: "money" },
        },
        pageSize: 12,
      }),
    );
  }

  for (const type of types) {
    const count = type === "all" ? rows.length : rows.filter((r) => r.issue === type).length;
    const chip = el("button", { type: "button", class: "chip", "aria-pressed": "false", onclick: () => show(type) }, `${type === "all" ? "All" : labelize(type)} (${count})`);
    chip.dataset.type = type;
    chipBar.append(chip);
  }
  show("all");

  const rate = s.erpCount ? ((s.matched / s.erpCount) * 100).toFixed(1) : "0.0";
  return {
    title: "ERP and billing reconciliation",
    subtitle: "Every ERP invoice compared with the billing platform's export, so mismatches are found before month end.",
    nodes: [
      el("div", { class: "tiles" }, tile({ label: "ERP invoices", value: int(s.erpCount), note: "Checked" }), tile({ label: "Matched", value: int(s.matched), note: `${rate}% match rate` }), tile({ label: "Need review", value: int(s.issues), note: "Mismatched or missing" })),
      chipBar,
      holder,
    ],
  };
}

async function impact() {
  const [{ ok, data }, health] = await Promise.all([api("/api/impact"), api("/api/health")]);
  if (!ok) throw new Error("load");
  const publicDemo = health.ok && health.data.publicDemo === true;
  const a = data.assumptions;

  const weekly = data.byWeek.map((w) => ({
    label: shortDate(w.weekStart),
    title: `Week of ${dateLabel(w.weekStart)}`,
    values: [w.answered, w.escalated],
  }));
  const series = [
    { name: "Answered without IT", cls: "s1" },
    { name: "Escalated to IT", cls: "s2" },
  ];
  const weeklyCard = chartCard({
    title: "Requests per week",
    subtitle: "Answered by self-service vs. escalated to IT",
    legendSeries: series,
    build: (box) => stackedColumns(box, { data: weekly, series, axisFormat: compactNumber, ariaLabel: "Requests per week, answered without IT and escalated to IT" }),
    tableView: () => dataTable({ title: "Requests per week", rows: data.byWeek, columns: ["weekStart", "answered", "escalated"], overrides: { weekStart: { label: "Week of", type: "date" }, answered: { label: "Answered without IT" }, escalated: { label: "Escalated to IT" } } }),
  });

  const routeData = [
    { label: "Saved report", value: data.byRoute.saved_report },
    { label: "Ask your data", value: data.byRoute.ask_data },
    { label: "Needs IT", value: data.byRoute.needs_it },
  ];
  const routeCard = chartCard({
    title: "Where requests go",
    subtitle: "Requests by route",
    build: (box) => barChart(box, { data: routeData, format: int, ariaLabel: "Requests by route" }),
    tableView: () => dataTable({ title: "Requests by route", rows: routeData, columns: ["label", "value"], overrides: { label: { label: "Route" }, value: { label: "Requests" } } }),
  });

  return {
    title: "Automation impact",
    subtitle: "How much reporting work reaches IT, and how much self-service absorbs.",
    nodes: [
      el(
        "div",
        { class: "tiles" },
        tile({ label: "Requests handled", value: int(data.total), note: "In the request log" }),
        tile({ label: "Answered without IT", value: `${data.deflectionRate}%`, note: `${int(data.deflected)} of ${int(data.total)} requests` }),
        tile({ label: "Estimated hours saved", value: String(data.estimatedHoursSaved), note: `At ${a.minutesPerManualRequest} min per manual request` }),
        tile({ label: "Median self-serve answer", value: data.medianSelfServeSeconds == null ? "n/a" : `${data.medianSelfServeSeconds}s`, note: `vs. ~${a.hoursToAnswerManually} h assumed manually` }),
      ),
      el("div", { class: "grid-2 flip" }, weeklyCard, routeCard),
      callout("Read these figures as an illustration", `${a.note} The request log is seeded demo traffic: sample requests written to resemble a reporting inbox. ${publicDemo ? "Requests submitted on the Request desk are answered but not stored in this public demo, so these figures stay fixed." : "Requests you submit on the Request desk are added to it."}`, "info"),
    ],
  };
}

/* Assistant: a tool-using AI analyst. Every step it takes is shown. ----------- */

const chat = { messages: [] }; // survives navigation within the session

const SUGGESTIONS = [
  ["Collections briefing", "Prepare this week's collections briefing for finance: how bad is overdue, who should we call first, and email the finance director."],
  ["Reconcile and notify", "Check ERP vs billing reconciliation and draft a note to the billing team about what they need to fix."],
  ["Revenue drivers", "Which product categories drove revenue in the last 90 days, and is anything worrying about stock in the top one?"],
  ["Procurement risk", "Which purchase orders are most at risk, and what should procurement chase first?"],
];

function stepList(steps) {
  return el(
    "ul",
    { class: "steps-inline", "aria-label": "What the assistant did" },
    ...steps.map((s) =>
      el(
        "li",
        { class: s.ok ? "" : "step-failed" },
        el("span", { class: "step-mark", "aria-hidden": "true" }, s.ok ? "✓" : "✕"),
        el("span", {}, s.label, s.rowCount != null ? ` · ${int(s.rowCount)} ${s.rowCount === 1 ? "row" : "rows"}` : "", s.ok ? "" : " (did not run)"),
        s.sql ? el("details", {}, el("summary", {}, "SQL"), el("pre", {}, el("code", {}, s.sql))) : null,
      ),
    ),
  );
}

function draftCard(d) {
  const copy = el("button", { type: "button", class: "btn btn-quiet" }, icon("copy", 14), "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`);
      copy.lastChild.textContent = "Copied";
      setTimeout(() => (copy.lastChild.textContent = "Copy"), 1500);
    } catch {
      copy.lastChild.textContent = "Copy failed";
    }
  });
  return el(
    "section",
    { class: "draft", "aria-label": "Email draft" },
    el("div", { class: "draft-head" }, el("span", { class: "pill pill-warn" }, el("span", { class: "pill-glyph", "aria-hidden": "true" }, "!"), "Draft, not sent"), copy),
    el("dl", { class: "draft-meta" }, el("dt", {}, "To"), el("dd", {}, d.to), el("dt", {}, "Subject"), el("dd", {}, d.subject)),
    el("p", { class: "draft-body" }, d.body),
  );
}

function chatMessage(m) {
  if (m.role === "user") return el("div", { class: "chat-row user" }, el("div", { class: "bubble" }, m.content));
  const body = [];
  if (m.pending) body.push(el("p", { class: "thinking" }, "Working through your request", el("span", { class: "dots", "aria-hidden": "true" }, "…")));
  else if (m.error) body.push(callout("The assistant couldn't finish", m.error, "warn"));
  else {
    if (m.steps?.length) body.push(stepList(m.steps));
    body.push(richText(m.content));
    for (const d of m.drafts ?? []) body.push(draftCard(d));
  }
  return el(
    "div",
    { class: "chat-row assistant" },
    el("div", { class: "avatar", "aria-hidden": "true" }, icon("assistant", 16)),
    el("div", { class: "bubble", "aria-busy": m.pending ? "true" : null }, el("p", { class: "who" }, "ReportDesk analyst"), ...body),
  );
}

async function assistant() {
  const health = await api("/api/health");
  const enabled = health.ok && health.data.aiEnabled;

  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const input = el("textarea", { id: "chat-input", rows: 2, maxLength: 1000, placeholder: "Ask for a briefing, a check, or a draft…", disabled: !enabled, "data-gramm": "false", "data-enable-grammarly": "false" });
  const send = el("button", { type: "submit", class: "btn btn-primary", disabled: !enabled }, icon("send", 16), "Send");
  const reset = el("button", { type: "button", class: "btn btn-quiet", onclick: () => { chat.messages = []; paint(); } }, "New chat");

  /** `showAnswerStart` scrolls to the top of the newest answer so its steps are visible, not just its tail. */
  function paint(showAnswerStart = false) {
    if (!chat.messages.length) {
      log.replaceChildren(
        el(
          "div",
          { class: "chat-empty" },
          el("h2", { class: "card-title" }, "What would you like done?"),
          el("p", { class: "card-sub" }, "The analyst chooses which reports and queries to run, reads the results, and writes the answer. It can draft emails but never sends them."),
          el(
            "div",
            { class: "suggestions" },
            ...SUGGESTIONS.map(([title, prompt]) =>
              el("button", { type: "button", class: "suggestion", disabled: !enabled, onclick: () => submit(prompt) }, el("strong", {}, title), el("span", {}, prompt)),
            ),
          ),
        ),
      );
    } else {
      log.replaceChildren(...chat.messages.map(chatMessage));
    }
    reset.hidden = chat.messages.length === 0;
    const rows = log.querySelectorAll(".chat-row.assistant");
    // Show the question and the answer's steps together: anchor on the user message just above the newest answer.
    const anchor = rows.length ? (rows[rows.length - 1].previousElementSibling ?? rows[rows.length - 1]) : null;
    log.scrollTop = showAnswerStart && anchor ? Math.max(0, anchor.offsetTop - 16) : log.scrollHeight;
  }

  async function submit(text) {
    const content = text.trim();
    if (!content || send.disabled) return;
    track("assistant_run");
    const history = chat.messages
      .filter((m) => !m.pending && !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-11);
    chat.messages.push({ role: "user", content }, { role: "assistant", pending: true });
    input.value = "";
    send.disabled = true;
    paint();

    const { ok, data } = await postJson("/api/assistant", { messages: [...history, { role: "user", content }] });
    chat.messages.pop();
    chat.messages.push(
      ok && data.ok
        ? { role: "assistant", content: data.reply, steps: data.steps, drafts: data.drafts }
        : { role: "assistant", content: "", error: data.reason ?? data.error ?? "Something went wrong." },
    );
    send.disabled = !enabled;
    paint(true);
    input.focus({ preventScroll: true });
  }

  const form = el(
    "form",
    { class: "composer", onsubmit: (e) => { e.preventDefault(); submit(input.value); } },
    el("label", { class: "sr-only", htmlFor: "chat-input" }, "Message to the analyst"),
    input,
    el(
      "div",
      { class: "composer-row" },
      el("p", { class: "ask-hint" }, icon("lock", 14), "Read-only data access. Drafts are never sent. Check the steps shown with each answer."),
      el("div", { class: "composer-actions" }, reset, send),
    ),
  );
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  paint();
  return {
    title: "Assistant",
    subtitle: "An AI analyst that does the reporting work: it runs reports and queries, reasons over the results, and drafts the follow-up.",
    nodes: [
      enabled ? null : callout("AI is not configured on this deployment", "Add an OpenRouter key to enable the assistant. Saved reports, the Ask examples, triage and reconciliation still work without it.", "warn"),
      el("section", { class: "card chat" }, log, form),
    ].filter(Boolean),
  };
}

/* About ------------------------------------------------------------------- */

async function about() {
  const link = (href, label, cls, trackName) => el("a", { class: cls, href, target: "_blank", rel: "noopener", "data-track": trackName }, label);
  return {
    title: "About",
    subtitle: "Why this exists, and who built it.",
    nodes: [
      el(
        "div",
        { class: "grid-2 even" },
        card(
          el("h2", { class: "card-title" }, "What this is"),
          el("p", {}, "ReportDesk shows how a business can stop waiting on IT for reports. An AI analyst runs the reports and queries, writes the answer, and drafts the follow-up email for a person to check. It runs on made-up data, so nothing real is at risk."),
        ),
        card(
          el("h2", { class: "card-title" }, "How it was built"),
          el("p", {}, "Designed and directed by Olorunfemi John, and built with AI coding tools. Read-only access, a daily AI budget and human review are built in. The code is public."),
        ),
      ),
      el(
        "section",
        { class: "card about-cta" },
        el("h2", { class: "card-title" }, "Using this at your company? Let's talk."),
        el("p", {}, "Connecting it to your ERP, your reports and your definitions is the real work. I can adapt it to fit."),
        el("div", { class: "cta-row" }, link(PORTFOLIO_URL, "Let's talk", "btn btn-primary", "click_portfolio"), link(REPO_URL, "See the code", "btn", "click_repo")),
      ),
      el("p", { class: "note" }, "Anonymous usage counts only: which pages are viewed, the country and where a visit came from. No cookies, no addresses, no personal data, and browsers that send Do Not Track are not counted."),
    ],
  };
}

/* Shell: routing, theme, status ------------------------------------------- */

const pages = { overview, assistant, reports, ask, requests, reconcile, impact, about };
const view = $("view");
let renderToken = 0;

async function route() {
  const [hashName, param] = location.hash.slice(1).split("/");
  const name = pages[hashName] ? hashName : "overview";
  const token = ++renderToken;

  for (const a of document.querySelectorAll(".nav a")) {
    if (a.getAttribute("href") === `#${name}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }

  view.setAttribute("aria-busy", "true");
  let page;
  try {
    page = await pages[name]({ param });
  } catch {
    if (token !== renderToken) return;
    view.replaceChildren(el("div", { class: "msg error", role: "alert" }, "Couldn't load this page. ", el("button", { type: "button", class: "btn", onclick: route }, "Try again")));
    view.removeAttribute("aria-busy");
    return;
  }
  if (token !== renderToken) return; // a newer navigation won

  const heading = el("h1", { id: "page-title", tabindex: "-1" }, page.title);
  view.replaceChildren(el("header", { class: "page-head" }, heading, el("p", { class: "lead" }, page.subtitle)), ...page.nodes);
  view.removeAttribute("aria-busy");
  document.title = `${page.title} · ReportDesk`;
  if (document.body.dataset.ready) heading.focus({ preventScroll: true });
  document.body.dataset.ready = "1";
  window.scrollTo(0, 0);
  track(`view_${name}`);
}

function initTheme() {
  const button = $("theme");
  const apply = (mode) => {
    document.documentElement.dataset.theme = mode;
    button.replaceChildren(icon(mode === "dark" ? "sun" : "moon", 18));
    button.setAttribute("aria-label", mode === "dark" ? "Switch to light theme" : "Switch to dark theme");
  };
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* storage may be blocked */ }
  apply(saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
  });
}

function initNav() {
  const items = [["overview", "Overview"], ["assistant", "Assistant"], ["reports", "Reports"], ["ask", "Ask your data"], ["requests", "Request desk"], ["reconcile", "Reconciliation"], ["impact", "Impact"], ["about", "About"]];
  $("nav").replaceChildren(...items.map(([id, label]) => el("a", { href: `#${id}` }, icon(id), el("span", {}, label))));
}

async function initStatus() {
  const [health, kpi] = await Promise.all([api("/api/health"), api("/api/kpis")]);
  if (kpi.ok) $("asof").textContent = `Data as of ${dateLabel(kpi.data.asOf)}`;
  if (health.ok) {
    $("ai-pill").replaceChildren(el("span", { class: `dot ${health.data.aiEnabled ? "dot-on" : "dot-off"}`, "aria-hidden": "true" }), health.data.aiEnabled ? "AI assistant on" : "AI assistant off");
  }
}

// Counts CSV exports and the "built by" links, wherever they appear.
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  if (!a) return;
  if (a.dataset.track) track(a.dataset.track);
  else if (a.hasAttribute("download")) track("export_csv");
});

initTheme();
initNav();
initStatus();
trackSessionStart();
window.addEventListener("hashchange", route);
route();
