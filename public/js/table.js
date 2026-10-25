import { dateLabel, el, humanize, icon, int, labelize, money, monthLabel } from "./lib.js";

/* Status pills: an icon AND a text label, so colour never carries meaning alone. */
const PILL = {
  paid: ["good", "✓"], answered: ["good", "✓"], received: ["good", "✓"], shipped: ["good", "✓"],
  open: ["info", "•"], saved_report: ["info", "•"], ask_data: ["info", "•"],
  escalated: ["warn", "!"], needs_it: ["warn", "!"], "amount mismatch": ["warn", "!"], "status mismatch": ["warn", "!"],
  "missing in billing": ["bad", "✕"], "missing in erp": ["bad", "✕"], cancelled: ["bad", "✕"],
};
const PILL_LABEL = { needs_it: "IT", saved_report: "Saved report", ask_data: "Ask your data" };

export { inferType, format as formatValue };

export function pill(value) {
  const key = String(value);
  const [tone, glyph] = PILL[key] ?? ["neutral", ""];
  return el(
    "span",
    { class: `pill pill-${tone}` },
    glyph ? el("span", { class: "pill-glyph", "aria-hidden": "true" }, glyph) : null,
    PILL_LABEL[key] ?? labelize(key),
  );
}

const MONEY_NAME = /(balance|revenue|amount|price|cost|value|difference|credit)/i;
const STATUS_NAME = /^(status|outcome|route|issue|segment)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function inferType(name, rows) {
  const values = rows.map((r) => r[name]).filter((v) => v != null);
  if (values.every((v) => typeof v === "number")) return MONEY_NAME.test(name) ? "money" : "number";
  if (STATUS_NAME.test(name)) return "status";
  if (values.length && values.every((v) => typeof v === "string" && ISO_MONTH.test(v))) return "month";
  if (values.length && values.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  return "text";
}

function format(type, value) {
  if (value == null || value === "") return "";
  switch (type) {
    case "money": return money(value);
    case "number": return int(value);
    case "date": return dateLabel(value);
    case "month": return monthLabel(value);
    default: return String(value);
  }
}

const compare = (type) => (a, b) => {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  return type === "money" || type === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true });
};

/**
 * A business-grade data table: right-aligned tabular numbers, currency and date
 * formatting, status pills, sortable headers, search, pagination, sticky header
 * and optional in-cell data bars.
 *
 *   columns:   keys to show, in order (defaults to every key of the first row)
 *   overrides: { key: { label, type, render(value, row) -> Node|string } }
 *   bar:       key of a numeric column to draw a data bar behind
 */
export function dataTable({ title, subtitle, columns, rows, overrides = {}, bar, pageSize = 12, searchable, exportHref }) {
  const keys = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const cols = keys.map((key) => {
    const o = overrides[key] ?? {};
    return { key, label: o.label ?? humanize(key), type: o.type ?? inferType(key, rows), render: o.render, wrap: o.wrap };
  });
  const numeric = (c) => c.type === "money" || c.type === "number";
  const showSearch = searchable ?? rows.length > pageSize;
  const barMax = bar ? Math.max(1, ...rows.map((r) => Number(r[bar]) || 0)) : 0;

  const state = { sortKey: null, dir: 1, query: "", page: 0 };
  const searchId = `search-${Math.random().toString(36).slice(2, 8)}`;

  const tbody = el("tbody");
  const thead = el("tr");
  const status = el("span", { class: "table-status", "aria-live": "polite" });
  const pager = el("div", { class: "pager" });

  const headButtons = cols.map((c) => {
    const button = el("button", { type: "button", class: "th-sort", onclick: () => sortBy(c.key) }, c.label, el("span", { class: "sort-mark", "aria-hidden": "true" }));
    const th = el("th", { scope: "col", class: numeric(c) ? "num" : "", "aria-sort": "none" }, button);
    thead.append(th);
    return { c, th };
  });

  function visibleRows() {
    let list = rows;
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((r) => cols.some((c) => format(c.type, r[c.key]).toLowerCase().includes(q) || String(r[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (state.sortKey) {
      const col = cols.find((c) => c.key === state.sortKey);
      const cmp = compare(col.type);
      list = [...list].sort((a, b) => cmp(a[col.key], b[col.key]) * state.dir);
    }
    return list;
  }

  function cell(c, row) {
    const value = row[c.key];
    const td = el("td", { class: numeric(c) ? "num" : c.wrap ? "wrap" : "" });
    let content;
    if (c.render) content = c.render(value, row);
    else if (c.type === "status" && value != null) content = pill(value);
    else content = format(c.type, value);

    if (bar && c.key === bar && typeof value === "number") {
      const fill = el("span", { class: "databar" });
      fill.style.width = `${Math.max(2, (value / barMax) * 100)}%`;
      td.append(el("span", { class: "barcell" }, el("span", { class: "bartrack", "aria-hidden": "true" }, fill), el("span", { class: "barcell-value" }, content)));
    } else {
      td.append(content);
    }
    return td;
  }

  function render() {
    const list = visibleRows();
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    state.page = Math.min(state.page, pages - 1);
    const slice = list.slice(state.page * pageSize, (state.page + 1) * pageSize);

    tbody.replaceChildren(
      ...(slice.length
        ? slice.map((row) => el("tr", {}, ...cols.map((c) => cell(c, row))))
        : [el("tr", {}, el("td", { colSpan: cols.length, class: "empty" }, "No matching rows."))]),
    );

    for (const { c, th } of headButtons) {
      th.setAttribute("aria-sort", state.sortKey === c.key ? (state.dir === 1 ? "ascending" : "descending") : "none");
    }

    const from = list.length ? state.page * pageSize + 1 : 0;
    status.textContent = list.length === rows.length
      ? `${int(rows.length)} ${rows.length === 1 ? "row" : "rows"}`
      : `${int(list.length)} of ${int(rows.length)} rows`;

    pager.replaceChildren();
    if (pages > 1) {
      pager.append(
        el("span", { class: "pager-range" }, `${from}–${Math.min(list.length, (state.page + 1) * pageSize)} of ${int(list.length)}`),
        el("button", { type: "button", class: "btn btn-quiet", disabled: state.page === 0, "aria-label": "Previous page", onclick: () => { state.page--; render(); } }, "Previous"),
        el("button", { type: "button", class: "btn btn-quiet", disabled: state.page >= pages - 1, "aria-label": "Next page", onclick: () => { state.page++; render(); } }, "Next"),
      );
    }
  }

  function sortBy(key) {
    if (state.sortKey === key) {
      if (state.dir === 1) state.dir = -1;
      else { state.sortKey = null; state.dir = 1; }
    } else {
      state.sortKey = key;
      state.dir = 1;
    }
    render();
  }

  const toolbar = el(
    "div",
    { class: "table-toolbar" },
    el("div", { class: "table-heading" }, title ? el("h2", { class: "card-title" }, title) : null, subtitle ? el("p", { class: "card-sub" }, subtitle) : null),
    el(
      "div",
      { class: "table-actions" },
      showSearch
        ? el(
            "div",
            { class: "search" },
            icon("search", 16),
            el("label", { class: "sr-only", htmlFor: searchId }, `Search ${title ?? "table"}`),
            el("input", { id: searchId, type: "search", placeholder: "Search", autocomplete: "off", oninput: (e) => { state.query = e.target.value.trim(); state.page = 0; render(); } }),
          )
        : null,
      exportHref ? el("a", { class: "btn", href: exportHref, download: "" }, icon("download", 16), "Export CSV") : null,
    ),
  );

  const table = el(
    "table",
    { class: "data" },
    el("caption", { class: "sr-only" }, title ?? "Data table"),
    el("thead", {}, thead),
    tbody,
  );
  const scroller = el("div", { class: "table-scroll", role: "region", tabindex: "0", "aria-label": `${title ?? "Table"}, scrollable` }, table);

  render();
  return el("div", { class: "table-card" }, toolbar, scroller, el("div", { class: "table-foot" }, status, pager));
}
