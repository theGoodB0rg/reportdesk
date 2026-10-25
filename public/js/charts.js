import { el, svg } from "./lib.js";

/* Tooltip: one shared element. Content is set with textContent only. -------- */

let tipEl;
function tooltip() {
  if (!tipEl) {
    tipEl = el("div", { class: "tip", role: "tooltip", hidden: true });
    document.body.append(tipEl);
  }
  return tipEl;
}

function showTip({ x, y }, { title, rows }) {
  const t = tooltip();
  t.replaceChildren(
    el("div", { class: "tip-title" }, title),
    ...rows.map((r) =>
      el("div", { class: "tip-row" }, r.cls ? el("span", { class: `tip-key ${r.cls}` }) : null, el("span", { class: "tip-value" }, r.value), el("span", { class: "tip-label" }, r.label)),
    ),
  );
  t.hidden = false;
  const { width, height } = t.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
  const above = y - height - 12;
  t.style.left = `${left}px`;
  t.style.top = `${above > 8 ? above : y + 18}px`;
}

const hideTip = () => tipEl && (tipEl.hidden = true);

/** Hover shows the tooltip at the pointer; keyboard focus shows the same content. */
function bindTip(node, content) {
  node.addEventListener("pointermove", (e) => showTip({ x: e.clientX, y: e.clientY }, content()));
  node.addEventListener("pointerleave", hideTip);
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect();
    showTip({ x: r.left + r.width / 2, y: r.top }, content());
  });
  node.addEventListener("blur", hideTip);
}

/* Geometry ------------------------------------------------------------------ */

/** Redraws when the container's width changes, so text stays crisp at any size. */
function mount(container, draw) {
  let width = 0;
  const run = () => {
    const w = Math.floor(container.clientWidth);
    if (w > 0 && w !== width) {
      width = w;
      container.replaceChildren(draw(w));
    }
  };
  new ResizeObserver(run).observe(container);
  run();
}

/** Bar with a 4px rounded data end and a square baseline end (horizontal). */
const barRight = (x, y, w, h, r0) => {
  const r = Math.min(r0, w, h / 2);
  return `M${x},${y} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h - r} a${r},${r} 0 0 1 -${r},${r} H${x} Z`;
};
/** Column with a rounded top and a square baseline end (vertical). */
const barTop = (x, y, w, h, r0) => {
  const r = Math.min(r0, h, w / 2);
  return `M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h} Z`;
};

function niceScale(max, count = 4) {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

const text = (attrs, content) => svg("text", attrs, content);

/* Horizontal bars: ranked or ordered categories, one series, one colour. ---- */

export function barChart(container, { data, format, tipFormat = format, ariaLabel, unit = "" }) {
  const rowH = 46;
  const thick = 22;
  mount(container, (w) => {
    const labelW = Math.min(180, Math.max(84, Math.max(...data.map((d) => d.label.length)) * 7.4));
    const valueW = Math.max(...data.map((d) => format(d.value).length)) * 8.2 + 20;
    const plotW = Math.max(40, w - labelW - valueW);
    const max = Math.max(...data.map((d) => d.value), 1);
    const root = svg("svg", { width: w, height: data.length * rowH, viewBox: `0 0 ${w} ${data.length * rowH}`, role: "group", "aria-label": ariaLabel });

    data.forEach((d, i) => {
      const y = i * rowH;
      const barW = d.value > 0 ? Math.max(8, (d.value / max) * plotW) : 0;
      const g = svg("g", { class: "mark-row", tabindex: "0", role: "img", "aria-label": `${d.label}: ${tipFormat(d.value)}${unit}` });
      g.append(
        svg("rect", { x: 0, y, width: w, height: rowH, fill: "transparent" }),
        text({ x: 0, y: y + rowH / 2, class: "ct ct-secondary", "dominant-baseline": "central" }, d.label),
        barW ? svg("path", { d: barRight(labelW, y + (rowH - thick) / 2, barW, thick, 4), class: "mark s1" }) : null,
        text({ x: labelW + barW + 8, y: y + rowH / 2, class: "ct ct-primary ct-strong", "dominant-baseline": "central" }, format(d.value)),
      );
      bindTip(g, () => ({ title: d.label, rows: [{ cls: "s1", value: tipFormat(d.value), label: d.detail ?? unit.trim() }] }));
      root.append(g);
    });
    return root;
  });
}

/* Shared frame for column charts ------------------------------------------- */

function columnFrame(w, { n, maxValue, axisFormat, ariaLabel, height = 250 }) {
  const m = { l: 46, r: 6, t: 14, b: 28 };
  const scale = niceScale(maxValue);
  const plotW = w - m.l - m.r;
  const plotH = height - m.t - m.b;
  const band = plotW / n;
  const yOf = (v) => m.t + plotH - (v / scale.max) * plotH;
  const root = svg("svg", { width: w, height, viewBox: `0 0 ${w} ${height}`, role: "group", "aria-label": ariaLabel });

  for (const t of scale.ticks) {
    root.append(
      svg("line", { x1: m.l, x2: w - m.r, y1: yOf(t), y2: yOf(t), class: t === 0 ? "axis" : "grid" }),
      text({ x: m.l - 8, y: yOf(t), class: "ct ct-muted", "text-anchor": "end", "dominant-baseline": "central" }, axisFormat(t)),
    );
  }
  return { root, m, band, plotH, yOf, thick: Math.min(24, band * 0.62), x: (i) => m.l + band * i + band / 2, height };
}

function xLabels(root, frame, labels) {
  const every = frame.band >= 34 ? 1 : frame.band >= 24 ? 2 : 3;
  labels.forEach((label, i) => {
    if (i % every === 0) {
      root.append(text({ x: frame.x(i), y: frame.height - 8, class: "ct ct-muted", "text-anchor": "middle" }, label));
    }
  });
}

/* Columns over time: one series. Labels only on the peak and the latest. ---- */

export function columnChart(container, { data, format, tipFormat = format, axisFormat, ariaLabel }) {
  mount(container, (w) => {
    const maxValue = Math.max(...data.map((d) => d.value), 1);
    const f = columnFrame(w, { n: data.length, maxValue, axisFormat, ariaLabel });
    const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
    const last = data.length - 1;
    const labelled = new Set(last - peak >= 3 ? [peak, last] : [last]);

    data.forEach((d, i) => {
      const h = (d.value / niceScale(maxValue).max) * f.plotH;
      const x = f.x(i) - f.thick / 2;
      const g = svg("g", { class: "mark-row", tabindex: "0", role: "img", "aria-label": `${d.title ?? d.label}: ${tipFormat(d.value)}` });
      g.append(
        svg("rect", { x: f.m.l + f.band * i, y: f.m.t, width: f.band, height: f.plotH, fill: "transparent" }),
        h > 0 ? svg("path", { d: barTop(x, f.yOf(d.value), f.thick, h, 4), class: "mark s1" }) : null,
        labelled.has(i) ? text({ x: f.x(i), y: f.yOf(d.value) - 7, class: "ct ct-primary ct-strong", "text-anchor": "middle" }, format(d.value)) : null,
      );
      bindTip(g, () => ({ title: d.title ?? d.label, rows: [{ cls: "s1", value: tipFormat(d.value), label: d.detail ?? "" }] }));
      f.root.append(g);
    });
    xLabels(f.root, f, data.map((d) => d.label));
    return f.root;
  });
}

/* Stacked columns: two series, 2px surface gap between segments. ----------- */

export function stackedColumns(container, { data, series, ariaLabel, axisFormat }) {
  mount(container, (w) => {
    const maxValue = Math.max(...data.map((d) => d.values.reduce((a, b) => a + b, 0)), 1);
    const f = columnFrame(w, { n: data.length, maxValue, axisFormat, ariaLabel });
    const top = niceScale(maxValue).max;
    const GAP = 2;

    data.forEach((d, i) => {
      const x = f.x(i) - f.thick / 2;
      const total = d.values.reduce((a, b) => a + b, 0);
      const g = svg("g", { class: "mark-row", tabindex: "0", role: "img", "aria-label": `${d.title}: ${series.map((s, k) => `${d.values[k]} ${s.name}`).join(", ")}` });
      g.append(svg("rect", { x: f.m.l + f.band * i, y: f.m.t, width: f.band, height: f.plotH, fill: "transparent" }));

      let base = f.m.t + f.plotH;
      const lastNonZero = d.values.reduce((acc, v, k) => (v > 0 ? k : acc), -1);
      d.values.forEach((v, k) => {
        if (v <= 0) return;
        const full = (v / top) * f.plotH;
        const h = Math.max(2, full - (k < lastNonZero ? GAP : 0));
        const y = base - h;
        g.append(svg("path", { d: k === lastNonZero ? barTop(x, y, f.thick, h, 4) : `M${x},${y} h${f.thick} v${h} h-${f.thick} Z`, class: `mark ${series[k].cls}` }));
        base = y - GAP;
      });

      bindTip(g, () => ({
        title: d.title,
        rows: [...series.map((s, k) => ({ cls: s.cls, value: String(d.values[k]), label: s.name })), { value: String(total), label: "Total" }],
      }));
      f.root.append(g);
    });
    xLabels(f.root, f, data.map((d) => d.label));
    return f.root;
  });
}

/* Chart card: title, optional legend, chart, and a table twin. ------------- */

export function legend(series) {
  return el(
    "ul",
    { class: "legend", "aria-label": "Legend" },
    ...series.map((s) => el("li", {}, el("span", { class: `legend-key ${s.cls}`, "aria-hidden": "true" }), s.name)),
  );
}

export function chartCard({ title, subtitle, legendSeries, build, tableView, className = "" }) {
  const chartBox = el("div", { class: "chart-box" });
  const tableBox = el("div", { class: "chart-table", hidden: true });
  let tableBuilt = false;

  const toggle = el("button", { type: "button", class: "btn btn-quiet", "aria-pressed": "false" }, "View as table");
  toggle.addEventListener("click", () => {
    const showTable = tableBox.hidden;
    if (showTable && !tableBuilt) {
      tableBox.append(tableView());
      tableBuilt = true;
    }
    tableBox.hidden = !showTable;
    chartBox.hidden = showTable;
    toggle.setAttribute("aria-pressed", String(showTable));
    toggle.textContent = showTable ? "View as chart" : "View as table";
  });

  const card = el(
    "section",
    { class: `card ${className}`.trim() },
    el("div", { class: "card-head" }, el("div", {}, el("h2", { class: "card-title" }, title), subtitle ? el("p", { class: "card-sub" }, subtitle) : null), toggle),
    legendSeries ? legend(legendSeries) : null,
    chartBox,
    tableBox,
  );
  build(chartBox);
  return card;
}
