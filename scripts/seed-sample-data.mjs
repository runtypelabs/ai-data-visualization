// Seed the "AI Data Visualization" sample dataset into an InsForge project.
// Usage:
//   INSFORGE_BASE_URL=https://your-app.insforge.app \
//   INSFORGE_ADMIN_KEY=ik_... \
//   node scripts/seed-sample-data.mjs
// (Legacy positional form also works: node seed-sample-data.mjs <baseUrl> <keyFile>)
// Idempotent: creates tables if missing, wipes demo-table rows, re-inserts.
//
// The dataset is a fictional industrial-operations business: 5 quarry/mine
// sites, 16 weeks of daily production, weekly targets, weekly materials
// consumption, per-job weekly costs, and a safety-event log. Every value is
// generated from pure formulas plus a keyed hash PRNG (no Math.random), so two
// runs with the same SEED_ANCHOR_DATE produce byte-identical data.
//
// Optional env:
//   SEED_ANCHOR_DATE=YYYY-MM-DD   pin "today" (default: the real current date).
//     History is laid out as 16 Monday-start weeks ending with the week that
//     contains the anchor; the final week is filled through the anchor day, so
//     partial-week pace questions ("what's behind target this week?") work.
//
// Story embedded in the numbers (see the digest the script prints at the end):
//   CRQ  incident   — steady ~100% of target for 13 weeks, then a conveyor
//                     gearbox failure: sharp V-shaped dip to ~76%, open
//                     high-severity safety event, cost per ton spikes.
//   BLC  declining  — slow erosion 104% -> ~89% while its target was raised,
//                     rising safety-event count, rising material intensity and
//                     cost per ton (margin compression).
//   HMS  improving  — 90% -> ~105% with a visible step at week 6 when a new
//                     crusher was commissioned; safety events trend down.
//   KLN  seasonal   — wave shape: peaks ~109%, wet-spell trough ~86% in weeks
//                     4-7 with a weather-driven safety cluster, then recovery.
//   SGV  steady     — user2's single entitled site, so its richness is internal:
//                     4 jobs, 5 materials, a week-9 liner-change dip and cost
//                     spike. Single-site users still get multi-series charts by
//                     job, customer, or material.
import { readFileSync } from 'node:fs'

const [argUrl, keyFile] = process.argv.slice(2)
const baseUrl = argUrl ?? process.env.INSFORGE_BASE_URL
const KEY = keyFile ? readFileSync(keyFile, 'utf8').trim() : process.env.INSFORGE_ADMIN_KEY
if (!baseUrl || !KEY) throw new Error('Set INSFORGE_BASE_URL and INSFORGE_ADMIN_KEY (or pass <baseUrl> <keyFile>)')
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function api(method, path, body, ok = [200, 201]) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!ok.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}
const sql = (query) => api('POST', '/api/database/advance/rawsql/unrestricted', { query })

// ---- schema ----------------------------------------------------------------
const col = (name, type, nullable = false, extra = {}) => ({ columnName: name, type, isNullable: nullable, isUnique: extra.unique ?? false })
const TABLES = {
  sites: [col('site_code', 'string', false, { unique: true }), col('name', 'string'), col('region', 'string'), col('avg_margin_per_ton', 'float')],
  site_managers: [col('name', 'string'), col('email', 'string'), col('site_code', 'string')],
  jobs: [col('job_code', 'string', false, { unique: true }), col('site_code', 'string'), col('customer', 'string'), col('status', 'string'), col('start_date', 'datetime')],
  production_targets: [col('site_code', 'string'), col('week_start', 'datetime'), col('target_tons', 'float')],
  production_actuals: [col('site_code', 'string'), col('prod_date', 'datetime'), col('tons', 'float'), col('job_code', 'string')],
  materials_usage: [col('site_code', 'string'), col('use_date', 'datetime'), col('material', 'string'), col('qty', 'float'), col('unit', 'string')],
  safety_events: [col('site_code', 'string'), col('event_date', 'datetime'), col('severity', 'string'), col('status', 'string'), col('description', 'string')],
  job_costs: [col('job_code', 'string'), col('site_code', 'string'), col('week_start', 'datetime'), col('cost_usd', 'float'), col('revenue_usd', 'float')],
}

// ---- deterministic noise ---------------------------------------------------
// FNV-1a over the joined key, then one mulberry32 round. Values depend only on
// their key, never on iteration order, so the dataset is stable under edits.
const SEED = 'ayb-industrial-v2'
const hash = (str) => {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}
const rand = (...parts) => {
  let t = (hash(`${SEED}|${parts.join('|')}`) + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const jitter = (amp, ...parts) => (rand(...parts) * 2 - 1) * amp
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const r1 = (v) => Math.round(v * 10) / 10
const pick = (list, ...parts) => list[Math.floor(rand(...parts) * list.length) % list.length]

// ---- calendar --------------------------------------------------------------
const toDate = (s) => new Date(`${s}T00:00:00Z`)
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const dowMon0 = (s) => (toDate(s).getUTCDay() + 6) % 7

const ANCHOR = process.env.SEED_ANCHOR_DATE ?? iso(new Date())
const WEEKS = 16
const CUR = WEEKS - 1 // index of the current, partially recorded week
const CURRENT_MONDAY = addDays(ANCHOR, -dowMon0(ANCHOR))
const DAYS_ELAPSED = dowMon0(ANCHOR) + 1 // Mon..anchor inclusive
const weekStart = (w) => addDays(CURRENT_MONDAY, -(CUR - w) * 7)
const daysInWeek = (w) => (w === CUR ? DAYS_ELAPSED : 7)

// Gentle weekday tilt (Sun lowest), normalized to sum to exactly 7 so a full
// week of daily rows sums to the intended weekly total. The tilt makes a
// partial Mon-Fri week read ~5% ahead of a flat target/7 pace, which is
// realistic and preserved in the current-week ranking below.
const RAW_DAY_SHAPE = [1.03, 1.05, 1.04, 1.03, 1.0, 0.92, 0.79]
const DAY_SHAPE_SUM = RAW_DAY_SHAPE.reduce((a, b) => a + b, 0)
const DAY_SHAPE = RAW_DAY_SHAPE.map((f) => (f * 7) / DAY_SHAPE_SUM)
// Share of a week's output already on the books in the current partial week.
// Materials and costs are scaled by it so per-ton ratios stay consistent with
// the production rows that exist — otherwise the current week reads as a fake
// cost and consumption spike.
const RECORDED_FRACTION = DAY_SHAPE.slice(0, DAYS_ELAPSED).reduce((a, b) => a + b, 0) / 7

// ---- sites -----------------------------------------------------------------
// Site codes and margins match scripts/setup-user-rls.mjs entitlements:
// demo user1 -> BLC, CRQ, HMS, KLN; demo user2 -> SGV.
const SITES = [
  ['CRQ', 'Cedar Ridge Quarry', 'North', 14.5, 'Dana Whitfield', 'bookernath+crq@gmail.com'],
  ['BLC', 'Bluff Creek Pit', 'North', 11.0, 'Marcus Ellery', 'bookernath+blc@gmail.com'],
  ['HMS', 'Harmon Summit Mine', 'West', 16.25, 'Priya Raghavan', 'bookernath+hms@gmail.com'],
  ['SGV', 'Sage Valley Quarry', 'West', 9.75, 'Tomas Herrera', 'bookernath+sgv@gmail.com'],
  ['KLN', 'Kiln Flats Pit', 'South', 12.4, 'June Okafor', 'bookernath+kln@gmail.com'],
]
const SITE_CODES = SITES.map(([code]) => code)
const MARGIN_PER_TON = Object.fromEntries(SITES.map(([code, , , m]) => [code, m]))

// Weekly target tons. Steps mid-history so "actual vs target" is not a flat
// reference line — BLC's target rises while its output falls.
const WEEKLY_TARGET = {
  CRQ: (w) => (w >= 8 ? 5400 : 5200),
  BLC: (w) => (w >= 10 ? 4000 : 3800),
  HMS: (w) => (w >= 6 ? 6100 : 5800),
  SGV: (w) => (w >= 8 ? 3100 : 2900),
  KLN: (w) => (w >= 12 ? 4500 : 4400),
}

const WET_WEEKS = new Set([4, 5, 6, 7]) // KLN storm spell

// actual / target for each historical week — this is where the story lives.
const PERF_CURVE = {
  CRQ: (w) => (w <= 12 ? 1.005 : w === 13 ? 1.02 : 0.9),
  BLC: (w) => 1.04 - 0.0093 * w,
  HMS: (w) => 0.9 + 0.006 * w + (w >= 6 ? 0.05 : 0),
  KLN: (w) => 1.02 + 0.07 * Math.sin((2 * Math.PI * (w + 2)) / 16) - (WET_WEEKS.has(w) ? 0.09 : 0),
  SGV: (w) => 1.0 + 0.05 * Math.sin((2 * Math.PI * w) / 12) - (w === 9 ? 0.12 : 0),
}
// Current-week ratios are pinned so the "what needs attention first?" answer has
// an unambiguous ranking once the weekday tilt is applied (pace ≈ ratio x 1.05):
// CRQ ~20% behind pace, BLC ~7% behind, KLN on pace, HMS/SGV ahead.
const CURRENT_WEEK_PERF = { CRQ: 0.76, BLC: 0.885, HMS: 1.045, KLN: 0.955, SGV: 0.99 }

const weekPerf = (site, w) => {
  const base = w === CUR ? CURRENT_WEEK_PERF[site] : PERF_CURVE[site](w)
  return clamp(base + jitter(0.022, 'perf', site, w), 0.55, 1.18)
}
const weekTons = (site, w) => WEEKLY_TARGET[site](w) * weekPerf(site, w)
// Tons actually recorded for the week — the basis for materials and costs.
const recordedTons = (site, w) => weekTons(site, w) * (w === CUR ? RECORDED_FRACTION : 1)

// ---- jobs ------------------------------------------------------------------
// Four overlapping jobs per site: two finished, two running. Most weeks have
// two active jobs, so production and costs break down by job as well as site.
const JOB_PLAN = [
  { n: 1, first: 0, last: 5, status: 'completed' },
  { n: 2, first: 3, last: 9, status: 'completed' },
  { n: 3, first: 7, last: CUR, status: 'active' },
  { n: 4, first: 11, last: CUR, status: 'active' },
]
const CUSTOMERS = {
  CRQ: ['Northgate Aggregates', 'Ridgeline Cement', 'Northgate Aggregates', 'Meridian Rail Ballast'],
  BLC: ['Ridgeline Cement', 'Delta Groundworks', 'Ridgeline Cement', 'Harbor Point Concrete'],
  HMS: ['Pacific Ballast Co', 'Summit Roadworks', 'Pacific Ballast Co', 'Cascade Infrastructure'],
  SGV: ['Summit Roadworks', 'Valley Ready-Mix', 'Summit Roadworks', 'Valley Ready-Mix'],
  KLN: ['Delta Groundworks', 'Kiln Flats Cement Works', 'Meridian Rail Ballast', 'Delta Groundworks'],
}
const jobCode = (site, n) => `J-${site}-${String(n).padStart(2, '0')}`
// The older job winds down while the newer one ramps, so job-level series cross.
const activeJobs = (w) => {
  const active = JOB_PLAN.filter((j) => w >= j.first && w <= j.last)
  const shares = active.length === 1 ? [1] : [0.6, 0.4]
  return active.map((job, i) => ({ ...job, share: shares[i] }))
}

// ---- materials -------------------------------------------------------------
const MATERIALS = [
  ['ANFO', 'kg', 0.42],
  ['Emulsion', 'kg', 0.18],
  ['Detonators', 'ea', 0.012],
  ['Diesel', 'L', 1.35],
  ['Drill Steel', 'm', 0.05],
]
// Consumption per ton drifts: BLC's rock hardens (cost story), HMS's new
// crusher is more efficient. Diesel spikes where a site runs workarounds.
const materialIntensity = (site, w, material) => {
  let f = 1
  if (site === 'BLC') f *= 1 + 0.25 * (w / CUR)
  if (site === 'HMS') f *= 1 - 0.12 * (w / CUR)
  if (site === 'CRQ' && w >= 14 && material === 'Diesel') f *= 1.4 // rental mobile crusher
  if (site === 'KLN' && WET_WEEKS.has(w) && material === 'Diesel') f *= 1.18 // pumping + haul road
  return f
}

// ---- costs -----------------------------------------------------------------
const REVENUE_PER_TON = { CRQ: 48, BLC: 41, HMS: 55, SGV: 38, KLN: 44 }
const costFactor = (site, w) => {
  if (site === 'BLC') return 1 + 0.08 * (w / CUR)
  if (site === 'HMS') return 1 - 0.06 * (w / CUR)
  if (site === 'CRQ' && w >= 14) return 1.22 // overtime + rental crusher
  if (site === 'KLN' && WET_WEEKS.has(w)) return 1.1
  if (site === 'SGV' && w === 9) return 1.18 // crusher liner change
  return 1
}

// ---- safety ----------------------------------------------------------------
const SAFETY_RATE = {
  CRQ: () => 0.32,
  BLC: (w) => 0.2 + 0.09 * w, // deteriorating
  HMS: (w) => Math.max(0.15, 1.4 - 0.075 * w), // improving
  KLN: (w) => 0.3 + (WET_WEEKS.has(w) ? 1.6 : 0),
  SGV: () => 0.25,
}
const DESCRIPTIONS = {
  low: [
    'Housekeeping finding on the crusher walkway; cleared the same shift',
    'Near-miss at the loadout ramp; spotter positioning corrected',
    'Minor hydraulic weep on an excavator boom; sealed on site',
    'PPE compliance coaching issued at the magazine entry',
    'Loose handrail section on the screen deck; re-welded',
    'Dust suppression sprays offline for one shift; restored',
  ],
  medium: [
    'Haul truck brake test failure; unit parked pending repair',
    'Unplanned movement of a drill rig on soft ground; area re-benched',
    'Blast exclusion-zone breach by a contractor vehicle; retraining issued',
    'Conveyor guard interlock fault found during inspection',
    'Fuel spill at the service bay, roughly 40 L contained and remediated',
  ],
  high: [
    'Highwall failure adjacent to an active bench; area evacuated and re-surveyed',
    'Primary crusher lockout gap identified during maintenance; work stopped',
    'Loaded haul truck rollaway on the ramp; no injuries, ramp regraded',
    'Misfire recovered from the blast pattern; secondary shot required',
  ],
}
// Pinned events: the narrative the analyst should surface, not left to chance.
const PINNED_EVENTS = [
  [
    'CRQ', CUR, 1, 'high', 'open',
    'Primary conveyor drive gearbox failure — main line down, rental mobile crusher bridging output at reduced rate',
  ],
  ['CRQ', CUR - 1, 5, 'medium', 'open', 'Conveyor guard interlock bypass found during a pre-shift inspection'],
  ['BLC', CUR, 0, 'medium', 'open', 'Highwall scaling debris in the haul road — repeat finding, third this month'],
  ['KLN', CUR - 1, 2, 'low', 'open', 'Standing water at the loadout ramp after the storm; pumped and re-signed'],
  ['HMS', CUR - 6, 3, 'high', 'closed', 'Crusher lockout procedure gap; corrected during commissioning of the new plant'],
]

// ---- build rows ------------------------------------------------------------
const build = () => {
  const sites = SITES.map(([site_code, name, region, avg_margin_per_ton]) => ({ site_code, name, region, avg_margin_per_ton }))
  const managers = SITES.map(([site_code, , , , name, email]) => ({ name, email, site_code }))

  const jobs = []
  for (const site of SITE_CODES) {
    for (const plan of JOB_PLAN) {
      jobs.push({
        job_code: jobCode(site, plan.n),
        site_code: site,
        customer: CUSTOMERS[site][plan.n - 1],
        status: plan.status,
        start_date: weekStart(plan.first),
      })
    }
  }
  // Two mobilizing jobs with no production yet, so status breakdowns have a
  // third category and the analyst can spot work that has not started.
  jobs.push(
    { job_code: jobCode('CRQ', 5), site_code: 'CRQ', customer: 'Meridian Rail Ballast', status: 'mobilizing', start_date: addDays(CURRENT_MONDAY, 7) },
    { job_code: jobCode('HMS', 5), site_code: 'HMS', customer: 'Cascade Infrastructure', status: 'mobilizing', start_date: addDays(CURRENT_MONDAY, 7) },
  )

  const targets = []
  const actuals = []
  const materials = []
  const costs = []
  const safety = []

  for (const site of SITE_CODES) {
    for (let w = 0; w < WEEKS; w++) {
      const ws = weekStart(w)
      const target = WEEKLY_TARGET[site](w)
      const tons = weekTons(site, w)
      const booked = recordedTons(site, w)
      targets.push({ site_code: site, week_start: ws, target_tons: target })

      const active = activeJobs(w)
      for (let d = 0; d < daysInWeek(w); d++) {
        const dayTons = (tons / 7) * DAY_SHAPE[d] * (1 + jitter(0.045, 'day', site, w, d))
        for (const job of active) {
          actuals.push({
            site_code: site,
            prod_date: addDays(ws, d),
            tons: r1(dayTons * job.share),
            job_code: jobCode(site, job.n),
          })
        }
      }

      for (const [material, unit, perTon] of MATERIALS) {
        const qty = booked * perTon * materialIntensity(site, w, material) * (1 + jitter(0.05, 'mat', site, w, material))
        materials.push({ site_code: site, use_date: ws, material, qty: r1(qty), unit })
      }

      const revPerTon = REVENUE_PER_TON[site]
      const costPerTon = (revPerTon - MARGIN_PER_TON[site]) * costFactor(site, w)
      for (const job of active) {
        const jobTons = booked * job.share
        costs.push({
          job_code: jobCode(site, job.n),
          site_code: site,
          week_start: ws,
          cost_usd: Math.round(jobTons * costPerTon * (1 + jitter(0.03, 'cost', site, w, job.n))),
          revenue_usd: Math.round(jobTons * revPerTon * (1 + jitter(0.02, 'rev', site, w, job.n))),
        })
      }

      const rate = SAFETY_RATE[site](w)
      const count = Math.min(4, Math.floor(rate) + (rand('safety-n', site, w) < rate % 1 ? 1 : 0))
      for (let k = 0; k < count; k++) {
        const sev = rand('sev', site, w, k) < 0.7 ? 'low' : rand('sev', site, w, k) < 0.92 ? 'medium' : 'high'
        const day = Math.min(daysInWeek(w) - 1, Math.floor(rand('sday', site, w, k) * 7))
        const status = w <= CUR - 3 || rand('sstat', site, w, k) < 0.55 ? 'closed' : 'open'
        safety.push({
          site_code: site,
          event_date: addDays(ws, day),
          severity: sev,
          status,
          description: pick(DESCRIPTIONS[sev], 'sdesc', site, w, k),
        })
      }
    }
  }

  for (const [site, w, day, severity, status, description] of PINNED_EVENTS) {
    safety.push({
      site_code: site,
      event_date: addDays(weekStart(w), Math.min(daysInWeek(w) - 1, day)),
      severity,
      status,
      description,
    })
  }

  return { sites, managers, jobs, targets, actuals, materials, costs, safety }
}

// ---- local digest ----------------------------------------------------------
// Printed after seeding so the embedded patterns are verifiable without DB
// access, and so a drifted story shows up immediately.
const printDigest = (data) => {
  console.log('\n--- pattern digest ---')
  const pct = (v) => `${(v * 100).toFixed(0)}%`
  for (const site of SITE_CODES) {
    const curve = [0, 3, 6, 9, 12, 14, CUR].map((w) => pct(weekPerf(site, w))).join(' -> ')
    const paceRatio = (weekPerf(site, CUR) * RECORDED_FRACTION * 7) / DAYS_ELAPSED
    const shortfallTons = (1 - paceRatio) * WEEKLY_TARGET[site](CUR) * (DAYS_ELAPSED / 7)
    const open = data.safety.filter((e) => e.site_code === site && e.status === 'open').length
    console.log(
      `  ${site}  weeks 0/3/6/9/12/14/now: ${curve}  | pace now ${pct(paceRatio)}` +
        ` (${shortfallTons >= 0 ? '-' : '+'}${Math.abs(Math.round(shortfallTons))} t,` +
        ` ${shortfallTons >= 0 ? '-' : '+'}$${Math.abs(Math.round(shortfallTons * MARGIN_PER_TON[site])).toLocaleString()} margin)` +
        `  | ${open} open safety event${open === 1 ? '' : 's'}`,
    )
  }
  const half = Math.floor(WEEKS / 2)
  const cutoff = weekStart(half)
  for (const site of SITE_CODES) {
    const early = data.safety.filter((e) => e.site_code === site && e.event_date < cutoff).length
    const late = data.safety.filter((e) => e.site_code === site && e.event_date >= cutoff).length
    console.log(`  ${site}  safety events: first ${half} weeks ${early} -> last ${WEEKS - half} weeks ${late}`)
  }
}

// ---- run -------------------------------------------------------------------
async function main() {
  console.log(`anchor ${ANCHOR} | weeks ${weekStart(0)} .. ${CURRENT_MONDAY} (current week filled through day ${DAYS_ELAPSED} of 7)`)

  const existing = await api('GET', '/api/database/tables')
  for (const [name, columns] of Object.entries(TABLES)) {
    if (existing.includes(name)) { console.log(`table ${name}: exists`) }
    else { await api('POST', '/api/database/tables', { tableName: name, columns }); console.log(`table ${name}: created`) }
  }
  for (const name of Object.keys(TABLES)) await sql(`DELETE FROM ${name}`)
  console.log('rows wiped')

  const data = build()
  // The records endpoint takes an array; chunk so a 900-row table is a handful
  // of requests rather than one oversized body.
  const ins = async (table, rows, chunk = 250) => {
    for (let i = 0; i < rows.length; i += chunk) {
      await api('POST', `/api/database/records/${table}`, rows.slice(i, i + chunk))
    }
    console.log(`  ${table}: ${rows.length} rows`)
  }
  await ins('sites', data.sites)
  await ins('site_managers', data.managers)
  await ins('jobs', data.jobs)
  await ins('production_targets', data.targets)
  await ins('production_actuals', data.actuals)
  await ins('materials_usage', data.materials)
  await ins('safety_events', data.safety)
  await ins('job_costs', data.costs)
  console.log('rows inserted')

  printDigest(data)

  console.log('\n--- database checks ---')
  const counts = await sql(
    Object.keys(TABLES)
      .map((t) => `SELECT '${t}' AS table_name, COUNT(*) AS row_count FROM ${t}`)
      .join(' UNION ALL '),
  )
  console.log('row counts:', JSON.stringify(counts.rows ?? counts))

  const trend = await sql(`
    SELECT t.week_start, t.site_code, ROUND(SUM(a.tons)) AS actual_tons, t.target_tons
    FROM production_targets t
    JOIN production_actuals a
      ON a.site_code = t.site_code
     AND a.prod_date >= t.week_start
     AND a.prod_date < t.week_start + INTERVAL '7 days'
    WHERE t.week_start >= '${weekStart(WEEKS - 12)}'
    GROUP BY t.week_start, t.site_code, t.target_tons
    ORDER BY t.week_start, t.site_code`)
  const trendRows = trend.rows ?? trend
  console.log(`12-week weekly actual-vs-target series: ${trendRows.length} rows (expect 60 = 12 weeks x 5 sites)`)

  const pace = await sql(`
    SELECT a.site_code,
           ROUND(SUM(a.tons)) AS tons_to_date,
           ROUND(MAX(t.target_tons) * ${DAYS_ELAPSED} / 7.0) AS pace_target,
           ROUND(100.0 * SUM(a.tons) / (MAX(t.target_tons) * ${DAYS_ELAPSED} / 7.0)) AS pct_of_pace
    FROM production_actuals a
    JOIN production_targets t ON t.site_code = a.site_code AND t.week_start = '${CURRENT_MONDAY}'
    WHERE a.prod_date >= '${CURRENT_MONDAY}'
    GROUP BY a.site_code
    ORDER BY pct_of_pace`)
  console.log('this-week pace:', JSON.stringify(pace.rows ?? pace))
}
main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1) })
