// Deploy the AI Data Visualization web app as an InsForge edge function.
//
// Usage:
//   INSFORGE_BASE_URL=https://your-app.insforge.app \
//   INSFORGE_ADMIN_KEY=ik_... \
//   RUNTYPE_CLIENT_TOKEN=ct_live_... \
//   node scripts/deploy-shell.mjs
//
// Optional env:
//   RUNTYPE_API_URL     (default https://api.runtype.com)
//   PRODUCT_NAME        (default "AI Data Visualization")
//   SAMPLE_DATASET      (default true; set to "false" for a real database)
//   STARTER_PROMPTS     (JSON array of suggestion strings)
//   SHELL_SLUG          (default "ai-data-visualization")
//   INSFORGE_ANON_KEY   (anon/publishable key; enables end-user sign-in +
//                        per-user RLS SQL when present)
//   DEMO_ACCOUNTS       (JSON array of {email, password, label?} surfaced as
//                        one-click demo logins on the sign-in card)
//
// The shell bundle itself is generic; this script injects the per-project
// runtime config as window.__AYB_CONFIG__ into the served HTML.
//
// Prerequisites on the Runtype side (dashboard, MCP, or CLI):
//   - Import the AI Data Visualization template and fill INSFORGE_API_KEY.
//   - Create a client token bound to the chat surface (product_surface_id),
//     with this function's origin in allowedOrigins.
//   - Enable WebMCP on the chat surface for this origin with
//     insforge_run_sql, insforge_query_and_chart, and create_flint_chart.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.INSFORGE_BASE_URL
const KEY = process.env.INSFORGE_ADMIN_KEY
const CLIENT_TOKEN = process.env.RUNTYPE_CLIENT_TOKEN
if (!BASE || !KEY || !CLIENT_TOKEN) {
  throw new Error('Set INSFORGE_BASE_URL, INSFORGE_ADMIN_KEY, and RUNTYPE_CLIENT_TOKEN')
}

const here = dirname(fileURLToPath(import.meta.url))
const SLUG = process.env.SHELL_SLUG ?? 'ai-data-visualization'
const html = readFileSync(join(here, '..', 'insforge', 'shell', 'dist', 'index.html'), 'utf8')

const config = {
  apiUrl: process.env.RUNTYPE_API_URL ?? 'https://api.runtype.com',
  clientToken: CLIENT_TOKEN,
  insforgeBaseUrl: BASE,
  productName: process.env.PRODUCT_NAME ?? 'AI Data Visualization',
  sampleDataset: process.env.SAMPLE_DATASET !== 'false',
  ...(process.env.INSFORGE_ANON_KEY ? { insforgeAnonKey: process.env.INSFORGE_ANON_KEY } : {}),
  ...(process.env.DEMO_ACCOUNTS ? { demoAccounts: JSON.parse(process.env.DEMO_ACCOUNTS) } : {}),
  ...(process.env.STARTER_PROMPTS
    ? { starterPrompts: JSON.parse(process.env.STARTER_PROMPTS) }
    : {}),
}

const configScript = `<script>window.__AYB_CONFIG__ = ${JSON.stringify(config)};</script>`
const configuredHtml = html.replace('<head>', `<head>\n    ${configScript}`)
if (!configuredHtml.includes('__AYB_CONFIG__')) throw new Error('config injection failed')

const code = `const HTML = ${JSON.stringify(configuredHtml)};

export default async function handler(request) {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
`

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const created = await fetch(`${BASE}/api/functions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: config.productName,
    slug: SLUG,
    description: 'AI Data Visualization analyst web app (Persona fullscreen shell with Flint charts).',
    status: 'active',
    code,
  }),
})
if (created.status === 409) {
  const updated = await fetch(`${BASE}/api/functions/${SLUG}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ code, status: 'active' }),
  })
  if (!updated.ok) {
    throw new Error(`update -> ${updated.status}: ${(await updated.text()).slice(0, 300)}`)
  }
  console.log(`function ${SLUG} updated`)
} else if (created.ok) {
  console.log(`function ${SLUG} created`)
} else {
  throw new Error(`create -> ${created.status}: ${(await created.text()).slice(0, 300)}`)
}

const check = await fetch(`${BASE}/functions/${SLUG}`)
console.log(`GET /functions/${SLUG} -> ${check.status} (${(await check.text()).length} bytes)`)
console.log(`\nYour analyst is live at ${BASE}/functions/${SLUG}`)
console.log(
  'Reminder: the Runtype client token must allow this origin, and the chat surface must allow the shell WebMCP tools (insforge_run_sql, insforge_query_and_chart, create_flint_chart).',
)
