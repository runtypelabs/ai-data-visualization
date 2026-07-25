// Set up per-user Row Level Security + the analyst SQL RPC on an InsForge project.
//
// Usage:
//   INSFORGE_BASE_URL=https://your-app.insforge.app \
//   INSFORGE_ADMIN_KEY=ik_... \
//   [DEMO_USER1_ID=<uuid> DEMO_USER2_ID=<uuid>] \
//   node scripts/setup-user-rls.mjs
//
// What it does (idempotent — safe to re-run; re-running changes nothing):
//   1. Creates public.run_analyst_sql(query text) — SECURITY INVOKER, so RLS
//      applies to the CALLER. Validates a single read-only statement, then runs
//      it and aggregates to jsonb. Bound read-only + 8s timeout via ALTER
//      FUNCTION. Execute granted to `authenticated` only.
//   2. Creates public.ayb_site_access(user_id, site_code) — the per-user
//      entitlement table. RLS on; users may read only their own rows; writes are
//      admin-plane only (no INSERT/UPDATE/DELETE grant to authenticated).
//   3. For each sample table: revokes writes from `authenticated`, revokes all
//      from `anon`, grants SELECT to `authenticated`, and (re)creates the
//      `ayb_site_scope` SELECT policy that scopes rows to the sites the caller is
//      entitled to (via ayb_site_access, keyed on site_code).
//   4. Optional: when DEMO_USER1_ID / DEMO_USER2_ID are set, seeds demo
//      entitlements (user1 -> BLC,CRQ,HMS,KLN; user2 -> SGV).
//
// The analyst agent calls the RPC as the signed-in user:
//   POST /api/database/rpc/run_analyst_sql  Authorization: Bearer <user JWT>
//   { "query": "select ..." }  ->  JSON array (rows the user is entitled to)

const BASE = process.env.INSFORGE_BASE_URL
const KEY = process.env.INSFORGE_ADMIN_KEY
if (!BASE || !KEY) throw new Error('Set INSFORGE_BASE_URL and INSFORGE_ADMIN_KEY')

// The 8 industrial sample tables. All link to a site by the text column
// `site_code` (sites.site_code is UNIQUE; the others reference it by value).
const SAMPLE_TABLES = [
  'sites',
  'site_managers',
  'jobs',
  'production_targets',
  'production_actuals',
  'materials_usage',
  'safety_events',
  'job_costs',
]

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// One statement per call: the rawsql endpoint is not guaranteed to accept
// multi-statement bodies. Params use PostgREST/pg `$1` placeholders.
const sql = async (query, params = []) => {
  const res = await fetch(`${BASE}/api/database/advance/rawsql/unrestricted`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, params }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`rawsql -> ${res.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// 1. Analyst SQL RPC. SECURITY INVOKER => runs as the caller's role, so RLS on
//    the sample tables applies. Guards (defense in depth; RLS + the ALTER
//    FUNCTION read-only binding are the real guarantees):
//      - reject semicolons (single statement only)
//      - must start with SELECT or WITH
//      - keyword blacklist using Postgres `\y` word boundaries (NOT `\b`, which
//        is a backspace char in Postgres regex and would silently never match)
const CREATE_ANALYST_FN = String.raw`
create or replace function public.run_analyst_sql(query text)
returns jsonb
language plpgsql
security invoker
as $fn$
declare
  result jsonb;
  q text := btrim(query);
begin
  if q ~ ';' then
    raise exception 'Only a single statement is allowed (no semicolons)';
  end if;
  if lower(q) !~ '^\s*(with|select)\y' then
    raise exception 'Only SELECT/WITH queries are allowed';
  end if;
  if lower(q) ~ '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|merge|vacuum|analyze|reindex|comment|do|execute|set|reset|lock|prepare|listen|notify)\y' then
    raise exception 'Query contains a disallowed keyword';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', q) into result;
  return result;
end;
$fn$;
`

const analystStatements = [
  CREATE_ANALYST_FN,
  // Bind read-only + a bounded runtime at the function level. The rawsql
  // endpoint blocks runtime SET/set_config, so we pin these via ALTER FUNCTION;
  // every call then runs with them applied.
  `alter function public.run_analyst_sql(text) set statement_timeout = 8000`,
  `alter function public.run_analyst_sql(text) set transaction_read_only = on`,
  `revoke all on function public.run_analyst_sql(text) from public`,
  `revoke all on function public.run_analyst_sql(text) from anon`,
  `grant execute on function public.run_analyst_sql(text) to authenticated`,
]
for (const q of analystStatements) await sql(q)
console.log('run_analyst_sql ready (SECURITY INVOKER, read-only, 8s timeout, authenticated-only)')

// 2. Per-user entitlement table. Admin-managed; RLS lets a user read only their
//    own access rows. No write grant to authenticated => writes are admin-only.
const accessStatements = [
  `create table if not exists public.ayb_site_access (
     user_id uuid not null,
     site_code text not null,
     primary key (user_id, site_code)
   )`,
  `alter table public.ayb_site_access enable row level security`,
  `drop policy if exists own_access on public.ayb_site_access`,
  `create policy own_access on public.ayb_site_access
     for select to authenticated using (user_id = auth.uid())`,
  `revoke all on public.ayb_site_access from public`,
  `revoke all on public.ayb_site_access from anon`,
  `grant select on public.ayb_site_access to authenticated`,
]
for (const q of accessStatements) await sql(q)
console.log('ayb_site_access ready (RLS on, read-own, writes admin-only)')

// 3. Lock down + scope each sample table. SELECT-only for authenticated; anon
//    gets nothing; rows are scoped to the caller's entitled sites via
//    ayb_site_access. auth.uid() = nullif(auth.jwt()->>'sub','')::uuid.
for (const t of SAMPLE_TABLES) {
  const statements = [
    `alter table public.${t} enable row level security`,
    `revoke insert, update, delete on public.${t} from authenticated`,
    `revoke all on public.${t} from anon`,
    `grant select on public.${t} to authenticated`,
    `drop policy if exists ayb_site_scope on public.${t}`,
    `create policy ayb_site_scope on public.${t}
       for select to authenticated
       using (exists (
         select 1 from public.ayb_site_access a
         where a.user_id = auth.uid() and a.site_code = ${t}.site_code
       ))`,
  ]
  for (const q of statements) await sql(q)
  console.log(`  ${t}: SELECT-only + ayb_site_scope policy applied`)
}

// 4. Optional demo entitlements (only when the user ids are supplied).
const DEMO_ASSIGNMENTS = [
  [process.env.DEMO_USER1_ID, ['BLC', 'CRQ', 'HMS', 'KLN']],
  [process.env.DEMO_USER2_ID, ['SGV']],
]
let seeded = 0
for (const [userId, sites] of DEMO_ASSIGNMENTS) {
  if (!userId) continue
  for (const site of sites) {
    await sql(
      `insert into public.ayb_site_access (user_id, site_code)
       values ($1, $2) on conflict do nothing`,
      [userId, site],
    )
    seeded++
  }
}
if (seeded) console.log(`demo entitlements upserted (${seeded} rows, on-conflict-do-nothing)`)
else console.log('demo entitlements skipped (set DEMO_USER1_ID / DEMO_USER2_ID to seed)')

// 5. Summary — the live state after this run (also proves idempotency: a re-run
//    prints the same numbers).
const fn = await sql(
  `select proname, proconfig from pg_proc where proname = 'run_analyst_sql'`,
)
const policies = await sql(
  `select tablename, count(*) n from pg_policies
     where schemaname = 'public' and policyname = 'ayb_site_scope'
     group by tablename order by tablename`,
)
const access = await sql(
  `select user_id, string_agg(site_code, ',' order by site_code) sites
     from public.ayb_site_access group by user_id order by user_id`,
)
console.log('\n--- summary ---')
console.log(
  `run_analyst_sql: ${fn.rows?.length ? 'present' : 'MISSING'} ` +
    `[${(fn.rows?.[0]?.proconfig ?? []).join(', ')}]`,
)
console.log(`ayb_site_scope policies: ${policies.rows?.length ?? 0}/${SAMPLE_TABLES.length} tables`)
for (const row of access.rows ?? []) console.log(`  ${row.user_id} -> ${row.sites}`)
console.log('\nper-user RLS setup complete.')
