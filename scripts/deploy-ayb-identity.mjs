// Deploy the ayb-identity token-bridge function to an InsForge project.
//
// Usage:
//   INSFORGE_BASE_URL=https://your-app.insforge.app \
//   INSFORGE_ADMIN_KEY=ik_... \
//   node scripts/deploy-ayb-identity.mjs
//
// What it does:
//   1. Creates the ayb_bridge_signing_keys table (idempotent) with RLS enabled
//      and no policies/grants, so only the admin plane (and the function's own
//      project API key) can reach the private key.
//   2. Creates or updates the `ayb-identity` edge function from
//      functions/ayb-identity.mjs.
//   3. Smoke-tests: GET ?jwks=1 serves a JWKS (provisions the key on first
//      call), and POST with a garbage token is rejected with 401.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.INSFORGE_BASE_URL
const KEY = process.env.INSFORGE_ADMIN_KEY
if (!BASE || !KEY) throw new Error('Set INSFORGE_BASE_URL and INSFORGE_ADMIN_KEY')

const here = dirname(fileURLToPath(import.meta.url))
const SLUG = 'ayb-identity'
const code = readFileSync(join(here, '..', 'insforge', 'functions', 'ayb-identity.mjs'), 'utf8')

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

// 1. Signing-key table: RLS on, zero policies, zero grants -> admin-plane only.
// One statement per call: the rawsql endpoint is not guaranteed to accept
// multi-statement bodies.
for (const query of [
  `CREATE TABLE IF NOT EXISTS ayb_bridge_signing_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kid text NOT NULL UNIQUE,
    private_jwk jsonb NOT NULL,
    public_jwk jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  'ALTER TABLE ayb_bridge_signing_keys ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON ayb_bridge_signing_keys FROM anon, authenticated',
]) {
  await api('POST', '/api/database/advance/rawsql/unrestricted', { query })
}
console.log('ayb_bridge_signing_keys table ready (RLS deny-all for non-admin)')

// 2. Create or update the function.
const payload = {
  name: 'AYB identity token bridge',
  slug: SLUG,
  description:
    'Verifies a native InsForge user JWT (RS256, project JWKS) and re-mints a short-lived ES256 JWT with pinned iss/aud for Runtype Identity Exchange. GET ?jwks=1 serves the bridge JWKS.',
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

// 3. Smoke tests (no real user token needed).
const jwksRes = await fetch(`${BASE}/functions/${SLUG}?jwks=1`)
const jwks = await jwksRes.json()
if (!jwksRes.ok || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
  throw new Error(`jwks smoke test failed: ${jwksRes.status} ${JSON.stringify(jwks).slice(0, 200)}`)
}
const jwkAlgOk = jwks.keys.every((k) => k.kty === 'EC' && k.alg === 'ES256' && k.kid)
if (!jwkAlgOk) throw new Error(`jwks smoke test: unexpected key shape ${JSON.stringify(jwks.keys)}`)
console.log(`jwks smoke test OK (${jwks.keys.length} ES256 key(s))`)

const badToken = await fetch(`${BASE}/functions/${SLUG}`, {
  method: 'POST',
  headers: { Authorization: 'Bearer not-a-real-token' },
})
if (badToken.status !== 401) {
  throw new Error(`negative smoke test failed: expected 401, got ${badToken.status}`)
}
console.log('negative smoke test OK (garbage token -> 401)')

console.log(`\nayb-identity is live at ${BASE}/functions/${SLUG}`)
console.log(`  issuer:   ${BASE}/functions/${SLUG}`)
console.log(`  jwks:     ${BASE}/functions/${SLUG}?jwks=1`)
console.log(`  audience: runtype-ayb`)
