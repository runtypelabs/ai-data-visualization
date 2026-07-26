import type { AybAuth } from "../auth";
import { startTiming } from "../telemetry";
import {
  createFlintArtifact,
  FLINT_CHART_TYPES,
  FLINT_SEMANTIC_TYPES,
} from "./create-flint-chart";
import { runSqlAsUser } from "./run-sql";
import type { RegisterableModelContext } from "./types";

/**
 * Executes the chart-ready query and opens the chart as one browser tool.
 * This removes one model round trip and avoids echoing every SQL row back into
 * a second tool call before Runtype pauses/resumes the local chart operation.
 */
export const registerQueryAndChartTool = (
  modelContext: RegisterableModelContext,
  auth: AybAuth,
  signal: AbortSignal,
): void => {
  modelContext.registerTool(
    {
      name: "insforge_query_and_chart",
      title: "Query live data and create an interactive chart",
      description:
        "Run one read-only chart-ready SQL query as the signed-in user, then compile its rows through Flint and open the interactive chart. Use this instead of separate insforge_run_sql and create_flint_chart calls for the core visual answer. Postgres row-level security applies.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concise chart title." },
          description: { type: "string", description: "One-sentence analytical takeaway." },
          sql: {
            type: "string",
            description: "One chart-ready SELECT or WITH ... SELECT statement (no semicolons).",
          },
          chartType: {
            type: "string",
            enum: FLINT_CHART_TYPES,
            description: "An exact, case-sensitive Flint chart type.",
          },
          encodings: {
            type: "object",
            description:
              'Map Flint channels to exact result fields, e.g. {"x":"week_start","y":"pct_of_target","color":"site_code"}. Other channels include goal, x2, group, size, detail, order, opacity, column, and row.',
            additionalProperties: {
              anyOf: [
                { type: "string" },
                { type: "object", properties: { field: { type: "string" } }, required: ["field"] },
              ],
            },
          },
          semanticTypes: {
            type: "object",
            description: "Map every encoded field to its Flint semantic type.",
            additionalProperties: { type: "string", enum: FLINT_SEMANTIC_TYPES },
          },
        },
        required: ["title", "description", "sql", "chartType", "encodings", "semanticTypes"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ title, description, sql, chartType, encodings, semanticTypes }) => {
        if (
          typeof title !== "string" ||
          typeof description !== "string" ||
          typeof sql !== "string" ||
          typeof chartType !== "string"
        ) {
          throw new Error("title, description, sql, and chartType are required strings.");
        }
        const complete = startTiming("tool.client.insforge_query_and_chart");
        try {
          const result = await runSqlAsUser(auth, sql);
          if (result.rows.length === 0) {
            complete({ rowCount: 0 });
            return {
              created: false,
              rowCount: 0,
              rows: [],
              finalizeWithoutMoreTools: true,
              message:
                "The query returned no rows. Do not call another tool automatically; explain the empty result and show the SQL.",
            };
          }
          const artifact = await createFlintArtifact({
            title,
            description,
            sql,
            chartType,
            encodings,
            semanticTypes,
            rows: result.rows,
          });
          complete({ plottedRows: artifact.plottedRows });
          return {
            created: true,
            artifactId: artifact.artifactId,
            title: title.trim(),
            chartType,
            plottedRows: artifact.plottedRows,
            rowCount: result.rowCount,
            rows: result.rows,
            ...(result.note ? { note: result.note } : {}),
            finalizeWithoutMoreTools: true,
            message:
              "The RLS-scoped query succeeded and the interactive chart is open. This is terminal for the current request: call no more tools and finish the answer from these rows.",
          };
        } catch (error) {
          complete({ error: true });
          throw error;
        }
      },
    },
    { signal },
  );
};
