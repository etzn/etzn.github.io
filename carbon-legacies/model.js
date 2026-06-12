'use strict';
/*
 * Carbon-legacy model core — Murtaugh & Schlax (2009),
 * "Reproduction and the carbon legacies of individuals", Global Env. Change 19:14-20.
 *
 * Focused on the headline metric: carbon legacy added per marginal child.
 *
 * Pure computation, no DOM. Runs under Node (CommonJS) and in the browser
 * (attaches to window.CarbonModel).
 *
 * Notation follows summary.md / Appendix A:
 *   S(a)  survivor function (prob. alive at age a)
 *   T     generation time (mean age of childbearing)
 *   R(t)  net reproductive rate = daughters per woman = TFR(t)*fFemale*S(T)
 *   H(t)  per-capita CO2 emission rate (t CO2 / person / yr)
 *   Delta = (1/2) * sum_{i>=1} P_i * L(i*T),  P_1 = 1, P_i = prod_{j=2..i} R(t_j)
 *   L(tau) = lifetime emissions of an individual born tau years after the ancestor
 *          = integral_0^inf S(a) H(year0 + tau + a) da
 */

// ---- Gompertz–Makeham survivorship, one-parameter (life expectancy) ----
// S(a) = exp(-A*a - (B/c)(e^{c a} - 1)); A, c fixed, B solved for target e0.
const GM_A = 2e-4;
const GM_C = 0.1;
const AGE_MAX = 120;
const DA = 0.1; // integration step for ages (years)

function survivorWithB(B) {
  return function S(a) {
    if (a <= 0) return 1;
    const v = Math.exp(-GM_A * a - (B / GM_C) * (Math.exp(GM_C * a) - 1));
    return v < 0 ? 0 : v;
  };
}

function integrateS(S) {
  // Trapezoidal integral of S over [0, AGE_MAX] = life expectancy.
  let sum = 0;
  let prev = S(0);
  for (let a = DA; a <= AGE_MAX + 1e-9; a += DA) {
    const cur = S(a);
    sum += (prev + cur) * 0.5 * DA;
    prev = cur;
  }
  return sum;
}

// Solve B by bisection so that integral of S equals target e0.
// Larger B -> faster decay -> smaller e0, so e0(B) is monotone decreasing.
function makeSurvivor(e0) {
  let lo = 1e-9;   // very long-lived
  let hi = 1.0;    // very short-lived
  for (let iter = 0; iter < 200; iter++) {
    const mid = 0.5 * (lo + hi);
    const got = integrateS(survivorWithB(mid));
    if (got > e0) lo = mid; // too long-lived, increase B
    else hi = mid;
    if (Math.abs(got - e0) < 1e-6) break;
  }
  return survivorWithB(0.5 * (lo + hi));
}

function lifeExpectancy(S) {
  return integrateS(S);
}

// ---- Piecewise-linear input paths ----
function tfrAt(year, p) {
  if (year <= p.startYear) return p.tfr0;
  if (year >= p.targetYear) return p.target;
  const frac = (year - p.startYear) / (p.targetYear - p.startYear);
  return p.tfr0 + frac * (p.target - p.tfr0);
}

function emissionAt(year, p) {
  if (year <= p.startYear) return p.base;
  if (year >= p.targetYear) return p.target;
  const frac = (year - p.startYear) / (p.targetYear - p.startYear);
  return p.base + frac * (p.target - p.base);
}

function netReproduction(tfr, fFemale, S, T) {
  return tfr * fFemale * S(T);
}

// Lifetime emissions of an individual born `birthOffset` years after year0=startYear.
function lifetimeEmissions(S, emis, birthYear) {
  let sum = 0;
  let prev = S(0) * emissionAt(birthYear, emis);
  for (let a = DA; a <= AGE_MAX + 1e-9; a += DA) {
    const cur = S(a) * emissionAt(birthYear + a, emis);
    sum += (prev + cur) * 0.5 * DA;
    prev = cur;
  }
  return sum;
}

const MAX_GEN = 60;

// Per-child carbon legacy (Delta) and person-years per child.
function perChildLegacy(p) {
  const S = makeSurvivor(p.e0);
  let product = 1; // P_i ; P_1 = 1 (empty product)
  let legacySum = 0;
  let pyearsSum = 0;
  let diverges = false;
  let prevProduct = 1;
  let growthStreak = 0;
  const e0 = lifeExpectancy(S);

  for (let i = 1; i <= MAX_GEN; i++) {
    const birthYear = p.startYear + i * p.T;
    const L = lifetimeEmissions(S, p.emissions, birthYear);
    legacySum += product * L;
    pyearsSum += product * e0;

    // Detect divergence: product not shrinking after several generations.
    if (i >= 3) {
      if (product >= prevProduct - 1e-15) growthStreak++;
      else growthStreak = 0;
      if (growthStreak >= 8) { diverges = true; break; }
    }
    prevProduct = product;

    // Update product for next generation: multiply by R at next childbearing year.
    const nextYear = p.startYear + (i + 1) * p.T;
    const R = netReproduction(tfrAt(nextYear, p.fertility), p.fFemale, S, p.T);
    product *= R;

    if (product < 1e-12) break; // converged
  }

  return {
    diverges,
    delta: diverges ? Infinity : 0.5 * legacySum,
    personYears: diverges ? Infinity : 0.5 * pyearsSum,
    ownLifetimeEmissions: lifetimeEmissions(S, p.emissions, p.startYear),
    ownLifeYears: e0,
  };
}

// Total legacy for an ancestor having exactly N children.
function legacyForNChildren(p, N) {
  const pc = perChildLegacy(p);
  return {
    diverges: pc.diverges,
    own: pc.ownLifetimeEmissions,
    total: pc.diverges ? Infinity : pc.ownLifetimeEmissions + N * pc.delta,
    perChild: pc.delta,
  };
}

// genetic units alive over time for an ancestor with exactly N children (Fig. 3 style).
// G(t) = S(t) + (N/2) * sum_{i: i*T <= t} P_i * S(t - i*T)
function gUnitsTrajectory(p, N, tMax, dt) {
  const S = makeSurvivor(p.e0);
  dt = dt || 0.5;
  // Precompute P_i and birth times up to tMax.
  const births = [];
  let product = 1;
  for (let i = 1; i * p.T <= tMax + 1e-9 && i <= MAX_GEN; i++) {
    births.push({ time: i * p.T, P: product });
    const nextYear = p.startYear + (i + 1) * p.T;
    const R = netReproduction(tfrAt(nextYear, p.fertility), p.fFemale, S, p.T);
    product *= R;
  }
  const t = [];
  const g = [];
  for (let cur = 0; cur <= tMax + 1e-9; cur += dt) {
    let val = S(cur);
    for (const b of births) {
      if (b.time <= cur) val += (N / 2) * b.P * S(cur - b.time);
    }
    t.push(Number(cur.toFixed(4)));
    g.push(val);
  }
  return { t, g, births };
}

// ---- Presets ----------------------------------------------------------
// Default generation time and female-fraction calibrated so US paper inputs
// reproduce Table 2 (constant 9663 vs paper 9441, +2.4%; person-years 479 vs
// 470; ratio 5.96 vs 5.7). Exact reproduction is impossible without the paper's
// unpublished US life table and the precise UN-medium-variant TFR trajectory;
// deviations are reported on the page.
const DEFAULT_T = 30;
const DEFAULT_FFEMALE = 0.5;

// Standard emission-scenario target for a given 2005 base value.
// Optimistic floors at the base when the base is already below the 0.5 t target
// (paper's treatment of very-low emitters, e.g. Bangladesh).
function scenarioTarget(scenario, base) {
  if (scenario === 'optimistic') return Math.min(0.5, base);
  if (scenario === 'pessimistic') return 1.5 * base;
  return base; // constant
}

// Paper Table 2 (medium-variant fertility). co2 = 2005 per-capita t CO2/yr.
// tfr/e0 are approximate 2005 national values used to drive the model; the
// paper's exact demographic inputs are not published, so country numbers are
// indicative replications, not exact.
const COUNTRIES = [
  { name: 'United States', co2: 20.18, tfr: 2.05, e0: 80.4, paper: { constant: 9441, optimistic: 562, pessimistic: 12730 }, personYears: 470 },
  { name: 'Russia',        co2: 11.70, tfr: 1.30, e0: 72.0, paper: { constant: 2498, optimistic: 295, pessimistic: 3497 } },
  { name: 'Japan',         co2: 9.91,  tfr: 1.26, e0: 86.0, paper: { constant: 2026, optimistic: 233, pessimistic: 2829 } },
  { name: 'Mexico',        co2: 3.67,  tfr: 2.40, e0: 78.0, paper: { constant: 1241, optimistic: 222, pessimistic: 1800 } },
  { name: 'China',         co2: 3.62,  tfr: 1.70, e0: 75.0, paper: { constant: 1384, optimistic: 228, pessimistic: 2023 } },
  { name: 'Brazil',        co2: 1.83,  tfr: 2.25, e0: 75.0, paper: { constant: 721,  optimistic: 207, pessimistic: 1006 } },
  { name: 'Indonesia',     co2: 1.29,  tfr: 2.40, e0: 71.0, paper: { constant: 380,  optimistic: 143, pessimistic: 627 } },
  { name: 'India',         co2: 1.05,  tfr: 2.81, e0: 67.0, paper: { constant: 171,  optimistic: 87,  pessimistic: 231 } },
  { name: 'Nigeria',       co2: 0.75,  tfr: 5.32, e0: 54.0, paper: { constant: 110,  optimistic: 73,  pessimistic: 157 } },
  { name: 'Pakistan',      co2: 0.67,  tfr: 3.52, e0: 67.0, paper: { constant: 205,  optimistic: 128, pessimistic: 273 } },
  { name: 'Bangladesh',    co2: 0.27,  tfr: 2.83, e0: 68.0, paper: { constant: 56,   optimistic: 56,  pessimistic: 94 } },
];

// Build a full parameter set from a country/base configuration + scenario.
function buildParams(opts) {
  const scenario = opts.scenario || 'constant';
  const base = opts.co2;
  return {
    startYear: opts.startYear,
    e0: opts.e0,
    T: opts.T != null ? opts.T : DEFAULT_T,
    fFemale: opts.fFemale != null ? opts.fFemale : DEFAULT_FFEMALE,
    fertility: {
      tfr0: opts.tfr0,
      startYear: opts.startYear,
      target: opts.fertilityTarget,
      targetYear: opts.fertilityTargetYear,
    },
    emissions: {
      base: base,
      startYear: opts.startYear,
      target: opts.emissionTarget != null ? opts.emissionTarget : scenarioTarget(scenario, base),
      targetYear: opts.emissionTargetYear != null ? opts.emissionTargetYear : 2100,
    },
  };
}

// Headline presets.
const PRESETS = {
  // 2008 paper, US female: 2005 TFR 2.05 -> UN medium 1.85 by 2050.
  paperUS: {
    label: '2008 paper — US female',
    startYear: 2005, e0: 80.4, co2: 20.18,
    tfr0: 2.05, fertilityTarget: 1.85, fertilityTargetYear: 2050,
    T: DEFAULT_T, fFemale: DEFAULT_FFEMALE,
  },
  // Current US: TFR ~1.60 (2024 all-time low), ~14 t CO2/person/yr (2023).
  usToday: {
    label: 'US today (2024 data)',
    startYear: 2024, e0: 81.1, co2: 14.0,
    tfr0: 1.60, fertilityTarget: 1.60, fertilityTargetYear: 2050,
    T: DEFAULT_T, fFemale: DEFAULT_FFEMALE,
  },
};

// ---- Marginal adult (founder) legacy ---------------------------------
// One marginal adult is generation-0 with full weight; their descendants carry
// the paper's (1/2)^n genetic-unit weighting. Legacy = own lifetime emissions + N * Δ,
// where N = completed fertility. Consistent with the rest of the page, this uses
// the paper's intentional shared-descendant double-counting (each birth attributed
// to this adult at 1/2 weight).
function marginalAdultLegacy(opts) {
  const p = buildParams(opts);
  const pc = perChildLegacy(p);
  const N = opts.completedFertility != null ? opts.completedFertility : opts.tfr0;
  return {
    diverges: pc.diverges,
    own: pc.ownLifetimeEmissions,
    perChild: pc.delta,
    descendants: pc.diverges ? Infinity : N * pc.delta,
    total: pc.diverges ? Infinity : pc.ownLifetimeEmissions + N * pc.delta,
    N: N,
  };
}

// ---- Immigration into the US: current (~2023) figures ----------------
// US side: an immigrant adult emits at the US per-capita rate and (initially)
// reproduces at their origin's fertility, with descendants assimilating toward
// the US native rate. Counterfactual ("stayed home"): home per-capita emissions
// and home fertility. The legacy increase from immigrating is overwhelmingly an
// emissions-intensity effect (moving to a higher per-capita economy), with
// fertility a secondary modifier. Sources: EIA/OWID per-capita CO2 2023; World
// Bank / national stats TFR 2023; CIS foreign-born US TFR 2.187 (2023).
const IMMIGRATION = {
  us: { co2: 13.83, e0: 79.0, nativeTFR: 1.66, foreignBornTFR: 2.19 },
  // longRunTFR: assimilation/convergence target for descendants (both sides).
  longRunTFR: 1.66,
  fertilityTargetYear: 2055,
  // The "average immigrant" comparison contrasts two real population averages, not
  // a personal counterfactual. US side: the average US foreign-born person —
  // measured TFR 2.19 (CIS 2023) and US emissions. Home side: the average person
  // in immigrants' origin countries — a population-weighted origin TFR of ~1.9 and
  // per-capita emissions of ~3.8 t/yr (Mexico dominates the foreign-born stock at
  // ~3.5 t, with a spread from Central America ~1.1 to China ~9.2 and Korea ~11.6).
  // We deliberately do NOT apply the 2.19 fertility to the home side, to avoid the
  // counterfactual of whether that premium would have existed back home.
  average: { homeCo2: 3.8, homeE0: 76.0, homeTFR: 1.9, usE0: 79.0, usTFR: 2.19 },
  origins: [
    { name: 'Mexico',      co2: 3.52,  tfr: 1.84, e0: 75.0 },
    { name: 'India',       co2: 2.07,  tfr: 1.98, e0: 70.0 },
    { name: 'China',       co2: 9.24,  tfr: 1.18, e0: 78.0 },
    { name: 'Philippines', co2: 1.40,  tfr: 1.92, e0: 70.0 },
    { name: 'Guatemala',   co2: 1.18,  tfr: 2.31, e0: 72.0 },
    { name: 'Vietnam',     co2: 3.29,  tfr: 1.91, e0: 74.0 },
    { name: 'Canada',      co2: 14.35, tfr: 1.26, e0: 82.0 },
  ],
};

function originByName(name) {
  return IMMIGRATION.origins.find((o) => o.name === name);
}

// Legacy of an immigrant adult vs the same person had they stayed home.
function immigrationComparison(originName, scenario) {
  scenario = scenario || 'constant';
  const o = originByName(originName);
  const startYear = 2024;
  // US side: emit at US rate, immigrant fertility (origin TFR) assimilating to native.
  const us = marginalAdultLegacy({
    startYear, e0: IMMIGRATION.us.e0, co2: IMMIGRATION.us.co2,
    tfr0: o.tfr, fertilityTarget: IMMIGRATION.longRunTFR,
    fertilityTargetYear: IMMIGRATION.fertilityTargetYear,
    scenario, completedFertility: o.tfr,
  });
  // Home side: emit at home rate, home fertility converging to the same long run.
  const home = marginalAdultLegacy({
    startYear, e0: o.e0, co2: o.co2,
    tfr0: o.tfr, fertilityTarget: IMMIGRATION.longRunTFR,
    fertilityTargetYear: IMMIGRATION.fertilityTargetYear,
    scenario, completedFertility: o.tfr,
  });
  return {
    origin: originName,
    us, home,
    increase: us.total - home.total,
    ratio: us.total / home.total,
  };
}

// Carbon-legacy gap between two real population averages: the average US
// foreign-born person (measured TFR 2.19, US emissions) and the average person
// in immigrants' origin countries (origin-weighted TFR ~1.9, ~3.8 t emissions).
// Each side keeps its own fertility — no personal counterfactual is imposed — so
// the gap reflects both the emissions-intensity jump and the higher fertility
// observed among the US foreign-born.
function averageImmigrantIncrease(scenario) {
  scenario = scenario || 'constant';
  const a = IMMIGRATION.average;
  const common = {
    startYear: 2024, fertilityTarget: IMMIGRATION.longRunTFR,
    fertilityTargetYear: IMMIGRATION.fertilityTargetYear, scenario,
  };
  const us = marginalAdultLegacy(Object.assign({}, common, {
    e0: a.usE0, co2: IMMIGRATION.us.co2, tfr0: a.usTFR, completedFertility: a.usTFR,
  }));
  const home = marginalAdultLegacy(Object.assign({}, common, {
    e0: a.homeE0, co2: a.homeCo2, tfr0: a.homeTFR, completedFertility: a.homeTFR,
  }));
  return { us, home, increase: us.total - home.total, ratio: us.total / home.total };
}

// Reference: a US native-born adult (native fertility) at US emissions. Compared
// with an immigrant at the same emissions, this isolates the fertility effect.
function nativeUsAdultLegacy(scenario) {
  scenario = scenario || 'constant';
  return marginalAdultLegacy({
    startYear: 2024, e0: IMMIGRATION.us.e0, co2: IMMIGRATION.us.co2,
    tfr0: IMMIGRATION.us.nativeTFR, fertilityTarget: IMMIGRATION.longRunTFR,
    fertilityTargetYear: IMMIGRATION.fertilityTargetYear,
    scenario, completedFertility: IMMIGRATION.us.nativeTFR,
  });
}

// ---- Lifestyle ranking (Wynes & Nicholas 2017, annual tCO2e/yr) -------
// Published developed-country values; the "one fewer child" headline (58.6) is a
// developed-country average. The page replaces that bar with the live model's
// per-child legacy annualized over the parent's life expectancy (Δ/e0), which
// reproduces the US-specific ~117 t/yr that W&N derived from Murtaugh & Schlax.
// Labels are third-person so each completes "One person who…"; tPerYear is the
// published annual saving (a reduction in the person's footprint).
const LIFESTYLE_ACTIONS = [
  { name: 'Live car-free',                      tPerYear: 2.4 },
  { name: 'Skip one transatlantic flight a year', tPerYear: 1.6 },
  { name: 'Buy green energy',                   tPerYear: 1.5 },
  { name: 'Switch from an electric car to car-free', tPerYear: 1.15 },
  { name: 'Switch to a plant-based diet',       tPerYear: 0.8 },
  { name: 'Drives a hybrid',                    tPerYear: 0.52 },
  { name: 'Washes clothes in cold water',       tPerYear: 0.25 },
  { name: 'Recycles',                           tPerYear: 0.21 },
  { name: 'Hang-dries laundry',                 tPerYear: 0.21 },
  { name: 'Upgrades to LED bulbs',              tPerYear: 0.10 },
];
const LIFESTYLE_CHILD_DEVELOPED_AVG = 58.6; // W&N headline, developed-country avg

// ---- LLM footprint context (grams CO2e per item) ----------------------
// One text LLM query is ~0.3 g CO2e centrally (2025 estimates span ~0.03 g for a
// median Google Gemini text prompt to ~3-4 g for older ChatGPT estimates).
// `perYear`/`rateLabel` give a deliberately generous use frequency so each per-use
// item can be annualized onto the same tCO2e/yr axis as the big life decisions —
// the LLM query stays the smallest thing on the page even at 100 prompts a day.
const LLM_QUERY_G = 0.3;
// Sorted least -> most (by per-item grams).
const LLM_COMPARISONS = [
  { name: '100 Google searches daily',     grams: 0.2,  perYear: 365 * 100, note: 'roughly comparable to a query' },
  { name: '100 LLM text queries daily',    grams: 0.3,  perYear: 365 * 100, note: 'central 2025 estimate (~0.03–3 g range)' },
  { name: '90 seconds of microwave daily', grams: 3.2,  perYear: 365 * 3,   note: '~1 kW, US grid ~0.39 kg/kWh' },
  { name: 'One handful of almonds daily',  grams: 122,  perYear: 365,       note: 'foodfootprint.nl (25 g)' },
  { name: 'One beef hamburger weekly',     grams: 3068, perYear: 52,        note: 'foodfootprint.nl' },
  { name: 'One gallon of gasoline weekly', grams: 8887, perYear: 52,        note: 'EPA' },
];

// ---- US historical series — for the "cost of a child over time" charts -----
// Indicative anchors, linearly interpolated — consistent with the page's
// "indicative replication" ethos, not an annual data ingest. TFR: CDC/NCHS &
// World Bank (US total fertility). co2: energy/fossil CO2 per capita (t/person/yr;
// EIA / Our World in Data). Known shape: TFR 3.65 (1960) -> ~1.74 (mid-1970s
// trough) -> ~2.05 (2005-08) -> 1.60 (2024); per-capita CO2 ~16 (1960) -> peak
// ~22-23 (early 1970s) -> ~20 (2005) -> ~14 (2023-24).
const US_HISTORY = [
  { year: 1960, tfr: 3.65, co2: 16.0 },
  { year: 1965, tfr: 2.91, co2: 18.4 },
  { year: 1970, tfr: 2.48, co2: 21.1 },
  { year: 1973, tfr: 1.88, co2: 22.5 },
  { year: 1976, tfr: 1.74, co2: 21.0 },
  { year: 1980, tfr: 1.84, co2: 20.6 },
  { year: 1985, tfr: 1.84, co2: 19.3 },
  { year: 1990, tfr: 2.08, co2: 19.4 },
  { year: 1995, tfr: 1.98, co2: 19.5 },
  { year: 2000, tfr: 2.06, co2: 20.4 },
  { year: 2005, tfr: 2.05, co2: 20.2 },
  { year: 2008, tfr: 2.07, co2: 19.9 },
  { year: 2010, tfr: 1.93, co2: 17.9 },
  { year: 2015, tfr: 1.84, co2: 16.5 },
  { year: 2020, tfr: 1.64, co2: 14.2 },
  { year: 2024, tfr: 1.60, co2: 14.0 },
];

// Linear interpolation of the historical series; clamps outside the range.
function usHistoryAt(year) {
  const a = US_HISTORY;
  if (year <= a[0].year) return { tfr: a[0].tfr, co2: a[0].co2 };
  const last = a[a.length - 1];
  if (year >= last.year) return { tfr: last.tfr, co2: last.co2 };
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i].year) {
      const lo = a[i - 1], hi = a[i];
      const f = (year - lo.year) / (hi.year - lo.year);
      return {
        tfr: lo.tfr + f * (hi.tfr - lo.tfr),
        co2: lo.co2 + f * (hi.co2 - lo.co2),
      };
    }
  }
  return { tfr: last.tfr, co2: last.co2 };
}

// Chart A — re-run the paper's reference (constant-emission) projection at each
// historical base year. For every year the per-child legacy uses that year's
// observed TFR and per-capita CO2, constant emissions, and fertility converging
// linearly to a long-run target over a FIXED horizon (45 yr, matching the paper's
// 2005->2050). Fixing the *duration* rather than a calendar end-year keeps every
// vintage convergent and comparable.
//
// The long-run target is min(this year's TFR, capTFR=1.85): high-fertility past
// vintages decline to the paper's UN-medium 1.85 (so the 2008 vintage reproduces
// the paper's headline), while recent already-below-1.85 vintages simply hold
// their current low level (so the 2024 vintage lands on the page's own "US today"
// number instead of contradicting it). The cap also guarantees a sub-replacement
// long run, so every vintage converges. Life expectancy is held at a
// representative modern US value so the curve reflects only the modelled scenario
// paths (fertility & emissions) — the two inputs the page treats as scenarios.
function historicalProjectedLegacy(opts) {
  opts = opts || {};
  const capTFR = opts.longRunTFR != null ? opts.longRunTFR : 1.85;
  const horizon = opts.horizon != null ? opts.horizon : 45;
  const e0 = opts.e0 != null ? opts.e0 : 80.4;
  const step = opts.step != null ? opts.step : 1;
  const y0 = US_HISTORY[0].year;
  const y1 = US_HISTORY[US_HISTORY.length - 1].year;
  const out = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    const h = usHistoryAt(y);
    const longRun = Math.min(h.tfr, capTFR);
    const p = buildParams({
      startYear: y, e0: e0, co2: h.co2, tfr0: h.tfr,
      fertilityTarget: longRun, fertilityTargetYear: y + horizon,
      scenario: 'constant',
    });
    const r = perChildLegacy(p);
    out.push({ year: y, delta: r.delta, diverges: r.diverges });
  }
  return out;
}

// Chart B — grade the 2008 projection against what actually happened. Both are
// 2008-vintage per-child legacies: "projected" uses the paper's reference inputs
// (constant 20.18 t, TFR 2.05->1.85 by 2050); "realized" replaces those with the
// observed decline expressed as a single linear segment to the 2024 observation,
// then flat (CO2 20.18->14, TFR 2.08->1.60 by 2024). Both are representable with
// the existing single-segment paths, so no path-engine change is needed.
function projectionBacktest(scenario) {
  scenario = scenario || 'constant';
  const projectedParams = buildParams({
    startYear: 2008, e0: 80.4, co2: 20.18, tfr0: 2.05,
    fertilityTarget: 1.85, fertilityTargetYear: 2050, scenario: scenario,
  });
  const realizedParams = buildParams({
    startYear: 2008, e0: 80.4, co2: 20.18, tfr0: 2.08,
    fertilityTarget: 1.60, fertilityTargetYear: 2024,
    emissionTarget: 14.0, emissionTargetYear: 2024,
  });
  const projected = perChildLegacy(projectedParams);
  const realized = perChildLegacy(realizedParams);
  const overstatementPct = (isFinite(projected.delta) && isFinite(realized.delta) && realized.delta > 0)
    ? (projected.delta / realized.delta - 1) * 100
    : null;
  return {
    projected: { delta: projected.delta, params: projectedParams },
    realized: { delta: realized.delta, params: realizedParams },
    overstatementPct: overstatementPct,
  };
}

const API = {
  makeSurvivor,
  lifeExpectancy,
  tfrAt,
  emissionAt,
  netReproduction,
  lifetimeEmissions,
  perChildLegacy,
  legacyForNChildren,
  gUnitsTrajectory,
  scenarioTarget,
  buildParams,
  marginalAdultLegacy,
  immigrationComparison,
  averageImmigrantIncrease,
  nativeUsAdultLegacy,
  US_HISTORY,
  usHistoryAt,
  historicalProjectedLegacy,
  projectionBacktest,
  COUNTRIES,
  PRESETS,
  IMMIGRATION,
  LIFESTYLE_ACTIONS,
  LIFESTYLE_CHILD_DEVELOPED_AVG,
  LLM_QUERY_G,
  LLM_COMPARISONS,
  DEFAULT_T,
  DEFAULT_FFEMALE,
  GM_A,
  GM_C,
  AGE_MAX,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.CarbonModel = API;
