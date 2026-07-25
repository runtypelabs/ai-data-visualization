// Deploy the flint-render chart-image function to an InsForge project.
//
// Usage:
//   INSFORGE_BASE_URL=https://your-app.insforge.app \
//   INSFORGE_ADMIN_KEY=ik_... \
//   node scripts/deploy-flint-render.mjs
//
// What it does:
//   1. Creates the flint_charts spec-storage table (idempotent).
//   2. Creates or updates the `flint-render` edge function from
//      functions/flint-render.mjs.
//   3. Smoke-tests the deployed endpoint: POST a sample spec, GET the PNG.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.INSFORGE_BASE_URL
const KEY = process.env.INSFORGE_ADMIN_KEY
if (!BASE || !KEY) throw new Error('Set INSFORGE_BASE_URL and INSFORGE_ADMIN_KEY')

const here = dirname(fileURLToPath(import.meta.url))
const SLUG = process.env.FLINT_RENDER_SLUG ?? 'flint-render'
const code = readFileSync(join(here, '..', 'insforge', 'functions', 'flint-render.mjs'), 'utf8')

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const api = async (method, path, body, ok = [200, 201]) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!ok.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// 1. Spec-storage table (the function reads/writes it via its project API key).
await api('POST', '/api/database/advance/rawsql/unrestricted', {
  query: `CREATE TABLE IF NOT EXISTS flint_charts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text,
    input jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
})
console.log('flint_charts table ready')

// 2. Create or update the function.
const payload = {
  name: 'Flint chart renderer',
  slug: SLUG,
  description:
    'Renders Flint ChartAssemblyInput specs to PNG images (echarts SSR + resvg). POST stores a spec and returns {id, url}; GET ?id= serves the PNG.',
  status: 'active',
  code,
}
const created = await fetch(`${BASE}/api/functions`, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
})
if (created.status === 409) {
  await api('PUT', `/api/functions/${SLUG}`, { code, status: 'active' })
  console.log(`function ${SLUG} updated`)
} else if (created.ok) {
  console.log(`function ${SLUG} created`)
} else {
  throw new Error(`create function -> ${created.status}: ${(await created.text()).slice(0, 300)}`)
}

// 3. Smoke test.
const sample = {
  title: 'Deploy smoke test',
  chartType: 'Bar Chart',
  encodings: { x: 'label', y: 'value' },
  semanticTypes: { label: 'Category', value: 'Quantity' },
  rows: [
    { label: 'A', value: 3 },
    { label: 'B', value: 5 },
  ],
}
const stored = await api('POST', `/functions/${SLUG}`, sample)
const png = await fetch(stored.url)
const bytes = new Uint8Array(await png.arrayBuffer())
const isPng = png.ok && bytes[0] === 0x89 && bytes[1] === 0x50
if (!isPng) throw new Error(`smoke test failed: GET ${stored.url} -> ${png.status}`)
console.log(`smoke test OK: ${stored.url} (${bytes.length} bytes)`)
console.log(`\nflint-render is live at ${BASE}/functions/${SLUG}`)
