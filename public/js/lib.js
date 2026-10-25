// Shared helpers. Everything dynamic is built with DOM nodes and textContent,
// never innerHTML, so API data (including LLM-generated text) cannot inject markup.

const SVG_NS = "http://www.w3.org/2000/svg";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key.includes("-") || key === "role" || key === "tabindex") node.setAttribute(key, value === true ? "" : value);
    else node[key] = value;
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

const ICONS = {
  about: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  assistant: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  overview: "M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z",
  reports: "M6 2h9l5 5v15H6z M14 2v6h6 M9 13h8 M9 17h8",
  ask: "M4 4h16v12H9l-5 4z M8 9h8 M8 12h5",
  requests: "M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5",
  reconcile: "M4 8h15 M15 4l4 4-4 4 M20 16H5 M9 12l-4 4 4 4",
  impact: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  download: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  send: "M3 11l18-8-8 18-2-8z",
};

export function icon(name, size = 18) {
  return svg(
    "svg",
    { class: "icon", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" },
    svg("path", { d: ICONS[name] ?? "" }),
  );
}

export const PORTFOLIO_URL = "https://thegoodb0rg.pages.dev/?ref=reportdesk-demo";
export const REPO_URL = "https://github.com/theGoodB0rg/reportdesk";

/* Privacy-first usage counts: a name from a fixed list plus where the visit came from. No cookies, no
   identifiers; sessionStorage only remembers the source label for this tab, and Do Not Track is honoured. */

const doNotTrack = () => navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;

/** `?ref=application` wins, then the referring site's host, else "direct". Remembered for the tab. */
function sourceLabel() {
  try {
    const saved = sessionStorage.getItem("rd_src");
    if (saved) return saved;
  } catch { /* storage may be blocked */ }
  let source = "direct";
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) source = ref;
  else if (document.referrer) {
    try {
      const host = new URL(document.referrer).hostname;
      if (host && host !== location.hostname) source = host;
    } catch { /* ignore a malformed referrer */ }
  }
  try { sessionStorage.setItem("rd_src", source); } catch { /* ignore */ }
  return source;
}

export function track(name) {
  if (doNotTrack()) return;
  try {
    fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, source: sourceLabel() }), keepalive: true }).catch(() => {});
  } catch { /* counting must never break the page */ }
}

export function trackSessionStart() {
  try {
    if (sessionStorage.getItem("rd_started")) return;
    sessionStorage.setItem("rd_started", "1");
  } catch { /* if storage is blocked this counts every load, which is acceptable */ }
  track("session_start");
}

export async function api(path, options) {
  try {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Could not reach the server." } };
  }
}

export const postJson = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* Formatting ------------------------------------------------------------ */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en-US");
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export const money = (n) => usd.format(n);
export const moneyWhole = (n) => usdWhole.format(n);
export const compactMoney = (n) => "$" + compact.format(n);
export const compactNumber = (n) => compact.format(n);
export const int = (n) => plain.format(n);
export const dateLabel = (iso) => dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const monthLabel = (ym) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
export const shortDate = (iso) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

const ACRONYMS = { po: "PO", sku: "SKU", erp: "ERP", id: "ID", ar: "AR" };

/** "balance_overdue" -> "Balance overdue"; known acronyms stay upper-case. */
export function humanize(name) {
  const words = String(name).split("_").map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Renders the assistant's plain-text answer (paragraphs, "- " bullets, "1." lists,
 * **bold**) as DOM nodes. Never uses innerHTML, so model output cannot inject markup.
 */
export function richText(text) {
  const root = el("div", { class: "rich" });
  const inline = (line) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? el("strong", {}, part) : part));
  let list = null;
  let para = null;

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || line === "---") {
      list = null;
      para = null;
      continue;
    }
    const bullet = line.match(/^[-•*]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== kind) {
        para = null;
        list = el(kind);
        root.append(list);
      }
      list.append(el("li", {}, ...inline((bullet ?? numbered)[1])));
    } else if (para) {
      para.append(" ", ...inline(line));
    } else {
      list = null;
      para = el("p", {}, ...inline(line));
      root.append(para);
    }
  }
  return root;
}

/** "saved_report" -> "Saved report". */
export const labelize = (value) => humanize(String(value).replace(/ /g, "_"));
