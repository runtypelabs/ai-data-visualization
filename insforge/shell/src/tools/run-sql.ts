import type { AybAuth } from "../auth";
import { INSFORGE_BASE } from "../config";
import type { Row } from "../types";
import type { RegisterableModelContext } from "./types";

const MAX_SQL_RESULT_ROWS = 500;
const MAX_SQL_RESULT_CHARS = 150_000;

/**
 * The RLS-scoped SQL tool. Executes in the browser with the signed-in user's
 * own InsForge JWT via the `run_analyst_sql` RPC (SECURITY INVOKER), so
 * Postgres row-level security — not prompt text — decides which rows come
 * back. The token never leaves the page; Runtype's servers never see it.
 */
export const registerRunSqlTool = (
  modelContext: RegisterableModelContext,
  auth: AybAuth,
  signal: AbortSignal,
): void => {
  modelContext.registerTool(
    {
      name: "insforge_run_sql",
      title: "Run SQL as the signed-in user",
      description:
        "Run a single read-only SQL statement against the connected InsForge Postgres database, executed AS the signed-in user. Postgres row-level security applies: results contain only rows this user is allowed to see, so totals may cover a subset of sites. Pass exactly one SELECT (or WITH ... SELECT) statement with no semicolons. Returns the result rows as a JSON array.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A single SELECT or WITH ... SELECT statement (no semicolons).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ query }) => {
        if (typeof query !== "string" || !query.trim()) {
          throw new Error("query must be a non-empty SQL string.");
        }
        const token = await auth.getFreshAccessToken();
        const response = await fetch(`${INSFORGE_BASE}/api/database/rpc/run_analyst_sql`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim() }),
        });
        const bodyText = await response.text();
        if (!response.ok) {
          let message = bodyText.slice(0, 400);
          try {
            const parsed = JSON.parse(bodyText) as { message?: string; error?: string };
            message = parsed.message ?? parsed.error ?? message;
          } catch {
            /* keep raw text */
          }
          throw new Error(`SQL failed (${response.status}): ${message}`);
        }
        const rows = JSON.parse(bodyText) as Row[];
        if (!Array.isArray(rows)) return { rows: [], rowCount: 0 };
        let limited = rows.slice(0, MAX_SQL_RESULT_ROWS);
        if (JSON.stringify(limited).length > MAX_SQL_RESULT_CHARS) {
          limited = limited.slice(0, 100);
        }
        return {
          rows: limited,
          rowCount: rows.length,
          ...(limited.length < rows.length
            ? { note: `Truncated to the first ${limited.length} of ${rows.length} rows.` }
            : {}),
        };
      },
    },
    { signal },
  );
};
