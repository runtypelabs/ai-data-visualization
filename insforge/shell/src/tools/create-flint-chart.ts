import type { ChartAssemblyInput } from "flint-chart";

import { FLINT_COMPONENT } from "../artifacts/flint-chart";
import type { Row } from "../types";
import { getWidget } from "../widget-session";
import { normalizeEncodings, normalizeRows, normalizeSemanticTypes, unquote } from "./normalize";
import type { RegisterableModelContext } from "./types";

const createFlintArtifact = async ({
  title,
  description,
  sql,
  chartType,
  encodings,
  semanticTypes,
  rows,
}: {
  title: string;
  description: string;
  sql: string;
  chartType: string;
  encodings: unknown;
  semanticTypes: unknown;
  rows: Row[];
}): Promise<{ artifactId: string; plottedRows: number }> => {
  const input = {
    data: { values: rows },
    semantic_types: normalizeSemanticTypes(semanticTypes),
    chart_spec: {
      chartType: unquote(chartType),
      encodings: normalizeEncodings(encodings),
      baseSize: { width: 980, height: 520 },
    },
  } as ChartAssemblyInput;

  // Compile before opening the artifact so invalid chart specs return a
  // useful error rather than a blank artifact surface.
  const { assembleECharts } = await import("flint-chart");
  assembleECharts(input);
  const widget = getWidget();
  if (!widget) throw new Error("The analyst workspace is not ready yet.");

  const id = `flint-${Date.now()}`;
  widget.upsertArtifact({
    id,
    artifactType: "component",
    title: title.trim(),
    component: FLINT_COMPONENT,
    props: {
      title: title.trim(),
      description: description.trim(),
      sql: sql.trim(),
      input,
    },
  });
  widget.showArtifacts();
  return { artifactId: id, plottedRows: rows.length };
};

export const registerCreateFlintChartTool = (
  modelContext: RegisterableModelContext,
  signal: AbortSignal,
): void => {
  modelContext.registerTool(
    {
      name: "create_flint_chart",
      title: "Create an interactive chart",
      description:
        "Compile SQL result rows through Microsoft's Flint visualization language and open an interactive chart (with data table and SQL panels) in the analysis workspace. Pass the rows returned by insforge_run_sql.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concise chart title." },
          description: { type: "string", description: "One-sentence analytical takeaway." },
          sql: {
            type: "string",
            description: "The exact SELECT query that produced the rows (shown in the SQL panel).",
          },
          chartType: {
            type: "string",
            // Exactly the ECharts template names Flint 0.2.2 registers
            // (ecAllTemplateDefs). An unrecognized name throws at assembly, so
            // this list is the contract — notably there is no "Donut Chart".
            description:
              'An exact Flint chart type name, case-sensitive. One of: Line Chart, Area Chart, Range Area Chart, Streamgraph, Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Waterfall Chart, Lollipop Chart, Pyramid Chart, Bullet Chart, Ranged Dot Plot, Slope Chart, Bump Chart, Scatter Plot, Connected Scatter Plot, Regression, Strip Plot, Boxplot, Histogram, Density Plot, ECDF Plot, Heatmap, Calendar Heatmap, Radar Chart, Rose Chart, Pie Chart, Funnel Chart, Gauge Chart, Sunburst Chart, Treemap, Tree, Sankey Diagram, Network Graph, Parallel Coordinates, Gantt Chart, Candlestick Chart. Prefer the expressive form the data supports (Bullet Chart for actual vs target, Slope Chart for two-period change, Bump Chart for rank churn, Waterfall Chart for variance, Streamgraph for composition over time, Boxplot for spread) over a plain Bar Chart. There is no "Donut Chart" — use Pie Chart.',
          },
          encodings: {
            type: "object",
            description:
              'Map Flint channels to result fields, e.g. {"x":"week_start","y":"pct_of_target","color":"site_code"}. Beyond x, y, and color the available channels include goal (Bullet Chart target), x2 (Gantt end), group (Grouped Bar), size, detail, order, opacity, and column/row for small-multiple faceting.',
            additionalProperties: {
              anyOf: [
                { type: "string" },
                { type: "object", properties: { field: { type: "string" } }, required: ["field"] },
              ],
            },
          },
          semanticTypes: {
            type: "object",
            description:
              'Map every encoded field to a Flint semantic type, e.g. {"site_code":"Category","variance_tons":"Quantity"}. Time: Date, Week, Month, Quarter, Year, YearMonth, Duration. Measures: Quantity, Count, Amount, Price, Percentage, PercentageChange, Profit, Score, Rank, Range, Number. Labels: Category, Name, Status, Region, ID.',
            additionalProperties: { type: "string" },
          },
          rows: {
            type: "array",
            description:
              "The chart-ready result rows from insforge_run_sql, as an array of flat objects (up to 500).",
            items: { type: "object" },
          },
        },
        required: [
          "title",
          "description",
          "sql",
          "chartType",
          "encodings",
          "semanticTypes",
          "rows",
        ],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ title, description, sql, chartType, encodings, semanticTypes, rows }) => {
        if (
          typeof title !== "string" ||
          typeof description !== "string" ||
          typeof sql !== "string" ||
          typeof chartType !== "string"
        ) {
          throw new Error("title, description, sql, and chartType are required strings.");
        }
        const artifact = await createFlintArtifact({
          title,
          description,
          sql,
          chartType,
          encodings,
          semanticTypes,
          rows: normalizeRows(rows),
        });
        return {
          created: true,
          artifactId: artifact.artifactId,
          title: title.trim(),
          chartType,
          plottedRows: artifact.plottedRows,
          message:
            "The interactive chart is open in the analysis workspace. Now finish your reply in chat: the answer first, the key numbers, the recommended priority, your definitions, and the SQL appendix.",
        };
      },
    },
    { signal },
  );
};
