# AI Data Visualization — InsForge implementation

The supporting app half of [AI Data Visualization](../README.md). The product itself is composed in [`runtype.config.json`](../runtype.config.json); this directory carries everything that lives on **your InsForge project**:

| Piece | What it is |
| --- | --- |
| `shell/` | The analyst web app: a [Persona](https://github.com/runtypelabs/persona) fullscreen assistant with interactive [Flint](https://www.npmjs.com/package/flint-chart) chart artifacts, served as an InsForge edge function. One prebuilt, secret-free bundle (`shell/dist/index.html`); per-project config is injected at deploy time. |
| `functions/flint-render.mjs` | An edge function that renders Flint chart specs to hosted PNG images (ECharts SSR + resvg). This is how Slack replies and scheduled runs carry real charts on surfaces that can't run the interactive widget. |
| `functions/ayb-identity.mjs` | The identity token bridge: verifies a native InsForge user JWT (RS256, project JWKS) and re-mints a short-lived ES256 JWT with pinned `iss`/`aud` that Runtype's Identity Exchange can verify. Serves its own JWKS at `?jwks=1`. |
| `migrations/` | The sample dataset schema. |
| `../scripts/seed-sample-data.mjs` | Idempotent seeder for the fictional industrial-operations sample dataset (8 tables) the demo runs on. Skip it to point the agents at your own data. |
| `../scripts/setup-user-rls.mjs` | Idempotent per-user data-access setup: the `run_analyst_sql` RPC (read-only, SECURITY INVOKER), the `ayb_site_access` entitlement table, and row-level-security policies scoping every sample table to the signed-in user's sites. |
| `../scripts/deploy-*.mjs` | Zero-dependency deploy scripts (Node 18+) for the functions and the shell. |

## Request flow

```
you ──▶ https://<your-app>.insforge.app/functions/ai-data-visualization   (shell/)
             │  InsForge sign-in (email/password, anon key)
             │  native RS256 JWT ──▶ /functions/ayb-identity ──▶ ES256 identityProof
             │  Persona chat (Runtype client token + identityProof)
             ▼
        Runtype API ── verifies proof, runs agent AS the end user  (runtype.config.json)
             │   insforge_run_sql (page tool) ──▶ schema or RLS-scoped SQL
             │   insforge_query_and_chart ──▶ one RLS query + interactive chart (WebMCP)
             │                                  └─ Postgres RLS scopes rows per user
             │   create_flint_chart  ──▶ fallback chart for existing surfaces
             │   insforge_render_chart ──▶ /functions/flint-render ──▶ PNG for Slack
             ▼
        set_reminder / per-user analysis snapshots / Slack replies  (runtype.config.json)
```

InsForge serves the app and owns the data **and the users**; Runtype is the intelligence that respects those boundaries. Three layers make the multi-tenancy honest rather than prompt-promised:

1. **Verified identity** — the shell exchanges the signed-in user's native InsForge JWT for a bridge-minted ES256 token and attaches it to every chat request as `identityProof`. Runtype cryptographically verifies it against the bridge's JWKS (registered once as an Identity Exchange integration) and runs the agent as that end user. A request without a valid proof is refused by the platform with a 403, not by prompt text.
2. **Per-user data** — the analyst's SQL executes in the browser via a WebMCP page tool, calling the `run_analyst_sql` RPC with the user's own JWT. The RPC is `SECURITY INVOKER`, so Postgres row-level security decides which rows come back. The user's token never touches Runtype's servers.
3. **Per-user memory of work** — the agent's analysis snapshots are stored as Runtype records scoped to the verified end user (`end-user-isolated` tenancy preset), so one user's analysis history is invisible to another.

## Setup

Prerequisites: an [InsForge](https://insforge.dev) project, a [Runtype](https://runtype.com) account with the [config restored](../README.md#start-here-runtype-configuration), Node 18+. All scripts run from the repo root.

**1. Seed the sample dataset** (optional — skip for your own database):

```bash
INSFORGE_BASE_URL=https://<your-app>.insforge.app \
INSFORGE_ADMIN_KEY=<your admin api key> \
node scripts/seed-sample-data.mjs
```

**2. Deploy the chart renderer:**

```bash
INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... \
node scripts/deploy-flint-render.mjs
```

**3. Wire the chat embed.** In Runtype (dashboard, CLI, or MCP):

- Create a **client token** for the Business Analyst, bound to the chat surface (`product_surface_id`) — the binding is what admits the page's WebMCP chart tool — with `https://<your-app>.insforge.app` in `allowedOrigins`.
- Enable **WebMCP** on the chat surface: `behavior.webmcp = { enabled: true, allowlist: [{ origin: "https://<your-app>.insforge.app", tools: ["insforge_run_sql", "insforge_query_and_chart", "create_flint_chart"] }] }`. The restored template sets this policy from `insforgeBaseUrl`.

**4. End-user auth + per-user data (optional but recommended):**

```bash
# 4a. Per-user RLS + the read-only SQL RPC
INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/setup-user-rls.mjs

# 4b. The identity token bridge
INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... node scripts/deploy-ayb-identity.mjs
```

Then register the bridge as a Runtype **Identity Exchange integration** (REST; one-time):

```bash
curl https://api.runtype.com/v1/identity-integrations \
  -H "Authorization: Bearer <your Runtype API key>" -H "Content-Type: application/json" \
  -d '{
    "name": "InsForge (bridged)", "provider": "oidc",
    "descriptor": {
      "kind": "oidc-jwt",
      "issuer": "https://<your-app>.insforge.app/functions/ayb-identity",
      "jwksUri": "https://<your-app>.insforge.app/functions/ayb-identity?jwks=1",
      "audience": "runtype-ayb",
      "allowedAlgorithms": ["ES256"],
      "claimMap": { "subject": "sub", "email": "email" }
    }
  }'
```

Lock the analyst agent to verified end users (`config.tenancyStrategy = { "preset": "end-user-isolated" }`), remove the admin `insforge_run_sql` saved tool from it (the shell provides the per-user replacement as a page tool), and allowlist `insforge_run_sql`, `insforge_query_and_chart`, and `create_flint_chart` on the chat surface. Note: identity-proof admission is enabled per account; if proofs seem ignored, ask Runtype to enable Identity Exchange admission for yours.

**5. Deploy the shell:**

```bash
INSFORGE_BASE_URL=... INSFORGE_ADMIN_KEY=... \
RUNTYPE_CLIENT_TOKEN=ct_live_... \
INSFORGE_ANON_KEY=anon_... \
node scripts/deploy-shell.mjs
```

Your analyst is live at `https://<your-app>.insforge.app/functions/ai-data-visualization`. Without `INSFORGE_ANON_KEY` the shell deploys in the original no-sign-in mode (shared analyst, admin SQL tool).

Pointing at your own database instead of the sample? Set `SAMPLE_DATASET=false` and pass `STARTER_PROMPTS='["...","..."]'` with questions that fit your schema; the agent discovers your tables on its own. `DEMO_ACCOUNTS='[{"email":"...","password":"...","label":"..."}]'` surfaces one-click demo logins on the sign-in card (demo datasets only — these are visible to every visitor).

Prefer the InsForge CLI over these zero-dependency scripts? The equivalents are `insforge db import` (schema + sample data), `insforge functions deploy flint-render --file insforge/functions/flint-render.mjs`, `insforge functions deploy ai-data-visualization` (after config injection — our deploy script does this part), and `insforge secrets add` for any function env.

### Performance diagnostics

Append `?aybDebug=timings` to the shell URL, run a question, then call
`window.__AYB_DIAGNOSTICS__.print()` in DevTools. The timeline separates
client init, chat/resume request-to-headers, SSE milestones, browser SQL,
query-and-chart assembly, and Flint's first render. It records only safe
metadata — never tokens, SQL, arguments, result rows, or message text.

## Rebuilding the shell

The committed `shell/dist/index.html` is a prebuilt, generic bundle (no secrets — the client token and URLs are injected by `deploy-shell.mjs` as `window.__AYB_CONFIG__`). To modify it:

```bash
cd insforge/shell && npm install && npm run build
```

For local development, put the runtime values in the ignored `insforge/.env.local`
(a repo-root `.env.local` is also supported):

```bash
RUNTYPE_CLIENT_TOKEN=ct_live_...
INSFORGE_BASE_URL=https://your-app.insforge.app
```

`NEXT_PUBLIC_INSFORGE_URL` is also accepted for the base URL, and
`INSFORGE_ANON_KEY` or `NEXT_PUBLIC_INSFORGE_ANON_KEY` enables the signed-in
flow. Then run `cd insforge/shell && npm run dev`; Vite injects the local-only
`window.__AYB_CONFIG__` before the app starts.

## Notes and caveats

- **flint-render is a public endpoint.** Anyone who can reach it can store chart specs and render PNGs (specs are capped in size; rows are data you already chose to chart). For production use, add a shared-secret check or rate limiting in the function before going live with sensitive chart content.
- **flint-render loads echarts/flint-chart from esm.sh at cold start** because InsForge's deploy validator rejects large inlined bundles. Cold renders take ~1–2s (warm ~0.5s) and require outbound network from functions. Pin or self-host those imports for production hardening.
- **The agents' SELECT-only behavior is prompt-enforced only on the admin path.** The monitor agent still uses the `INSFORGE_API_KEY` saved tool — use a read-only key there. The signed-in analyst path is different: `run_analyst_sql` validates single-statement SELECT/WITH, runs read-only with a statement timeout, and Postgres RLS is the hard row boundary.
- **Native InsForge JWTs carry no `iss`/`aud`**, which Runtype's verifier requires (deliberately, fail-closed). That is the entire reason `ayb-identity` exists: it re-mints the verified native token with pinned `iss`/`aud` and its own JWKS. If InsForge adds `iss`/`aud` claims to native tokens, the bridge can be retired and the integration pointed at the project JWKS directly.
- **The bridge's ES256 signing key self-provisions** into the `ayb_bridge_signing_keys` table (RLS deny-all; reachable only by the admin plane and the function's own API key).
- **Access-token TTL is 900s** — the shell refreshes the native session and re-exchanges bridge tokens automatically with a 60s margin.
- The fast interactive path (`insforge_query_and_chart`) executes one RLS-scoped SQL query and renders its rows in the page in a single WebMCP call. `create_flint_chart` remains as a two-step fallback for older surface policies. The PNG path (`insforge_render_chart`) renders the same Flint spec server-side.
