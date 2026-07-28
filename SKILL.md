---
name: ai-data-visualization-setup
description: Set up the AI Data Visualization analytics agent end to end - seed or connect an InsForge Postgres database, deploy the chart renderer and analyst web app as InsForge edge functions, import the Runtype template, and wire the chat embed. Use when the user wants to install, deploy, or demo AI Data Visualization on their InsForge project.
---

# AI Data Visualization setup

You are setting up AI Data Visualization: a Runtype analytics agent over the user's InsForge Postgres database, with an embeddable analyst web app and chart images served from their InsForge project. Work through the steps in order; each is idempotent and safe to re-run.

## What you need from the user

1. Their InsForge project base URL (`https://<app>.insforge.app`) and an admin API key. Never echo the key; read it from an environment variable or a file.
2. A Runtype account (they will import the template and fill one secret in the Runtype dashboard; the secret value never passes through you).
3. Whether to seed the fictional sample dataset or point the agents at their existing tables.

## Steps

1. **Sample data** (only if they want the demo dataset):
   `INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/seed-sample-data.mjs`
   Creates 8 tables of fictional industrial-operations data. Skip entirely for a real database.

2. **Chart renderer**:
   `INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/deploy-flint-render.mjs`
   Creates the `flint_charts` table, deploys the `flint-render` edge function, and smoke-tests a PNG render. (InsForge CLI equivalent: `insforge functions deploy flint-render --file insforge/functions/flint-render.mjs`, plus the CREATE TABLE from the script.)

3. **Runtype config**: restore [`runtype.config.json`](./runtype.config.json) into the user's Runtype account with the CLI: `runtype auth login`, then `runtype products init --from https://raw.githubusercontent.com/runtypelabs/ai-data-visualization/main/runtype.config.json` (the dashboard template importer and MCP work too). Template variables: set `insforgeBaseUrl` to their project URL; for a real database, rewrite `businessContext` to describe their business and definitions. Then the user fills the `INSFORGE_API_KEY` pending secret in Runtype's secret intake screen; recommend a read-only key, and do not handle the value yourself.

4. **Chat embed wiring** (Runtype side, via dashboard/CLI/MCP):
   - Create a client token for the Business Analyst agent, bound to the chat surface (`product_surface_id` — required for the page's chart tool to be admitted), with `https://<app>.insforge.app` in `allowedOrigins`.
   - Set the chat surface behavior: `webmcp: { enabled: true, allowlist: [{ origin: "https://<app>.insforge.app", tools: ["create_flint_chart"] }] }`.

5. **End-user auth + per-user data** (optional; ask the user if they want signed-in, per-user isolation — skip to step 6 for the shared-analyst mode):
   - `INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/setup-user-rls.mjs` — creates the read-only `run_analyst_sql` RPC, the `ayb_site_access` entitlement table, and RLS policies scoping every sample table per user.
   - `INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/deploy-ayb-identity.mjs` — deploys the identity token bridge (native RS256 JWT in, ES256 `identityProof` with pinned iss/aud out, JWKS at `?jwks=1`).
   - Register the bridge as a Runtype Identity Exchange integration: `POST /v1/identity-integrations` with `kind: oidc-jwt`, `issuer` = the bridge URL, `jwksUri` = bridge URL + `?jwks=1`, `audience: runtype-ayb`, `allowedAlgorithms: ["ES256"]`, `claimMap: {subject: "sub", email: "email"}` (REST only; no MCP tool).
   - Lock the analyst: set agent `config.tenancyStrategy = { preset: "end-user-isolated" }`, REMOVE the admin `insforge_run_sql` saved tool from its toolIds (the shell replaces it with a per-user page tool; toolIds updates replace the whole array, so pass the complete remaining set), and add `insforge_run_sql` to the surface's WebMCP allowlist tools next to `create_flint_chart`. The monitor agent keeps the admin tool (org-level watchdog).
   - Identity-proof admission is enabled per Runtype account. If a valid proof still yields a 403 tenancy refusal, admission is not enabled for the account yet — that must be flipped by Runtype (feature flag `enable-identity-exchange-admission`), not worked around.
   - InsForge auth config: email verification defaults on. For demo users, create them via `POST /api/auth/users` and mark verified via admin rawsql, or disable verification in the auth config.

6. **Analyst web app**:
   `INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... RUNTYPE_CLIENT_TOKEN=ct_live_... node scripts/deploy-shell.mjs`
   With auth (step 5), also pass `INSFORGE_ANON_KEY=anon_...` (enables the sign-in card; omitting it deploys the original no-sign-in mode) and optionally `DEMO_ACCOUNTS='[{"email":"...","password":"...","label":"..."}]'` (sample datasets only — visible to every visitor). For a real database add `SAMPLE_DATASET=false` and `STARTER_PROMPTS='["<question 1>","<question 2>"]'` with questions that fit their schema.

7. **Verify**: open `https://<app>.insforge.app/functions/ai-data-visualization`, run a starter prompt, and confirm: the tool checklist shows live SQL, an interactive chart artifact opens with Chart/Table/SQL tabs, and the final answer includes the SQL appendix. Then, on the Slack surface, ask the same question and confirm the reply carries a chart image served from `/functions/flint-render?id=...`. With auth enabled, additionally confirm: the sign-in card gates the workspace until a demo account signs in; two different demo users get different site subsets from the same question; and each user's analysis snapshots are invisible to the other.

## Notes

- The prebuilt `insforge/shell/dist/index.html` is generic; `deploy-shell.mjs` injects the per-project config. Only rebuild (`cd insforge/shell && npm install && npm run build`) if they change the app itself.
- `flint-render` is a public endpoint; for production suggest adding a shared-secret check or rate limit.
- The monitor agent's SQL path is prompt-constrained to SELECT-only; the InsForge key's permissions are the hard boundary there. Always prefer a read-only key. The signed-in analyst path is harder: `run_analyst_sql` enforces read-only single-statement SELECT with a timeout, and Postgres RLS is the row boundary.
- The bridge exists because native InsForge JWTs carry no `iss`/`aud` (which Runtype's verifier requires, fail-closed). Third-party-auth-bridged InsForge tokens (Clerk etc.) are HS256 and cannot be verified via JWKS at all — the bridge only accepts native RS256 tokens.
