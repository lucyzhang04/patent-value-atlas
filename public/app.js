// Patent Value Atlas: renders the aggregates built by scripts/build_data.py.

const KNOWN_FIRMS = {
  10107: "Microsoft", 10401: "AT&T", 12060: "General Electric", 12490: "IBM", 14593: "Apple",
  59328: "Intel", 77178: "Qualcomm", 84788: "Amazon", 90319: "Alphabet", 93436: "Tesla",
};
const SC_DEFAULT = ["G06F", "H04L", "A47J", "F16H"];
const MAX_SC = 4;

const $ = (s) => document.querySelector(s);
const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const seriesColor = (i) => cv(`--s${(i % 8) + 1}`);

function money(m) { // m is millions of dollars
  if (m == null) return "–";
  const a = Math.abs(m);
  if (a >= 1e6) return `$${(m / 1e6).toFixed(a >= 1e7 ? 0 : 1)}T`;
  if (a >= 1e3) return `$${(m / 1e3).toFixed(a >= 1e4 ? 0 : 1)}B`;
  if (a >= 1) return `$${m.toFixed(a >= 100 ? 0 : 1)}M`;
  return `$${Math.round(m * 1000)}K`;
}
const int = (n) => n.toLocaleString("en-US");
const firmName = (p) => (KNOWN_FIRMS[p] ? `${KNOWN_FIRMS[p]} (${p})` : String(p));

let A, T;
const charts = {};
const state = {
  rankBy: "cites", rankDecade: "all", rankCat: "all",
  inflStat: "med", indMetric: "n", indMode: "share",
  pendFocus: "all", pendBand: false, sc: [...SC_DEFAULT], scSlot: {},
  firmMetric: "firms", firmDecade: null,
};
SC_DEFAULT.forEach((s, i) => (state.scSlot[s] = i));

function chart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
  return charts[id];
}

function base() {
  const tp = cv("--text-primary"), ts = cv("--text-secondary"), grid = cv("--grid"), surf = cv("--surface-1");
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: ts },
    grid: { left: 8, right: 16, top: 48, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, type: "scroll", icon: "roundRect", itemWidth: 12, itemHeight: 8,
      textStyle: { color: ts, fontSize: 12 }, pageTextStyle: { color: ts } },
    tooltip: { trigger: "axis", backgroundColor: surf, borderColor: cv("--border"),
      textStyle: { color: tp, fontSize: 12 }, axisPointer: { type: "line", lineStyle: { color: cv("--text-muted") } },
      confine: true },
    xAxis: { type: "category", boundaryGap: false, axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false }, axisLabel: { color: cv("--text-muted") } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: grid } }, axisLabel: { color: cv("--text-muted") },
      nameTextStyle: { color: cv("--text-muted"), align: "left" } },
  };
}

function seg(id, key, render) {
  const el = $(id);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state[key] = b.dataset.v; render();
  });
}

function tipRows(params, fmt) {
  const ps = [...params].filter((p) => p.value != null).sort((a, b) => b.value - a.value);
  return `<b>${params[0].axisValue}</b><br>` + ps.map((p) =>
    `${p.marker}${p.seriesName}: <b>${fmt(p.value)}</b>`).join("<br>");
}

// ---------- KPIs
function renderKpis() {
  const s = A.summary;
  const items = [
    [int(s.n), "patents"], [int(s.firms), "public firms"], [`${s.first_year}–${s.last_year}`, "grant years"],
    [money(s.total_v2025), "total value, 2025 $"], [money(s.median_v2025), "median patent, 2025 $"],
  ];
  $("#kpis").innerHTML = items.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  $("#cpiFactor").textContent = s.cpi_factor_1982_to_2025.toFixed(4);
  $("#unclN").textContent = int(s.unclassified);
  if (s.source) {
    const u = `https://github.com/${s.source.repo}`;
    $("#source").innerHTML = `Data pulled from <a href="${u}" target="_blank" rel="noopener">${s.source.repo}</a> at commit
      <a href="${u}/commit/${s.source.sha}" target="_blank" rel="noopener"><code>${s.source.sha.slice(0, 7)}</code></a>
      (${s.source.date.slice(0, 10)}), built ${s.built_at?.slice(0, 10) ?? ""}.`;
  }
}

// ---------- Top patents table
function renderTop() {
  const byV = state.rankBy === "value";
  let rows;
  if (state.rankDecade === "all") rows = byV ? T.by_value : T.by_cites;
  else rows = (byV ? T.by_value_decade : T.by_cites_decade).filter((r) => r.decade === +state.rankDecade);
  if (state.rankCat !== "all") rows = rows.filter((r) => r.cat === state.rankCat);
  rows = rows.slice(0, 100);
  const ci = (c) => A.categories.indexOf(c);
  $("#topTable tbody").innerHTML = rows.length ? rows.map((r, i) => `<tr>
    <td class="muted">${i + 1}</td>
    <td><a href="https://patents.google.com/patent/US${r.patent_num}" target="_blank" rel="noopener">${int(+r.patent_num)}</a></td>
    <td>${r.issued}</td>
    <td>${firmName(r.permno)}</td>
    <td>${ci(r.cat) >= 0 ? `<span class="sw" style="background:${seriesColor(ci(r.cat))}"></span>` : ""}${r.cat}</td>
    <td class="muted">${r.code ?? "–"}</td>
    <td class="num">${int(r.cites)}</td>
    <td class="num">${money(r.xi_nominal)}</td>
    <td class="num"><b>${money(r.v2025)}</b></td></tr>`).join("")
    : `<tr><td colspan="9" class="muted">No patents in this field among the top-ranked set for this period.</td></tr>`;
}

// ---------- Inflation
function renderInflation() {
  const b = base(), k = state.inflStat;
  const yrs = A.totals.map((r) => String(r.year));
  const adj = A.totals.map((r) => r[k]);
  const nom = A.totals.map((r) => r[`${k}_nom`]);
  const label = { med: "Median value per patent", mean: "Average value per patent", v: "Total value of patents granted" }[k];
  chart("chInflation").setOption({
    ...b,
    tooltip: { ...b.tooltip, formatter: (p) => tipRows(p, money) },
    legend: { ...b.legend, data: ["In 2025 dollars", "In dollars of the grant year"] },
    xAxis: { ...b.xAxis, data: yrs },
    yAxis: { ...b.yAxis, name: label, axisLabel: { ...b.yAxis.axisLabel, formatter: money } },
    series: [
      { name: "In 2025 dollars", type: "line", data: adj, showSymbol: false, lineStyle: { width: 2 }, color: seriesColor(0) },
      { name: "In dollars of the grant year", type: "line", data: nom, showSymbol: false, lineStyle: { width: 2, type: [4, 3] }, color: cv("--text-muted") },
    ],
  }, true);
}

// ---------- Industry mix
function renderIndustry() {
  const b = base(), m = state.indMetric, share = state.indMode === "share";
  const years = [...new Set(A.yearly.map((r) => r.year))];
  const idx = {}; A.yearly.forEach((r) => (idx[`${r.year}|${r.cat}`] = r));
  const tot = {}; years.forEach((y) => (tot[y] = A.categories.reduce((s, c) => s + (idx[`${y}|${c}`]?.[m] ?? 0), 0)));
  const fmt = share ? (v) => `${v.toFixed(1)}%` : m === "v" ? money : (v) => int(Math.round(v));
  chart("chIndustry").setOption({
    ...b,
    tooltip: { ...b.tooltip, formatter: (p) => tipRows(p, fmt) },
    xAxis: { ...b.xAxis, data: years.map(String) },
    yAxis: { ...b.yAxis, max: share ? 100 : null,
      name: share ? `Share of ${m === "n" ? "patents" : "value"}` : m === "n" ? "Patents granted" : "Value, 2025 $",
      axisLabel: { ...b.yAxis.axisLabel, formatter: share ? "{value}%" : m === "v" ? money : (v) => int(v) } },
    series: A.categories.map((c, i) => ({
      name: c, type: "line", stack: "a", showSymbol: false, color: seriesColor(i),
      lineStyle: { width: 1, color: cv("--surface-1") }, areaStyle: { opacity: 0.92 },
      emphasis: { focus: "series" },
      data: years.map((y) => { const v = idx[`${y}|${c}`]?.[m] ?? 0; return share ? (tot[y] ? (100 * v) / tot[y] : 0) : v; }),
    })),
  }, true);
}

// ---------- Pendency
const EVENTS = [
  { x: "1995", label: "20-yr term from filing (TRIPS)" },
  { x: "2001", label: "Applications published (AIPA)" },
  { x: "2013", label: "America Invents Act" },
];
function eventLines() {
  return { silent: true, symbol: "none", lineStyle: { color: cv("--text-muted"), type: "dashed", width: 1 },
    label: { color: cv("--text-muted"), fontSize: 11, formatter: (p) => p.data.label, position: "insideEndTop" },
    data: EVENTS.map((e) => ({ xAxis: e.x, label: e.label })) };
}
const yrsFmt = (v) => `${v.toFixed(2)} yrs`;

function bandSeries(rows, years, color, stack) {
  const m = {}; rows.forEach((r) => (m[r.year] = r));
  return [
    { name: "_lo", type: "line", stack, data: years.map((y) => m[y]?.p25 ?? null), lineStyle: { opacity: 0 },
      showSymbol: false, silent: true, tooltip: { show: false } },
    { name: "_band", type: "line", stack, data: years.map((y) => (m[y] ? m[y].p75 - m[y].p25 : null)),
      lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.18 }, showSymbol: false, silent: true, tooltip: { show: false } },
  ];
}

function renderPendCat() {
  const b = base(), focus = state.pendFocus;
  const years = A.pend_all.map((r) => r.year);
  const by = {}; A.pend_cat.forEach((r) => ((by[r.cat] ||= {})[r.year] = r));
  const series = A.categories.map((c, i) => ({
    name: c, type: "line", showSymbol: false, color: seriesColor(i), smooth: 0.2,
    lineStyle: { width: focus === "all" || focus === c ? 2 : 1, opacity: focus === "all" || focus === c ? 1 : 0.18 },
    itemStyle: { opacity: focus === "all" || focus === c ? 1 : 0.18 },
    z: focus === c ? 5 : 2, emphasis: { focus: "series" },
    data: years.map((y) => by[c]?.[y]?.med ?? null),
    ...(i === 0 ? { markLine: eventLines() } : {}),
  }));
  if (state.pendBand && focus !== "all") {
    const i = A.categories.indexOf(focus);
    series.push(...bandSeries(A.pend_cat.filter((r) => r.cat === focus), years, seriesColor(i), "band"));
  }
  chart("chPendCat").setOption({
    ...b,
    legend: { ...b.legend, data: A.categories },
    tooltip: { ...b.tooltip, formatter: (p) => tipRows(p.filter((x) => !x.seriesName.startsWith("_")), yrsFmt) },
    xAxis: { ...b.xAxis, data: years.map(String) },
    yAxis: { ...b.yAxis, name: "Median years, filing → grant", min: 0 },
    series,
  }, true);
}

function renderChips() {
  const counts = {}; A.pend_sc.forEach((r) => (counts[r.sc] = (counts[r.sc] ?? 0) + r.n));
  $("#scChips").innerHTML = Object.entries(A.subclasses).map(([k, name]) => {
    const on = state.sc.includes(k);
    return `<button class="chip ${on ? "on" : ""}" data-sc="${k}" title="${int(counts[k] ?? 0)} patents">
      <span class="dot" style="background:${on ? seriesColor(state.scSlot[k]) : "transparent"}"></span>${name} <small>${k}</small></button>`;
  }).join("");
}

function renderPendSc() {
  const b = base();
  const years = A.pend_all.map((r) => r.year);
  const by = {}; A.pend_sc.forEach((r) => ((by[r.sc] ||= {})[r.year] = r));
  const series = state.sc.map((sc, j) => ({
    name: `${A.subclasses[sc]} (${sc})`, type: "line", showSymbol: false, smooth: 0.2, connectNulls: false,
    color: seriesColor(state.scSlot[sc]), lineStyle: { width: 2 },
    data: years.map((y) => by[sc]?.[y]?.med ?? null),
    ...(j === 0 ? { markLine: eventLines() } : {}),
  }));
  series.push({ name: "All patents", type: "line", showSymbol: false, color: cv("--text-muted"),
    lineStyle: { width: 1.5, type: [4, 3] }, data: A.pend_all.map((r) => r.med) });
  chart("chPendSc").setOption({
    ...b,
    tooltip: { ...b.tooltip, formatter: (p) => tipRows(p, yrsFmt) },
    xAxis: { ...b.xAxis, data: years.map(String) },
    yAxis: { ...b.yAxis, name: "Median years, filing → grant", min: 0 },
    series,
  }, true);

  const avg = (sc, a, z) => {
    const v = []; for (let y = a; y <= z; y++) if (by[sc]?.[y]) v.push(by[sc][y].med);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const lines = state.sc.map((sc) => {
    const e = avg(sc, 1980, 1989), p = avg(sc, 2008, 2012), n = avg(sc, 2021, 2025);
    const f = (x) => (x == null ? "–" : `${x.toFixed(1)}`);
    return `<b>${A.subclasses[sc]}</b>: ${f(e)} yrs in the 1980s → ${f(p)} at the 2008–12 backlog peak → ${f(n)} in 2021–25`;
  });
  $("#pendInsight").innerHTML = lines.join("<br>") +
    `<br><span style="font-size:13px">Median pendency for patents granted in those years (average of yearly medians).</span>`;
}

function bindChips() {
  $("#scChips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.sc;
    if (state.sc.includes(k)) {
      if (state.sc.length === 1) return;
      state.sc = state.sc.filter((x) => x !== k); delete state.scSlot[k];
    } else {
      if (state.sc.length >= MAX_SC) { const drop = state.sc.shift(); delete state.scSlot[drop]; }
      const used = new Set(Object.values(state.scSlot));
      let slot = 0; while (used.has(slot)) slot++;
      state.sc.push(k); state.scSlot[k] = slot;
    }
    renderChips(); renderPendSc();
  });
}

// ---------- Firms
function renderFirmMix() {
  const b = base(), m = state.firmMetric;
  const decades = [...new Set(A.firm_mix.map((r) => r.decade))];
  const idx = {}; A.firm_mix.forEach((r) => (idx[`${r.decade}|${r.cat}`] = r[m]));
  const tot = {}; decades.forEach((d) => (tot[d] = A.categories.reduce((s, c) => s + (idx[`${d}|${c}`] ?? 0), 0)));
  const firmsTot = {}; decades.forEach((d) => (firmsTot[d] = A.categories.reduce((s, c) => s + (A.firm_mix.find((r) => r.decade === d && r.cat === c)?.firms ?? 0), 0)));
  chart("chFirmMix").setOption({
    ...b,
    tooltip: { ...b.tooltip, axisPointer: { type: "shadow" },
      formatter: (p) => tipRows(p, (v) => `${v.toFixed(1)}%`) + `<br><span style="opacity:.7">${int(firmsTot[+p[0].axisValue.slice(0, 4)])} firms active</span>` },
    xAxis: { ...b.xAxis, boundaryGap: true, data: decades.map((d) => `${d}s`) },
    yAxis: { ...b.yAxis, max: 100, name: m === "firms" ? "Share of patenting firms, by firm's main field" : "Share of patents, by the patenting firm's main field",
      axisLabel: { ...b.yAxis.axisLabel, formatter: "{value}%" } },
    series: A.categories.map((c, i) => ({
      name: c, type: "bar", stack: "f", color: seriesColor(i), barMaxWidth: 56,
      itemStyle: { borderColor: cv("--surface-1"), borderWidth: 1 }, emphasis: { focus: "series" },
      data: decades.map((d) => (tot[d] ? (100 * (idx[`${d}|${c}`] ?? 0)) / tot[d] : 0)),
    })),
  }, true);
}

function renderFirmLines() {
  const b = base(), yrs = A.totals.map((r) => String(r.year));
  const small = { ...b, grid: { ...b.grid, top: 16 }, legend: { show: false } };
  chart("chFirmCount").setOption({
    ...small,
    tooltip: { ...b.tooltip, formatter: (p) => `<b>${p[0].axisValue}</b><br>${int(p[0].value)} firms received a patent` },
    xAxis: { ...b.xAxis, data: yrs }, yAxis: { ...b.yAxis },
    series: [{ name: "Firms", type: "line", showSymbol: false, data: A.totals.map((r) => r.firms), color: seriesColor(0), lineStyle: { width: 2 } }],
  }, true);
  chart("chConc").setOption({
    ...small,
    tooltip: { ...b.tooltip, formatter: (p) => `<b>${p[0].axisValue}</b><br>Top 10 firms: ${p[0].value.toFixed(1)}% of patents` },
    xAxis: { ...b.xAxis, data: A.concentration.map((r) => String(r.year)) },
    yAxis: { ...b.yAxis, min: 0, axisLabel: { ...b.yAxis.axisLabel, formatter: "{value}%" } },
    series: [{ name: "Top-10 share", type: "line", showSymbol: false, data: A.concentration.map((r) => 100 * r.top10), color: seriesColor(1), lineStyle: { width: 2 } }],
  }, true);
}

function renderFirmTable() {
  const rows = A.top_firms.filter((r) => r.decade === +state.firmDecade);
  $("#firmTable tbody").innerHTML = rows.map((r, i) => {
    const ci = A.categories.indexOf(r.cat);
    return `<tr><td class="muted">${i + 1}</td><td>${firmName(r.permno)}</td>
      <td><span class="sw" style="background:${seriesColor(ci)}"></span>${r.cat}</td>
      <td class="num">${int(r.n)}</td><td class="num">${(100 * r.focus).toFixed(0)}%</td><td class="num">${money(r.v)}</td></tr>`;
  }).join("");
}

// ---------- wiring
function renderAll() {
  renderTop(); renderInflation(); renderIndustry(); renderPendCat(); renderChips(); renderPendSc();
  renderFirmMix(); renderFirmLines(); renderFirmTable();
}

async function init() {
  [A, T] = await Promise.all(["data/aggregates.json", "data/top_patents.json"].map((u) => fetch(u).then((r) => r.json())));
  renderKpis();

  const decades = [...new Set(T.by_cites_decade.map((r) => r.decade))];
  $("#rankDecade").insertAdjacentHTML("beforeend", decades.map((d) => `<option value="${d}">${d}s</option>`).join(""));
  const catOpts = A.categories.map((c) => `<option>${c}</option>`).join("");
  $("#rankCat").insertAdjacentHTML("beforeend", catOpts);
  $("#pendFocus").insertAdjacentHTML("beforeend", catOpts);
  const fDec = [...new Set(A.top_firms.map((r) => r.decade))];
  state.firmDecade = fDec[fDec.length - 1];
  $("#firmDecade").innerHTML = fDec.map((d) => `<option value="${d}" ${d === state.firmDecade ? "selected" : ""}>${d}s</option>`).join("");

  seg("#rankBy", "rankBy", renderTop);
  seg("#inflStat", "inflStat", renderInflation);
  seg("#indMetric", "indMetric", renderIndustry);
  seg("#indMode", "indMode", renderIndustry);
  seg("#firmMetric", "firmMetric", renderFirmMix);
  $("#rankDecade").onchange = (e) => { state.rankDecade = e.target.value; renderTop(); };
  $("#rankCat").onchange = (e) => { state.rankCat = e.target.value; renderTop(); };
  $("#pendFocus").onchange = (e) => {
    state.pendFocus = e.target.value;
    if (state.pendFocus !== "all" && !$("#pendBand").checked) { $("#pendBand").checked = true; state.pendBand = true; }
    renderPendCat();
  };
  $("#pendBand").onchange = (e) => { state.pendBand = e.target.checked; renderPendCat(); };
  $("#firmDecade").onchange = (e) => { state.firmDecade = e.target.value; renderFirmTable(); };
  bindChips();

  renderAll();
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}
init();
