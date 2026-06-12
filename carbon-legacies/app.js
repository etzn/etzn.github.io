'use strict';
/* UI wiring + hand-rolled SVG charts for the Carbon Legacy Explorer.
 * Depends on model.js (window.CarbonModel). No DOM access until DOMContentLoaded. */
(function () {
  const M = window.CarbonModel;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---- State (defaults match the usToday preset; applyPreset overwrites) ----
  const state = {
    scenario: 'constant',
    tfr0: 1.60, ftgt: 1.60, ftyr: 2050,
    co2: 14.0, emtgt: 14.0, e0: 81.1, T: 30, N: 1,
    sy: 2024, ff: 0.5,
    scale: 'log', // scale ladder: 'log' | 'linear'
  };

  // Controls that map 1:1 to numeric state keys.
  const NUM = {
    tfr0: ['tfr0v', (v) => v.toFixed(2)],
    ftgt: ['ftgtv', (v) => v.toFixed(2)],
    ftyr: ['ftyrv', (v) => String(v)],
    co2: ['co2v', (v) => v.toFixed(2) + ' t'],
    emtgt: ['emtgtv', (v) => v.toFixed(1) + ' t'],
    e0: ['e0v', (v) => v.toFixed(1)],
    T: ['Tv', (v) => v.toFixed(1)],
    N: ['Nv', (v) => String(v)],
    sy: ['syv', (v) => String(v)],
    ff: ['ffv', (v) => v.toFixed(3)],
  };

  // ---- Parameter assembly ----
  function emissionTarget() {
    if (state.scenario === 'custom') return state.emtgt;
    return M.scenarioTarget(state.scenario, state.co2);
  }
  function params() {
    return {
      startYear: state.sy, e0: state.e0, T: state.T, fFemale: state.ff,
      fertility: { tfr0: state.tfr0, startYear: state.sy, target: state.ftgt, targetYear: state.ftyr },
      emissions: { base: state.co2, startYear: state.sy, target: emissionTarget(), targetYear: 2100 },
    };
  }

  // ---- Formatting ----
  function fmt(x) {
    if (!isFinite(x)) return '∞';
    const s = x < 0 ? '-' : '';
    const a = Math.abs(x);
    if (a >= 100) return s + Math.round(a).toLocaleString('en-US');
    if (a >= 10) return s + a.toFixed(0);
    return s + a.toFixed(1);
  }
  // tCO2e/yr label with enough precision that the tiny annualized per-use items
  // stay legible on the same honest unit as the big life decisions.
  function tyr(v) {
    if (!isFinite(v)) return '∞';
    if (v >= 10) return Math.round(v).toLocaleString('en-US') + ' t/yr';
    if (v >= 0.1) return v.toFixed(2) + ' t/yr';
    if (v >= 0.01) return v.toFixed(3) + ' t/yr';
    return v.toFixed(4) + ' t/yr';
  }

  // ---- Charts ----
  function svg(parent, w, h) {
    parent.innerHTML = '';
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', '100%');
    s.style.display = 'block';
    parent.appendChild(s);
    return s;
  }
  function el(svgEl, name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    svgEl.appendChild(e);
    return e;
  }
  function text(svgEl, x, y, str, opts) {
    const t = el(svgEl, 'text', Object.assign({ x, y, fill: '#9fb0c0', 'font-size': 11 }, opts || {}));
    t.textContent = str;
    return t;
  }
  // Generic line plot. series: [{xs, ys, color, stroke, ymin, ymax}].
  // opts.sharedY: put every series on one common y-axis (left labels only).
  // opts.markers: [{x, label, color}] vertical reference lines (e.g. 2008/2024).
  function linePlot(host, series, opts) {
    opts = opts || {};
    const W = 640, H = 230, ml = 48, mr = opts.mr || 14, mt = 12, mb = 28;
    const s = svg(host, W, H);
    const xs0 = opts.xmin, xs1 = opts.xmax;
    const px = (x) => ml + (x - xs0) / (xs1 - xs0) * (W - ml - mr);
    // axes box
    el(s, 'line', { x1: ml, y1: H - mb, x2: W - mr, y2: H - mb, stroke: '#33414e' });
    el(s, 'line', { x1: ml, y1: mt, x2: ml, y2: H - mb, stroke: '#33414e' });
    // x ticks
    const xticks = opts.xticks || 6;
    for (let i = 0; i <= xticks; i++) {
      const xv = xs0 + (xs1 - xs0) * i / xticks;
      const X = px(xv);
      el(s, 'line', { x1: X, y1: H - mb, x2: X, y2: H - mb + 4, stroke: '#33414e' });
      text(s, X, H - mb + 16, Math.round(xv), { 'text-anchor': 'middle' });
    }
    // shared y-domain across all series (one honest axis)
    let sharedPy = null, sYmin = 0, sYmax = 1;
    if (opts.sharedY) {
      let lo = Infinity, hi = -Infinity;
      series.forEach((ser) => ser.ys.forEach((y) => { if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } }));
      sYmin = opts.ymin != null ? opts.ymin : Math.min(0, lo);
      sYmax = hi > sYmin ? hi : sYmin + 1;
      sharedPy = (y) => (H - mb) - (y - sYmin) / (sYmax - sYmin) * (H - mb - mt);
    }
    const labFmt = (yv) => yv >= 1000 ? Math.round(yv).toLocaleString('en-US') : (yv >= 10 ? yv.toFixed(0) : yv.toFixed(2));
    series.forEach((ser, si) => {
      let py, ymin, ymax;
      if (sharedPy) { py = sharedPy; ymin = sYmin; ymax = sYmax; }
      else {
        ymax = ser.ymax != null ? ser.ymax : Math.max.apply(null, ser.ys.concat([1e-9]));
        ymin = ser.ymin != null ? ser.ymin : 0;
        py = (y) => (H - mb) - (y - ymin) / (ymax - ymin) * (H - mb - mt);
      }
      let d = '';
      for (let i = 0; i < ser.xs.length; i++) {
        d += (i === 0 ? 'M' : 'L') + px(ser.xs[i]).toFixed(1) + ' ' + py(ser.ys[i]).toFixed(1) + ' ';
      }
      el(s, 'path', { d, fill: 'none', stroke: ser.color, 'stroke-width': ser.stroke || 2 });
      // y-axis labels
      if (sharedPy) {
        if (si === 0) {
          for (let i = 0; i <= 4; i++) {
            const yv = sYmin + (sYmax - sYmin) * i / 4;
            text(s, ml - 6, py(yv) + 3, labFmt(yv), { 'text-anchor': 'end' });
          }
        }
      } else {
        const onRight = si === 1;
        for (let i = 0; i <= 4; i++) {
          const yv = ymin + (ymax - ymin) * i / 4;
          text(s, onRight ? W - mr + 4 : ml - 6, py(yv) + 3, labFmt(yv),
            { 'text-anchor': onRight ? 'start' : 'end', fill: ser.color });
        }
      }
    });
    // vertical reference markers
    (opts.markers || []).forEach((m) => {
      const X = px(m.x);
      el(s, 'line', { x1: X, y1: mt, x2: X, y2: H - mb, stroke: m.color || '#6b7d8c', 'stroke-dasharray': '3 3', 'stroke-width': 1 });
      if (m.label) {
        const nearMax = m.x >= xs1 - (xs1 - xs0) * 0.06;
        const nearMin = m.x <= xs0 + (xs1 - xs0) * 0.06;
        const anchor = nearMax ? 'end' : nearMin ? 'start' : 'middle';
        const dx = nearMax ? -3 : nearMin ? 3 : 0;
        text(s, X + dx, mt + 10, m.label, { 'text-anchor': anchor, fill: m.color || '#9fb0c0' });
      }
    });
  }

  const GREEN = '#4caf80', ORANGE = '#e0883b';

  // ---- Render ----
  function render() {
    const p = params();
    const res = M.perChildLegacy(p);
    const diverges = res.diverges;

    $('divBanner').classList.toggle('show', diverges);

    $('rDelta').textContent = fmt(res.delta);
    $('rOwn').textContent = fmt(res.ownLifetimeEmissions);
    $('rRatio').textContent = diverges ? '∞' : (res.delta / res.ownLifetimeEmissions).toFixed(2);
    $('rPY').textContent = fmt(res.personYears);
    $('rN').textContent = state.N;
    const tot = M.legacyForNChildren(p, state.N).total;
    $('rTotal').textContent = fmt(tot);

    // genetic-units trajectory chart (cap horizon so it stays readable)
    const tMax = Math.min(260, state.T * 8 + state.e0);
    const tr = M.gUnitsTrajectory(p, state.N, tMax, 0.5);
    const gx = tr.t.map((t) => state.sy + t);
    const gy = tr.g.slice();
    if (state.sy > 2000) { gx.unshift(2000, state.sy - 0.01); gy.unshift(0, 0); } // lineage not yet born
    linePlot($('chartG'), [{ xs: gx, ys: gy, color: GREEN, ymin: 0 }],
      { xmin: 2000, xmax: state.sy + tMax, xticks: 6 });

    // inputs chart: TFR + H over calendar years (axis from 2000)
    const yrs = [];
    for (let y = 2000; y <= 2160; y += 2) yrs.push(y);
    const tfrSer = yrs.map((y) => M.tfrAt(y, p.fertility));
    const hSer = yrs.map((y) => M.emissionAt(y, p.emissions));
    linePlot($('chartInputs'), [
      { xs: yrs, ys: tfrSer, color: GREEN, ymin: 0, ymax: Math.max(2.1, state.tfr0 * 1.1) },
      { xs: yrs, ys: hSer, color: ORANGE, ymin: 0, ymax: Math.max(1, state.co2, emissionTarget()) * 1.1 },
    ], { xmin: 2000, xmax: 2160, xticks: 6, mr: 44 });

    // cumulative legacy per child over calendar time
    cumulativeChart(p);

    // scale ladder + historical backtest + appendices
    renderScale(res);
    renderBacktest();
    renderTable();
    renderImmigration();
  }

  // ---- Unified scale ladder: one log axis in tCO2e/yr -------------------
  // Big life decisions in native t/yr (child = Δ÷life expectancy; immigration =
  // the average-immigrant legacy gap ÷ life expectancy; never-born = a person's
  // whole legacy ÷ life expectancy) sit alongside the W&N lifestyle actions and
  // the per-use micro-items, each annualized at a deliberately generous rate
  // shown in its label. Sorted least -> most, so the smallest worry is at the top
  // and the reader descends to the big levers.
  function renderScale(res) {
    const sc = state.scenario === 'custom' ? 'constant' : state.scenario;
    const childAnnual = res.diverges ? Infinity : res.delta / res.ownLifeYears;
    const imm = M.averageImmigrantIncrease(sc);
    const immAnnual = imm.increase / M.IMMIGRATION.average.usE0;
    // "Is never born": the focal person's entire legacy — own lifetime emissions
    // plus every descendant's (completed fertility taken as the live starting TFR,
    // matching how the immigration bars use a population TFR) — annualized.
    const neverBorn = res.diverges ? Infinity
      : (res.ownLifetimeEmissions + state.tfr0 * res.delta) / res.ownLifeYears;

    const rows = [
      { name: 'Is never born', value: neverBorn, color: GREEN, nameColor: GREEN },
      { name: 'Has one fewer child', value: childAnnual, color: GREEN, nameColor: GREEN },
      { name: "Doesn't immigrate to the US", value: immAnnual, color: GREEN, nameColor: GREEN },
    ];
    M.LIFESTYLE_ACTIONS.forEach((a) => rows.push({ name: a.name,  value: a.tPerYear, color: GREEN }));
    M.LLM_COMPARISONS.forEach((it) =>  rows.push({ name: it.name, value: it.grams * it.perYear / 1e6, color: GREEN }));

    rows.sort((a, b) => (isFinite(a.value) ? a.value : 1e18) - (isFinite(b.value) ? b.value : 1e18));
    rows.forEach((r) => { r.valText = tyr(r.value); });
    drawHbars($('scaleBars'), rows, state.scale);

    const childTxt = isFinite(childAnnual) ? Math.round(childAnnual).toLocaleString('en-US') : '∞';
    const neverBornTxt = isFinite(neverBorn) ? Math.round(neverBorn).toLocaleString('en-US') : '∞';
    const llm = M.LLM_COMPARISONS.find((x) => x.name.indexOf('LLM') >= 0);
    const llmAnnual = llm.grams * llm.perYear / 1e6;
    $('scaleNote').innerHTML =
      `Everything is one unit — tonnes CO₂e per year, ${state.scale} scale. ` +
      `Each green bar is a yearly emission a person could avoid. The ` +
      `largest are live outputs of the model below: <b style="color:${GREEN}">never being born</b> (a whole ` +
      `legacy — own lifetime emissions plus every descendant’s, ÷ ${res.ownLifeYears.toFixed(0)} yr ≈ ` +
      `${neverBornTxt} t/yr), <b style="color:${GREEN}">not immigrating to the US</b> (the average US ` +
      `foreign-born person’s extra lifetime emissions over the average person in immigrants’ origin countries, ` +
      `÷ ${M.IMMIGRATION.average.usE0} yr ≈ ${Math.round(immAnnual)} t/yr; see the appendix), and ` +
      `<b style="color:${GREEN}">one fewer child</b> (lifetime Δ = ${fmt(res.delta)} t ÷ ` +
      `${res.ownLifeYears.toFixed(0)} yr ≈ ${childTxt} t/yr). The per-use items people fret about are ` +
      `annualized at the deliberately heavy rates shown in each label and still sit at the floor — even at ` +
      `100 prompts a day, an LLM query is about ${llmAnnual.toFixed(3)} t/yr.`;
  }

  // ---- Immigration justification table (tracks selected scenario) ----
  function renderImmigration() {
    const sc = state.scenario === 'custom' ? 'constant' : state.scenario;
    const tb = $('immTable').querySelector('tbody');
    tb.innerHTML = '';

    // Highlighted headline row: the two-population-average gap.
    const avg = M.averageImmigrantIncrease(sc);
    const a = M.IMMIGRATION.average;
    const avgRow = document.createElement('tr');
    avgRow.className = 'avg';
    avgRow.innerHTML =
      `<td>Average immigrant (US foreign-born vs origin avg)</td>` +
      `<td>${a.homeCo2.toFixed(2)}</td>` +
      `<td>${fmt(avg.home.total)}</td>` +
      `<td>${fmt(avg.us.total)}</td>` +
      `<td class="pos">+${fmt(avg.increase)}</td>` +
      `<td>×${avg.ratio.toFixed(2)}</td>`;
    tb.appendChild(avgRow);

    // Per-country emissions-intensity effect (each origin's own fertility, both sides).
    M.IMMIGRATION.origins.forEach((o) => {
      const r = M.immigrationComparison(o.name, sc);
      const inc = r.increase;
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${o.name} → US</td>` +
        `<td>${o.co2.toFixed(2)}</td>` +
        `<td>${fmt(r.home.total)}</td>` +
        `<td>${fmt(r.us.total)}</td>` +
        `<td class="${inc >= 0 ? 'pos' : 'neg'}">${inc >= 0 ? '+' : ''}${fmt(inc)}</td>` +
        `<td>×${r.ratio.toFixed(2)}</td>`;
      tb.appendChild(tr);
    });

    // Reference: US native-born adult (native fertility, US emissions).
    const nat = M.nativeUsAdultLegacy(sc);
    const refRow = document.createElement('tr');
    refRow.className = 'ref';
    refRow.innerHTML =
      `<td>(US native-born, ref.)</td><td>${M.IMMIGRATION.us.co2.toFixed(2)}</td>` +
      `<td>—</td><td>${fmt(nat.total)}</td><td>—</td><td>—</td>`;
    tb.appendChild(refRow);

    $('immNote').innerHTML =
      `The “Doesn’t immigrate to the US” saving up top is the highlighted row: the gap between two real ` +
      `population averages — the average US foreign-born person (measured fertility 2.19, US emissions) and ` +
      `the average person in immigrants’ origin countries (origin-weighted fertility ~1.9, ~3.8 t emissions). ` +
      `No personal counterfactual is imposed, so it reflects both the emissions jump and the higher fertility ` +
      `of the US foreign-born. The country rows instead hold each origin’s fertility fixed on both sides, ` +
      `isolating the emissions effect. <b>Canada is the tell</b> — its per-capita emissions (14.4 t) slightly ` +
      `exceed the US, so relocating <i>lowers</i> the legacy (×&lt;1); the driver is the carbon intensity of ` +
      `the destination, not movement itself. The faint US native-born row (fertility 1.66) sits below every ` +
      `immigrant figure at the same US emissions — the fertility dimension, isolated. Legacy = own lifetime ` +
      `emissions + (completed fertility) × per-child Δ, current (~2023) inputs.`;
  }

  // Shared scale-aware horizontal bar renderer. rows: [{name, value, color,
  // nameColor, valText}]. scale: 'linear' | 'log'.
  function drawHbars(host, rows, scale) {
    host.innerHTML = '';
    const pos = rows.map((r) => r.value).filter((v) => isFinite(v) && v > 0);
    const maxV = Math.max.apply(null, pos.concat([1e-9]));
    const minV = Math.min.apply(null, pos.concat([maxV]));
    const logMin = Math.log10(minV) - 0.35; // headroom so the smallest bar stays visible
    const logMax = Math.log10(maxV);
    rows.forEach((r) => {
      let pct;
      if (!isFinite(r.value)) pct = 100;
      else if (r.value <= 0) pct = 0.4;
      else if (scale === 'log') pct = Math.max(1.5, (Math.log10(r.value) - logMin) / (logMax - logMin) * 100);
      else pct = Math.max(0.4, (r.value / maxV) * 100);
      const div = document.createElement('div');
      div.className = 'hbar';
      const nc = r.nameColor ? ` style="color:${r.nameColor};font-weight:700"` : '';
      div.innerHTML =
        `<div class="name"${nc}>${r.name}</div>` +
        `<div class="track"><div class="fill" style="width:${pct}%;background:${r.color}"></div></div>` +
        `<div class="val"${nc}>${r.valText}</div>`;
      host.appendChild(div);
    });
  }

  // Cumulative Δ(t): integrate ½ Σ P_i S(t-t_i) H(t) contribution over calendar
  // years. Returned as {xs, ys} so both the per-child chart and the backtest
  // overlay share one implementation.
  function cumulativeSeries(p) {
    const S = M.makeSurvivor(p.e0);
    const tr = M.gUnitsTrajectory(p, 1, Math.min(300, p.T * 9 + p.e0), 0.5); // N=1 descendant genetic units (minus self)
    const xs = [], ys = [];
    let cum = 0;
    const dt = 0.5;
    if (p.startYear > 2000) { xs.push(2000); ys.push(0); } // nothing accrued before the lineage exists
    for (let i = 0; i < tr.t.length; i++) {
      const t = tr.t[i];
      const descG = tr.g[i] - S(t);
      const H = M.emissionAt(p.startYear + t, p.emissions);
      if (i > 0) cum += descG * H * dt;
      xs.push(p.startYear + t);
      ys.push(cum);
    }
    return { xs, ys };
  }
  function cumulativeChart(p) {
    const { xs, ys } = cumulativeSeries(p);
    linePlot($('chartCum'), [{ xs, ys, color: GREEN, ymin: 0 }],
      { xmin: 2000, xmax: xs[xs.length - 1], xticks: 6 });
  }

  function deltaFor(opts) {
    return M.perChildLegacy(M.buildParams(opts));
  }

  // ---- Chart A: per-child legacy by base year, 1960–2024 (static) -------
  function renderProjectionHistory() {
    const hist = M.historicalProjectedLegacy({ step: 1 });
    const xs = hist.map((d) => d.year);
    const ys = hist.map((d) => (isFinite(d.delta) ? d.delta : 0));
    const ymax = Math.max.apply(null, ys) * 1.08;
    linePlot($('chartHist'), [{ xs, ys, color: GREEN, ymin: 0, ymax }], {
      xmin: 1960, xmax: 2024, xticks: 8,
      markers: [
        { x: 2008, label: '2008', color: '#9fb0c0' },
        { x: 2024, label: '2024', color: GREEN },
      ],
    });
    const g = (y) => hist.find((d) => d.year === y).delta;
    const drop = Math.round((1 - g(2024) / g(2008)) * 100);
    $('histNote').innerHTML =
      `The per-child legacy (t CO₂, constant-emission reference) recomputed at each base year from that ` +
      `year’s US fertility and per-capita emissions, with fertility easing to the long-run UN-medium 1.85 ` +
      `(or holding at the current level if already lower) over 45 years. The 2008 vintage reproduces the ` +
      `paper’s headline (~${Math.round(g(2008)).toLocaleString('en-US')} t); by 2024 the same method gives ` +
      `~${Math.round(g(2024)).toLocaleString('en-US')} t — about ${drop}% lower, as the grid decarbonized and ` +
      `fertility fell. The much-cited 2008 figure simply isn’t today’s figure.`;
  }

  // ---- Chart B: 2008 projection vs what actually happened ---------------
  // Parked in the markup for now; this no-ops until #chartBacktest is restored.
  function renderBacktest() {
    if (!$('chartBacktest')) return;
    const sc = state.scenario === 'custom' ? 'constant' : state.scenario;
    const bt = M.projectionBacktest(sc);
    const proj = cumulativeSeries(bt.projected.params);
    const real = cumulativeSeries(bt.realized.params);
    const xmax = Math.max(proj.xs[proj.xs.length - 1], real.xs[real.xs.length - 1]);
    linePlot($('chartBacktest'), [
      { xs: proj.xs, ys: proj.ys, color: ORANGE },
      { xs: real.xs, ys: real.ys, color: GREEN },
    ], { xmin: 2000, xmax, xticks: 7, sharedY: true, ymin: 0 });

    const over = bt.overstatementPct;
    $('backtestNote').innerHTML =
      `Two 2008-vintage projections of one child’s cumulative legacy: ` +
      `<b style="color:${ORANGE}">as the 2008 paper assumed</b> (emissions flat at 20.18 t, fertility easing ` +
      `to 1.85) versus <b style="color:${GREEN}">what actually happened</b> (per-capita CO₂ fell to ~14 t and ` +
      `fertility to 1.60 by 2024, then held). The realized path runs well below — the 2008 reference ` +
      `overstated the eventual per-child legacy by about ` +
      `<b>${over == null ? '—' : Math.round(over) + '%'}</b> ` +
      `(${fmt(bt.projected.delta)} t projected vs ${fmt(bt.realized.delta)} t realized). Tracks the emission ` +
      `scenario selected in the model.`;
  }

  function renderTable() {
    const tb = $('repTable').querySelector('tbody');
    tb.innerHTML = '';
    M.COUNTRIES.forEach((c) => {
      const r = deltaFor({
        startYear: 2005, e0: c.e0, co2: c.co2, tfr0: c.tfr,
        fertilityTarget: 1.85, fertilityTargetYear: 2050, scenario: 'constant',
        T: state.T, fFemale: state.ff,
      });
      const dev = (r.delta / c.paper.constant - 1) * 100;
      const cls = Math.abs(dev) <= 15 ? 'dev-good' : Math.abs(dev) <= 60 ? 'dev-mid' : 'dev-bad';
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${c.name}</td><td>${c.co2.toFixed(2)}</td>` +
        `<td>${c.paper.constant.toLocaleString('en-US')}</td>` +
        `<td>${fmt(r.delta)}</td>` +
        `<td class="${cls}">${(dev >= 0 ? '+' : '') + dev.toFixed(0)}%</td>`;
      tb.appendChild(tr);
    });
  }

  // ---- Control sync ----
  function syncLabels() {
    for (const key in NUM) {
      const [labId, f] = NUM[key];
      $(labId).textContent = f(state[key]);
    }
    document.querySelectorAll('#scenario label').forEach((l) => {
      l.classList.toggle('sel', l.dataset.s === state.scenario);
    });
    $('emTgtWrap').style.display = state.scenario === 'custom' ? '' : 'none';
    $('scenarioNote').textContent = scenarioNote();
    for (const key in NUM) { const inp = $(key); if (inp) inp.value = state[key]; }
    document.querySelectorAll('input[name=sc]').forEach((r) => { r.checked = r.value === state.scenario; });
  }
  function scenarioNote() {
    const b = state.co2;
    switch (state.scenario) {
      case 'optimistic': return `Per-capita CO₂ falls linearly to ${M.scenarioTarget('optimistic', b).toFixed(2)} t by 2100 (floored at the base if already lower), then constant.`;
      case 'pessimistic': return `Per-capita CO₂ rises to ${(1.5 * b).toFixed(1)} t (1.5× base) by 2100, then constant.`;
      case 'custom': return 'Set the 2100 per-capita CO₂ target manually with the slider below.';
      default: return 'Per-capita CO₂ held at the base value indefinitely (paper’s reference case).';
    }
  }

  function applyPreset(name) {
    const p = M.PRESETS[name];
    state.sy = p.startYear; state.e0 = p.e0; state.co2 = p.co2;
    state.tfr0 = p.tfr0; state.ftgt = p.fertilityTarget; state.ftyr = p.fertilityTargetYear;
    state.T = p.T; state.ff = p.fFemale;
    if (state.scenario === 'custom') state.emtgt = p.co2;
    document.querySelectorAll('#presets .preset').forEach((b) =>
      b.classList.toggle('active', b.dataset.preset === name));
    syncLabels(); render();
  }

  function wire() {
    for (const key in NUM) {
      const inp = $(key);
      inp.addEventListener('input', () => {
        state[key] = parseFloat(inp.value);
        document.querySelectorAll('#presets .preset').forEach((b) => b.classList.remove('active'));
        syncLabels(); render();
      });
    }
    document.querySelectorAll('input[name=sc]').forEach((r) => {
      r.addEventListener('change', () => {
        state.scenario = r.value;
        if (state.scenario === 'custom' && (!state.emtgt || state.emtgt === 0)) state.emtgt = state.co2;
        syncLabels(); render();
      });
    });
    document.querySelectorAll('#presets .preset').forEach((b) => {
      b.addEventListener('click', () => applyPreset(b.dataset.preset));
    });
    document.querySelectorAll('.scaletoggle button').forEach((b) => {
      b.addEventListener('click', () => { state.scale = b.dataset.scale; syncScaleToggles(); render(); });
    });
  }

  function syncScaleToggles() {
    document.querySelectorAll('.scaletoggle button').forEach((b) =>
      b.classList.toggle('active', b.dataset.scale === state.scale));
  }

  document.addEventListener('DOMContentLoaded', () => {
    wire();
    syncScaleToggles();
    renderProjectionHistory(); // static history chart, independent of the controls
    applyPreset('usToday');    // lead with current US numbers; sets defaults + first render
  });
})();
