/**
 * AI Data Visualization — InsForge × Runtype demo shell.
 *
 * Fullscreen Persona assistant over the staging Business Analyst agent, with a
 * Flint-chart generative-UI artifact view. The page is served by an InsForge
 * edge function; the data lives in InsForge Postgres; Runtype is the
 * intelligence. Adapted from Persona's Northstar analytics demo.
 */
import "@runtypelabs/persona/widget.css";
import "./style.css";

import {
  DEFAULT_WIDGET_CONFIG,
  componentRegistry,
  initAgentWidget,
  markdownPostprocessor,
  type AgentWidgetConfig,
  type AgentWidgetInitHandle,
  type ComponentRenderer,
} from "@runtypelabs/persona";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import type { ChartAssemblyInput } from "flint-chart";
import type { ECharts, EChartsOption } from "echarts";

import { AybAuth, type AybUser } from "./auth";

interface RegisterableModelContext {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      annotations?: Record<string, unknown>;
      execute: (args: Record<string, unknown>) => unknown;
    },
    options?: { signal?: AbortSignal },
  ): void;
}

type Row = Record<string, unknown>;

type FlintArtifactProps = {
  title: string;
  description: string;
  sql: string;
  input: ChartAssemblyInput;
};

const FLINT_COMPONENT = "AybFlintChart";
const MAX_CHART_ROWS = 500;

/**
 * Runtime page config, injected by the serving InsForge function as
 * `window.__AYB_CONFIG__` so one prebuilt bundle works for any project.
 * apiUrl + clientToken + insforgeBaseUrl are required; the rest is optional.
 */
interface AybPageConfig {
  apiUrl?: string;
  clientToken?: string;
  insforgeBaseUrl?: string;
  /** InsForge anon (publishable) key — enables end-user sign-in when present. */
  insforgeAnonKey?: string;
  productName?: string;
  starterPrompts?: string[];
  /** Set false when the connected database is real customer data. */
  sampleDataset?: boolean;
  /** Demo logins surfaced as one-click fills on the sign-in card. */
  demoAccounts?: Array<{ email: string; password: string; label?: string }>;
}

const PAGE_CONFIG: AybPageConfig =
  (window as Window & { __AYB_CONFIG__?: AybPageConfig }).__AYB_CONFIG__ ?? {};

const API_URL = PAGE_CONFIG.apiUrl ?? "https://api.runtype.com";
const CLIENT_TOKEN = PAGE_CONFIG.clientToken ?? "";
const INSFORGE_BASE = PAGE_CONFIG.insforgeBaseUrl ?? "";
const INSFORGE_ANON_KEY = PAGE_CONFIG.insforgeAnonKey ?? "";
const PRODUCT_NAME = PAGE_CONFIG.productName ?? "Generative Dashboard Template";
const IS_SAMPLE_DATASET = PAGE_CONFIG.sampleDataset !== false;
const DEMO_ACCOUNTS = PAGE_CONFIG.demoAccounts ?? [];

// Each default pill is phrased to imply a period AND a breakdown, so the
// analyst's own SQL returns a multi-series result rather than one aggregate row
// per site — and to make an expressive Flint chart the natural fit rather than a
// four-bar bar chart. In order these lean toward a multi-series line or bump
// chart, a bullet chart against pace, a waterfall of margin variance, and the
// email/reminder workflow.
const STARTER_PROMPTS = PAGE_CONFIG.starterPrompts ?? [
  "How has each site tracked against target over the last 12 weeks — who's gaining and who's slipping?",
  "Which sites are behind pace right now, and how did they get there day by day?",
  "Where are we losing margin, and which sites and jobs account for the gap?",
  "Email each site owner their biggest issue, and alert me if it gets worse.",
];

let widget: AgentWidgetInitHandle | null = null;

// True while an assistant turn is in flight. The grouped activity checklist
// momentarily reads "all complete" between two sequential tool calls; without
// this check the terminal "Analysis ready" row flickers on and off once per
// query on query-heavy turns. The handle exposes no lifecycle events, so
// infer it from the message list: mid-turn the newest message is a tool call
// or a streaming reply.
const isTurnActive = (): boolean => {
  const messages = (widget?.getMessages() ?? []) as Array<{
    role?: string;
    streaming?: boolean;
    toolCall?: unknown;
  }>;
  const last = messages[messages.length - 1];
  if (!last) return false;
  return last.streaming === true || last.role === "user" || last.toolCall != null;
};

/* ── Tool-activity labels ──────────────────────────────────────────── */

const TOOL_ACTIVITY: Record<string, readonly [active: string, complete: string]> = {
  insforge_list_tables: ["Scanning the live database", "Scanned the live database"],
  insforge_run_sql: ["Running SQL under your login", "Ran SQL under your login"],
  create_flint_chart: ["Assembling your dashboard", "Assembled your dashboard"],
  send_email: ["Preparing the email", "Handled the email"],
  set_reminder: ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  get_current_time: ["Checking the clock", "Checked the clock"],
  "Get Current Time": ["Checking the clock", "Checked the clock"],
  "Send Email": ["Preparing the email", "Handled the email"],
  "Set Reminder": ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  runtype_record_upsert: ["Saving the analysis snapshot", "Saved the analysis snapshot"],
  runtype_record_get: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
  runtype_record_list: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
};

const getToolActivityLabel = (
  toolName: string | undefined,
): readonly [active: string, complete: string] | undefined => {
  const bareName = toolName?.replace(/^webmcp:/, "");
  return bareName ? TOOL_ACTIVITY[bareName] : undefined;
};

const createTextElement = (
  tag: keyof HTMLElementTagNameMap,
  className: string,
  text: string,
): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

// Visually hidden live region: sighted users read progress from the grouped
// activity checklist; screen readers hear the same updates here.
const statusAnnouncer = createTextElement("div", "ayb-sr-status", "");
statusAnnouncer.setAttribute("role", "status");
document.body.appendChild(statusAnnouncer);
const announceStatus = (text: string): void => {
  if (statusAnnouncer.textContent !== text) statusAnnouncer.textContent = text;
};

const renderGroupedToolActivity = (
  toolCalls: Array<{ name?: string; status: "pending" | "running" | "complete" }>,
): HTMLElement => {
  const steps: Array<{ label: string; done: boolean }> = [];
  for (const toolCall of toolCalls) {
    const labels = getToolActivityLabel(toolCall.name);
    const done = toolCall.status === "complete";
    const label = done
      ? (labels?.[1] ?? "Completed an analysis step")
      : `${labels?.[0] ?? "Working through your request"}…`;
    // Consecutive repeats of one activity read as a single step.
    if (steps[steps.length - 1]?.label === label) continue;
    steps.push({ label, done });
  }
  // Only declare the analysis ready when the whole turn is over; between two
  // sequential tool calls every step is momentarily "done" and the terminal
  // row would flicker.
  const allDone = steps.every((step) => step.done) && !isTurnActive();
  const list = document.createElement("span");
  list.className = "ayb-activity-steps";
  for (const step of steps) {
    list.appendChild(
      createTextElement("span", `ayb-activity-step${step.done ? " done" : ""}`, step.label),
    );
  }
  if (allDone) {
    list.appendChild(createTextElement("span", "ayb-activity-step ready", "Analysis ready"));
  }
  announceStatus(allDone ? "Analysis ready" : (steps.find((step) => !step.done)?.label ?? ""));
  return list;
};

/* ── Flint chart rendering ─────────────────────────────────────────── */

const CHART_COLORS = ["#17181a", "#59636e", "#2f7df4", "#19a968", "#9a6cf0", "#e3a229"];
const MIN_CHART_WIDTH = 320;
const MIN_CHART_HEIGHT = 280;

/**
 * Flint places legends and chart furniture against the declared canvas.
 * Reassemble against the live pane so those absolute positions stay useful.
 */
const fitFlintInputToCanvas = (
  input: ChartAssemblyInput,
  width: number,
  height: number,
): ChartAssemblyInput => {
  const fittedWidth = Math.max(MIN_CHART_WIDTH, Math.round(width));
  const fittedHeight = Math.max(MIN_CHART_HEIGHT, Math.round(height));
  return {
    ...input,
    chart_spec: {
      ...input.chart_spec,
      baseSize: { width: fittedWidth, height: fittedHeight },
      canvasSize: { width: fittedWidth, height: fittedHeight },
    },
  } as ChartAssemblyInput;
};

/**
 * Render a Flint chart into `canvas`, recompile against live dimensions on
 * resize, and dispose once `root` leaves the document.
 */
const mountResponsiveFlintChart = async (
  root: HTMLElement,
  canvas: HTMLElement,
  input: ChartAssemblyInput,
  onFirstRender?: () => void,
): Promise<ECharts> => {
  const [{ assembleECharts }, echarts] = await Promise.all([
    import("flint-chart"),
    import("echarts"),
  ]);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas" });

  let lastCanvasSize = "";
  let rendered = false;
  const renderResponsiveChart = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // A remounting artifact pane can measure 0 mid-transition; skip and let
    // the ResizeObserver re-fire once the canvas has a real size.
    if (width < 24 || height < 24) return;
    const canvasSize = `${Math.round(width)}x${Math.round(height)}`;
    if (canvasSize === lastCanvasSize) {
      chart.resize();
      return;
    }
    lastCanvasSize = canvasSize;

    const option = assembleECharts(fitFlintInputToCanvas(input, width, height)) as EChartsOption;
    option.backgroundColor = "transparent";
    option.animationDuration = 620;
    option.color = CHART_COLORS;
    // Flint emits vertical legends at an absolute `left` computed from the
    // compile-time canvas — re-anchor them (and the legend-title graphic) to
    // the right edge so they stay inside at every width.
    const legends = option.legend
      ? Array.isArray(option.legend)
        ? option.legend
        : [option.legend]
      : [];
    let legendReanchored = false;
    for (const legend of legends) {
      if (legend.orient === "vertical" && legend.left != null) {
        legend.left = undefined;
        legend.right = 12;
        legendReanchored = true;
      }
    }
    if (legendReanchored && option.graphic) {
      const graphics = Array.isArray(option.graphic) ? option.graphic : [option.graphic];
      for (const element of graphics as Array<{ type?: string; left?: unknown; right?: unknown }>) {
        if (element?.type === "text" && element.left != null) {
          element.left = undefined;
          element.right = 12;
        }
      }
    }
    chart.resize();
    chart.setOption(option, true);
    if (!rendered) {
      rendered = true;
      onFirstRender?.();
    }
  };

  renderResponsiveChart();

  const resizeObserver = new ResizeObserver(renderResponsiveChart);
  resizeObserver.observe(canvas);
  const connectionObserver = new MutationObserver(() => {
    if (root.isConnected) return;
    resizeObserver.disconnect();
    connectionObserver.disconnect();
    chart.dispose();
  });
  connectionObserver.observe(document.body, { childList: true, subtree: true });
  return chart;
};

/** A clicked chart region becomes a drafted (not auto-sent) follow-up. */
const draftFollowUpFromChartClick = (params: unknown): void => {
  const { seriesName, name } = (params ?? {}) as { seriesName?: unknown; name?: unknown };
  const subject = [seriesName, name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" in ");
  if (!subject || !widget) return;
  widget.open();
  widget.setMessage(`Tell me more about ${subject} — what's driving it?`);
  widget.focusInput();
};

const renderDataTable = (rows: Row[]): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "ayb-artifact-panel";
  wrap.dataset.panel = "data";

  const table = document.createElement("table");
  table.className = "ayb-data-table";
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    headRow.appendChild(createTextElement("th", "", column));
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (const row of rows.slice(0, 100)) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const value = row[column];
      tr.appendChild(createTextElement("td", "", value == null ? "—" : String(value)));
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  if (rows.length > 100) {
    wrap.appendChild(
      createTextElement(
        "div",
        "ayb-table-note",
        `Showing the first 100 of ${rows.length.toLocaleString()} rows`,
      ),
    );
  }
  return wrap;
};

const FlintChartRenderer: ComponentRenderer = (rawProps) => {
  const props = rawProps as FlintArtifactProps;
  const root = document.createElement("section");
  root.className = "ayb-artifact";

  const hero = document.createElement("header");
  hero.className = "ayb-artifact-hero";
  hero.append(
    createTextElement("h2", "", props.title),
    createTextElement("p", "ayb-artifact-description", props.description),
  );

  const shell = document.createElement("div");
  shell.className = "ayb-chart-shell";
  const toolbar = document.createElement("div");
  toolbar.className = "ayb-chart-toolbar";
  const tabs = document.createElement("div");
  tabs.className = "ayb-chart-tabs";
  for (const [id, label] of [
    ["chart", "Chart"],
    ["data", "Table"],
    ["sql", "SQL"],
  ] as const) {
    const button = createTextElement(
      "button",
      `ayb-chart-tab${id === "chart" ? " active" : ""}`,
      label,
    ) as HTMLButtonElement;
    button.type = "button";
    button.dataset.tab = id;
    tabs.appendChild(button);
  }
  toolbar.append(
    tabs,
    createTextElement("span", "ayb-chart-meta", "Click a point to ask about it"),
  );

  const chartView = document.createElement("div");
  chartView.className = "ayb-chart-view";
  chartView.dataset.panel = "chart";
  const chartCanvas = document.createElement("div");
  chartCanvas.className = "ayb-chart-canvas";
  const loading = createTextElement("div", "ayb-chart-loading", "Preparing your analysis…");
  chartView.append(chartCanvas, loading);

  const rows = ((props.input.data as { values?: Row[] }).values ?? []) as Row[];
  const dataPanel = renderDataTable(rows);
  const sqlPanel = document.createElement("div");
  sqlPanel.className = "ayb-artifact-panel";
  sqlPanel.dataset.panel = "sql";
  const sqlBlock = document.createElement("pre");
  sqlBlock.className = "ayb-artifact-sql";
  sqlBlock.textContent = props.sql;
  sqlPanel.appendChild(sqlBlock);
  shell.append(toolbar, chartView, dataPanel, sqlPanel);
  root.append(hero, shell);

  tabs.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
    if (!button) return;
    const selected = button.dataset.tab;
    tabs.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === selected);
    });
    shell.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
      if (panel.dataset.panel === "chart") {
        panel.classList.toggle("hidden", selected !== "chart");
      } else {
        panel.classList.toggle("active", panel.dataset.panel === selected);
      }
    });
  });

  window.setTimeout(async () => {
    try {
      const chart = await mountResponsiveFlintChart(root, chartCanvas, props.input, () =>
        loading.remove(),
      );
      chart.on("click", draftFollowUpFromChartClick);
    } catch (error) {
      loading.className = "ayb-artifact-error";
      loading.textContent = `We couldn't build this chart: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }, 0);

  return root;
};

componentRegistry.register(FLINT_COMPONENT, FlintChartRenderer);

/* ── Cold-start onboarding artifact ────────────────────────────────── */

const ONBOARDING_COMPONENT = "AybOnboarding";
const SAMPLE_TABLES = [
  "sites",
  "site_managers",
  "jobs",
  "production_targets",
  "production_actuals",
  "materials_usage",
  "safety_events",
  "job_costs",
];

const sendPrompt = (text: string): void => {
  if (!widget) return;
  widget.setMessage(text);
  widget.focusInput();
  // The 4.8 handle has no programmatic send; submit the composer form once
  // setMessage's render has landed the draft in the DOM.
  window.setTimeout(() => {
    const form = document.querySelector<HTMLFormElement>("form[data-persona-composer-form]");
    const input = form?.querySelector<HTMLTextAreaElement>("[data-persona-composer-input]");
    if (form && input && input.value.trim().length > 0) form.requestSubmit();
  }, 150);
};

const OnboardingRenderer: ComponentRenderer = () => {
  const root = document.createElement("section");
  root.className = "ayb-artifact ayb-onboard";

  const hero = document.createElement("header");
  hero.className = "ayb-artifact-hero";
  hero.append(
    createTextElement("h2", "", "Ask questions. Watch the SQL. Get a dashboard."),
    createTextElement(
      "p",
      "ayb-artifact-description",
      "This analyst adapts to whatever InsForge Postgres database it is connected to: it discovers the schema, writes auditable SQL, and assembles an interactive chart to match each question. Runtype powers the agent and this interactive chat experience.",
    ),
  );

  const steps = document.createElement("div");
  steps.className = "ayb-onboard-steps";
  const stepDefinitions: Array<[string, string, string]> = [
    [
      "1",
      "Ask in natural language",
      "No dashboards to configure. Ask about performance, risk, or cost the way you would ask a colleague.",
    ],
    [
      "2",
      "Watch it work",
      "The agent scans the live schema and runs real SQL you can inspect on every chart's SQL tab. Nothing is invented.",
    ],
    [
      "3",
      "Act on it",
      "It can email the right people and schedule follow-up checks, so an answer becomes a workflow.",
    ],
  ];
  for (const [number, title, body] of stepDefinitions) {
    const card = document.createElement("div");
    card.className = "ayb-onboard-step";
    card.append(
      createTextElement("span", "ayb-onboard-step-number", number),
      createTextElement("strong", "", title),
      createTextElement("p", "", body),
    );
    steps.appendChild(card);
  }

  let sample: HTMLElement | null = null;
  if (IS_SAMPLE_DATASET) {
    sample = document.createElement("div");
    sample.className = "ayb-onboard-sample";
    sample.append(
      createTextElement("span", "ayb-onboard-sample-badge", "Sample data"),
      createTextElement(
        "p",
        "",
        "This demo is wired to a fictional industrial-operations dataset so there is something to explore. Connect your own database and the analyst re-derives everything from your schema; nothing below is hard-coded.",
      ),
    );
    const tables = document.createElement("div");
    tables.className = "ayb-onboard-tables";
    for (const table of SAMPLE_TABLES) {
      tables.appendChild(createTextElement("code", "", table));
    }
    sample.appendChild(tables);
  }

  const tryBlock = document.createElement("div");
  tryBlock.className = "ayb-onboard-try";
  tryBlock.appendChild(createTextElement("strong", "", "Try it"));
  for (const prompt of STARTER_PROMPTS) {
    const button = createTextElement("button", "ayb-onboard-prompt", prompt) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => sendPrompt(prompt));
    tryBlock.appendChild(button);
  }

  root.append(hero, steps);
  if (sample) root.appendChild(sample);
  root.appendChild(tryBlock);
  return root;
};

componentRegistry.register(ONBOARDING_COMPONENT, OnboardingRenderer);

const showOnboardingArtifact = (): void => {
  if (!widget) return;
  if (widget.getMessages().length > 0 || widget.getArtifacts().length > 0) return;
  widget.upsertArtifact({
    id: "ayb-onboarding",
    artifactType: "component",
    title: "How this works",
    component: ONBOARDING_COMPONENT,
    props: {},
  });
  widget.showArtifacts();
};

/* ── Artifact chat card ────────────────────────────────────────────── */

const renderArtifactCard: NonNullable<
  NonNullable<NonNullable<AgentWidgetConfig["features"]>["artifacts"]>["renderCard"]
> = ({ artifact }) => {
  const card = document.createElement("div");
  card.className = "ayb-artifact-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("data-open-artifact", artifact.artifactId);
  card.setAttribute("aria-label", `Open ${artifact.title}`);
  card.appendChild(createTextElement("div", "ayb-artifact-card-icon", "✦"));
  const copy = document.createElement("div");
  copy.className = "ayb-artifact-card-copy";
  copy.append(
    createTextElement("strong", "", artifact.title || "Generated analysis"),
    createTextElement("span", "", "Interactive analysis · Open"),
  );
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("viewBox", "0 0 20 20");
  arrow.innerHTML = '<path d="m7 4 6 6-6 6"/>';
  card.append(copy, arrow);
  return card;
};

// Persona 4.8 renders its own artifact card (via renderCard) for upserted
// component artifacts, so no manual card injection is needed here.

/* ── The create_flint_chart page tool ──────────────────────────────── */

// Some models (seen with nemotron) emit object values as pre-quoted JSON
// strings, e.g. {"x": "\"site_code\""}; unwrap one quote layer.
const unquote = (value: string): string => {
  const trimmed = value.trim();
  const match = /^"(.*)"$/.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
};

const normalizeEncodings = (value: unknown): Record<string, { field: string }> => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("encodings must be an object mapping channels to fields.");
  }
  const normalized: Record<string, { field: string }> = {};
  for (const [channel, rawEncoding] of Object.entries(value)) {
    const encoding = rawEncoding as string | { field?: string };
    const field = typeof encoding === "string" ? encoding : encoding?.field;
    if (typeof field !== "string" || !field.trim()) {
      throw new Error(`Encoding "${channel}" needs a field name.`);
    }
    normalized[channel] = { field: unquote(field) };
  }
  return normalized;
};

const normalizeSemanticTypes = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("semanticTypes must be an object mapping fields to Flint semantic types.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([field, type]) => {
      if (typeof type !== "string" || !type.trim()) {
        throw new Error(`Semantic type for "${field}" must be a string.`);
      }
      return [unquote(field), unquote(type)];
    }),
  );
};

const normalizeRows = (value: unknown): Row[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "rows must be a non-empty array of result objects (pass through the rows returned by insforge_run_sql).",
    );
  }
  const rows = value.slice(0, MAX_CHART_ROWS);
  for (const row of rows) {
    if (typeof row !== "object" || row == null || Array.isArray(row)) {
      throw new Error("Every row must be a flat object of column values.");
    }
  }
  return rows as Row[];
};

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

const MAX_SQL_RESULT_ROWS = 500;
const MAX_SQL_RESULT_CHARS = 150_000;

/**
 * The RLS-scoped SQL tool. Executes in the browser with the signed-in user's
 * own InsForge JWT via the `run_analyst_sql` RPC (SECURITY INVOKER), so
 * Postgres row-level security — not prompt text — decides which rows come
 * back. The token never leaves the page; Runtype's servers never see it.
 */
const registerRunSqlTool = (
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

const registerPageTools = (auth: AybAuth | null): AbortController => {
  initializeWebMCPPolyfill();
  const modelContext = (document as Document & { modelContext?: RegisterableModelContext })
    .modelContext;
  if (!modelContext) throw new Error("WebMCP modelContext is unavailable.");

  const controller = new AbortController();
  if (auth) registerRunSqlTool(modelContext, auth, controller.signal);
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
    { signal: controller.signal },
  );
  return controller;
};

/* ── Theme — compact neutral workspace with warm data accents ─────── */

const aybTheme: NonNullable<AgentWidgetConfig["theme"]> = {
  palette: {
    colors: {
      primary: {
        50: "#f8f9fa",
        100: "#eef0f2",
        200: "#dfe3e7",
        300: "#c9ced4",
        400: "#99a2ad",
        500: "#59636e",
        600: "#414950",
        700: "#343a41",
        800: "#252a30",
        900: "#17181a",
        950: "#0d0e10",
      },
      gray: {
        50: "#f8f9fa",
        100: "#f0f2f4",
        200: "#e1e4e8",
        300: "#c9ced4",
        400: "#99a2ad",
        500: "#737d88",
        600: "#59636e",
        700: "#414950",
        800: "#2a2f35",
        900: "#17181a",
        950: "#0d0e10",
      },
    },
    radius: {
      sm: "6px",
      md: "8px",
      lg: "11px",
      xl: "14px",
      "2xl": "16px",
      full: "9999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(20, 24, 30, 0.05)",
      md: "0 5px 18px rgba(20, 24, 30, 0.07)",
      lg: "0 12px 34px rgba(20, 24, 30, 0.09)",
      xl: "0 18px 48px rgba(20, 24, 30, 0.11)",
      "2xl": "0 24px 64px rgba(20, 24, 30, 0.14)",
    },
    typography: {
      fontFamily: {
        sans: "Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        mono: "'SFMono-Regular', Consolas, monospace",
      },
      fontSize: {
        xs: "0.6875rem",
        sm: "0.75rem",
        base: "0.8125rem",
        lg: "0.9375rem",
        xl: "1.0625rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
        "4xl": "1.875rem",
      },
      lineHeight: {
        tight: "1.2",
        normal: "1.45",
        relaxed: "1.55",
      },
    },
  },
  semantic: {
    colors: {
      primary: "#17181a",
      accent: "#252a30",
      surface: "#ffffff",
      background: "#f5f6f8",
      container: "#f0f2f4",
      text: "#17181a",
      textMuted: "#66707d",
      border: "#e1e4e8",
      divider: "#e8ebee",
      interactive: {
        default: "#17181a",
        hover: "#2a2f35",
        focus: "#414950",
        active: "#0d0e10",
        disabled: "#c9ced4",
      },
    },
    typography: {
      fontFamily: "palette.typography.fontFamily.sans",
      fontSize: "palette.typography.fontSize.base",
      fontWeight: "palette.typography.fontWeight.normal",
      lineHeight: "palette.typography.lineHeight.normal",
    },
  },
  components: {
    button: {
      borderRadius: "9px",
      primary: {
        background: "#17181a",
        foreground: "#ffffff",
        borderRadius: "9px",
        hoverBackground: "#2a2f35",
      },
      secondary: {
        background: "#ffffff",
        foreground: "#252a30",
        border: "#d8dce1",
        borderRadius: "9px",
      },
      ghost: {
        background: "transparent",
        foreground: "#59636e",
        borderRadius: "8px",
        hoverBackground: "#eceef1",
      },
    },
    launcher: { borderRadius: "14px" },
    panel: {
      border: "1px solid #dfe3e7",
      borderRadius: "14px",
      shadow: "0 8px 30px rgba(20, 24, 30, 0.06)",
      inset: "12px",
      canvasBackground: "#f5f6f8",
    },
    header: {
      background: "#f8f9fa",
      border: "#e1e4e8",
      borderRadius: "0",
      titleForeground: "#17181a",
      subtitleForeground: "#737d88",
      actionIconForeground: "#59636e",
      borderBottom: "1px solid #e1e4e8",
      shadow: "none",
    },
    message: {
      user: {
        background: "#eef0f2",
        text: "#202327",
        borderRadius: "12px",
        shadow: "none",
      },
      assistant: {
        background: "transparent",
        text: "#24282d",
        borderRadius: "0",
        border: "transparent",
        shadow: "none",
      },
      border: "#e8ebee",
    },
    introCard: {
      background: "transparent",
      borderRadius: "0",
      padding: "0",
      shadow: "none",
    },
    input: {
      background: "#ffffff",
      placeholder: "#99a2ad",
      borderRadius: "12px",
      focus: { border: "#aeb5bd", ring: "rgba(23, 24, 26, 0.12)" },
    },
    composer: { shadow: "0 3px 14px rgba(20, 24, 30, 0.06)" },
    toolBubble: { shadow: "none" },
    reasoningBubble: { shadow: "none" },
    collapsibleWidget: {
      container: "#f0f2f4",
      surface: "#ffffff",
      border: "#e1e4e8",
    },
    iconButton: {
      background: "#ffffff",
      border: "1px solid #dfe3e7",
      color: "#59636e",
      padding: "0.4rem",
      borderRadius: "8px",
      hoverBackground: "#f0f2f4",
      hoverColor: "#17181a",
      activeBackground: "#e8ebee",
      activeBorder: "#c9ced4",
    },
    labelButton: {
      background: "#ffffff",
      border: "1px solid #dfe3e7",
      color: "#3b424a",
      padding: "0.45rem 0.7rem",
      borderRadius: "8px",
      hoverBackground: "#f0f2f4",
      fontSize: "0.75rem",
      gap: "0.35rem",
    },
    scrollToBottom: {
      background: "#17181a",
      foreground: "#ffffff",
      border: "#17181a",
      borderRadius: "9999px",
      shadow: "0 3px 12px rgba(20, 24, 30, 0.15)",
    },
    markdown: {
      inlineCode: { background: "#eef0f2", foreground: "#30353b" },
      link: { foreground: "#d95019" },
      prose: {
        fontFamily:
          "Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
      heading: {
        h1: { fontSize: "1.375rem", fontWeight: "740" },
        h2: { fontSize: "1rem", fontWeight: "700" },
      },
      codeBlock: {
        background: "#17191d",
        borderColor: "#2c3036",
        textColor: "#e5e7eb",
      },
      table: { headerBackground: "#f0f2f4", borderColor: "#e1e4e8" },
    },
    artifact: {
      pane: { background: "#f7f8fa", toolbarBackground: "#f8f9fa" },
      toolbar: {
        iconHoverColor: "#17181a",
        iconHoverBackground: "#eceef1",
        iconPadding: "6px",
        iconBorderRadius: "8px",
        iconBorder: "1px solid #dfe3e7",
        iconBackground: "#ffffff",
        toolbarBorder: "1px solid #e1e4e8",
      },
      tab: {
        background: "transparent",
        activeBackground: "#ffffff",
        activeBorder: "#d8dce1",
        borderRadius: "8px",
        textColor: "#66707d",
        hoverBackground: "#eceef1",
        listBackground: "#f0f2f4",
        listBorderColor: "#e1e4e8",
        listPadding: "6px 8px",
      },
      card: {
        background: "#ffffff",
        border: "1px solid #dfe3e7",
        borderRadius: "11px",
        hoverBackground: "#f8f9fa",
        hoverBorderColor: "#c9ced4",
      },
    },
  },
};

/* ── Widget init ───────────────────────────────────────────────────── */

const buildConfig = (auth: AybAuth | null, authEnabled: boolean): AgentWidgetConfig => ({
  ...DEFAULT_WIDGET_CONFIG,
  apiUrl: API_URL,
  clientToken: CLIENT_TOKEN,
  parserType: "json",
  // After Persona's own directive parsing, any PersonaArtifactCard JSON still
  // present as literal text is a leak (the agent sometimes emits the directive
  // twice, or in a spot the parser doesn't recognize) — strip it.
  postprocessMessage: ({ text }) =>
    markdownPostprocessor(text).replace(
      /\{&quot;component&quot;:&quot;PersonaArtifactCard&quot;.*?\}\}|\{"component":"PersonaArtifactCard".*?\}\}/g,
      "",
    ),
  theme: aybTheme,
  colorScheme: "light",
  copy: {
    ...DEFAULT_WIDGET_CONFIG.copy,
    showWelcomeCard: true,
    welcomeTitle: "AI Data Visualization",
    welcomeSubtitle: IS_SAMPLE_DATASET
      ? "Explore live performance, risk, costs, and what needs attention next. This workspace uses fictional sample data."
      : "Explore live performance, risk, costs, and what needs attention next.",
    inputPlaceholder: "Ask anything about your business…",
  },
  suggestionChips: STARTER_PROMPTS,
  suggestionChipsConfig: {
    fontFamily: "sans-serif",
    fontWeight: "520",
    paddingX: "10px",
    paddingY: "6px",
  },
  sendButton: {
    ...DEFAULT_WIDGET_CONFIG.sendButton,
    size: "30px",
    paddingX: "7px",
    paddingY: "7px",
  },
  voiceRecognition: {
    ...DEFAULT_WIDGET_CONFIG.voiceRecognition,
    iconSize: "30px",
    paddingX: "7px",
    paddingY: "7px",
  },
  messageActions: { showCopy: true, showUpvote: false, showDownvote: false },
  statusIndicator: {
    visible: true,
    idleText: auth
      ? "SQL runs under your login. Postgres row-level security decides what you can see."
      : "Answers are computed from live data. Emails are only sent with your approval.",
    connectedText: auth
      ? "SQL runs under your login. Postgres row-level security decides what you can see."
      : "Answers are computed from live data. Emails are only sent with your approval.",
    connectingText: "Connecting…",
    errorText: "Connection error",
  },
  toolCall: {
    ...DEFAULT_WIDGET_CONFIG.toolCall,
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: "0",
    borderRadius: "0",
    shadow: "none",
    headerPaddingX: "0",
    loadingAnimationColor: "#252a30",
    loadingAnimationSecondaryColor: "#99a2ad",
    loadingAnimationDuration: 1500,
    renderCollapsedSummary: ({ toolCall, isActive }) => {
      const label = getToolActivityLabel(toolCall.name);
      const text = isActive
        ? `${label?.[0] ?? "Working through your request"}…`
        : (label?.[1] ?? "Completed an analysis step");
      return createTextElement(
        "span",
        `ayb-activity-step${isActive ? "" : " done"}`,
        text,
      );
    },
    renderGroupedSummary: ({ toolCalls }) => renderGroupedToolActivity(toolCalls),
  },
  contextProviders: [
    () => ({
      workspace: {
        product: PRODUCT_NAME,
        database: "InsForge Postgres (live)",
        page: "Analyst workspace",
      },
    }),
  ],
  features: {
    ...DEFAULT_WIDGET_CONFIG.features,
    showReasoning: false,
    showToolCalls: true,
    suggestReplies: { expose: true },
    toolCallDisplay: {
      ...DEFAULT_WIDGET_CONFIG.features?.toolCallDisplay,
      collapsedMode: "tool-name",
      activePreview: false,
      grouped: true,
      groupedMode: "summary",
      expandable: false,
      loadingAnimation: "shimmer-color",
    },
    artifacts: {
      enabled: true,
      allowedTypes: ["component"],
      renderCard: renderArtifactCard,
      layout: {
        // Detached resizers sit in-flow: 3px gap + 6px handle + 3px gap = 12px.
        splitGap: "3px",
        paneWidth: "calc(100% - clamp(320px, 25vw, 440px))",
        paneMaxWidth: "none",
        paneMinWidth: "0",
        resizable: true,
        resizableMinWidth: "320px",
        narrowHostMaxWidth: 700,
        paneAppearance: "detached",
        chatSurface: "flush",
        paneBorder: "1px solid #dfe3e7",
        paneBackground: "#f7f8fa",
        panePadding: "clamp(18px, 2vw, 30px)",
        paneShadow: "0 5px 22px rgba(20, 24, 30, 0.05)",
        chatShadow: "none",
        paneBorderRadius: "14px",
        toolbarPreset: "default",
        toolbarTitle: "Analysis",
        closeButtonLabel: "Back to chat",
        expandLauncherPanelWhenOpen: false,
      },
    },
  },
  webmcp: {
    enabled: true,
    allowlist: auth ? ["create_flint_chart", "insforge_run_sql"] : ["create_flint_chart"],
    autoApprove: () => true,
  },
  layout: {
    showHeader: false,
    header: {
      layout: "minimal",
      showIcon: false,
      showTitle: false,
      showSubtitle: false,
      showCloseButton: false,
      showClearChat: false,
    },
    messages: {
      layout: "minimal",
      user: { width: "content" },
      assistant: { width: "full" },
      timestamp: { show: false },
      avatar: { show: false },
    },
    contentMaxWidth: "72ch",
  },
  launcher: {
    enabled: false,
    fullHeight: true,
    clearChat: {
      enabled: true,
      tooltipText: "Reset chat",
      iconColor: "#68736e",
      backgroundColor: "transparent",
      borderColor: "transparent",
    },
  },
  // identityProof injection happens in a window.fetch wrapper (see
  // installProofInjector), NOT here: Persona 4.11's client-token dispatch
  // calls bare fetch() directly, bypassing both customFetch (non-client-token
  // mode only) and, in practice, requestMiddleware-added fields. Verified
  // empirically against /v1/client/chat.
  errorMessage: (error: Error) => {
    if (!authEnabled) {
      return "Something went wrong talking to the analyst. Please try again.";
    }
    if (!auth) {
      return "The analyst refused this request: it is locked to verified signed-in users. That refusal comes from Runtype's end-user isolation policy, not from prompt text. Sign in to continue.";
    }
    if (/403|forbidden|tenanc|isolat|verif/i.test(error?.message ?? "")) {
      return "Runtype's isolation policy refused this request. Sign out and back in to refresh your session, then try again.";
    }
    return "Something went wrong talking to the analyst. Please try again.";
  },
});

/* ── Markdown code-block copy controls ─────────────────────────────── */

const installCodeBlockCopyButtons = (mount: HTMLElement): void => {
  if (mount.dataset.aybCodeCopyInstalled === "true") return;
  mount.dataset.aybCodeCopyInstalled = "true";

  const enhanceCodeBlocks = (): void => {
    const codeBlocks = mount.querySelectorAll<HTMLElement>(
      [
        ".persona-artifact-pane .persona-markdown-bubble pre",
        ".persona-message-assistant-bubble pre",
      ].join(","),
    );
    for (const block of codeBlocks) {
      if (block.dataset.aybCopyReady === "true") continue;
      block.dataset.aybCopyReady = "true";
      block.classList.add("ayb-copyable-code");

      const button = createTextElement("button", "ayb-code-copy", "Copy") as HTMLButtonElement;
      button.type = "button";
      button.title = "Copy code";
      button.setAttribute("aria-label", "Copy code");
      button.setAttribute("aria-live", "polite");
      block.prepend(button);
    }
  };

  mount.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".ayb-code-copy");
    if (!button || !mount.contains(button) || button.disabled) return;
    const block = button.closest("pre");
    const code = block?.querySelector("code")?.textContent;
    if (!code) return;

    button.disabled = true;
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        button.textContent = "Copied";
        button.dataset.state = "success";
      })
      .catch(() => {
        button.textContent = "Copy failed";
        button.dataset.state = "error";
      })
      .finally(() => {
        window.setTimeout(() => {
          button.textContent = "Copy";
          delete button.dataset.state;
          button.disabled = false;
        }, 1500);
      });
  });

  const observer = new MutationObserver(enhanceCodeBlocks);
  observer.observe(mount, { childList: true, subtree: true });
  enhanceCodeBlocks();
};

/* ── Suggestion-strip overflow affordance ─────────────────────────── */

const installSuggestionScrollAffordance = (mount: HTMLElement): void => {
  if (mount.dataset.aybSuggestionScrollInstalled === "true") return;
  mount.dataset.aybSuggestionScrollInstalled = "true";

  const updateRow = (row: HTMLElement): void => {
    const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);
    const overflows = maxScrollLeft > 2;
    row.classList.toggle("ayb-suggestions-overflow", overflows);
    row.classList.toggle("ayb-suggestions-can-scroll-left", overflows && row.scrollLeft > 2);
    row.classList.toggle(
      "ayb-suggestions-can-scroll-right",
      overflows && row.scrollLeft < maxScrollLeft - 2,
    );
    if (overflows) {
      row.tabIndex = 0;
      row.setAttribute("aria-label", "Suggested questions. Scroll horizontally for more.");
    } else {
      row.removeAttribute("tabindex");
      row.removeAttribute("aria-label");
    }
  };

  const updateAll = (): void => {
    for (const row of mount.querySelectorAll<HTMLElement>(
      "[data-persona-composer-suggestions]",
    )) {
      updateRow(row);
    }
  };

  mount.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches("[data-persona-composer-suggestions]")
      ) {
        updateRow(target);
      }
    },
    { capture: true, passive: true },
  );

  const mutationObserver = new MutationObserver(() => {
    window.requestAnimationFrame(updateAll);
  });
  mutationObserver.observe(mount, { childList: true, subtree: true });

  const resizeObserver = new ResizeObserver(updateAll);
  resizeObserver.observe(mount);
  window.requestAnimationFrame(updateAll);
};

/* ── Sign-in UI + boot ─────────────────────────────────────────────── */

const renderUserChip = (auth: AybAuth, user: AybUser): void => {
  const topbarRight = document.querySelector<HTMLElement>(".ayb-topbar-right");
  if (!topbarRight) return;
  const chip = document.createElement("div");
  chip.className = "ayb-user-chip";
  chip.append(
    createTextElement("span", "ayb-user-chip-dot", ""),
    createTextElement("span", "ayb-user-chip-email", user.email),
  );
  const signOut = createTextElement("button", "ayb-signout-btn", "Sign out") as HTMLButtonElement;
  signOut.type = "button";
  signOut.addEventListener("click", () => {
    void auth.signOut().finally(() => window.location.reload());
  });
  topbarRight.prepend(chip, signOut);
};

// Persona persists the conversation (including the server session whose
// conversation record is scope-claimed by the first verified user) per origin.
// If a DIFFERENT user signs in on the same browser, replaying that
// conversation would be refused by Runtype with `conversation_scope_mismatch`
// (fail closed — never another user's history). Reset the widget conversation
// whenever the signed-in user changes so each user starts their own session.
// A null last-user also resets: a conversation persisted from the pre-auth
// shell (or a signed-out visit) must not carry into a verified session.
const LAST_USER_STORAGE_KEY = "ayb-last-user-id";

/**
 * Attach the Runtype-verifiable identityProof (bridge-minted ES256 JWT) to
 * every /v1/client/chat dispatch by wrapping window.fetch. This is the ONLY
 * seam that reliably reaches Persona 4.11's client-token dispatch: that code
 * path calls bare fetch() directly, so the widget's customFetch (generic mode
 * only) and requestMiddleware hooks never get the proof onto the wire.
 */
const installProofInjector = (auth: AybAuth): void => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(API_URL) && url.includes("/v1/client/chat") && init?.method === "POST") {
      try {
        const body = JSON.parse((init.body as string) ?? "{}") as {
          messages?: unknown;
          identityProof?: unknown;
        };
        if (Array.isArray(body.messages) && !body.identityProof) {
          body.identityProof = { provider: "oidc", token: await auth.getBridgeToken() };
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Non-JSON body: pass through untouched; the server will refuse
        // un-proofed dispatches on its own (fail closed).
      }
    }
    return originalFetch(input, init);
  };
};

const bootWidget = (mount: HTMLElement, auth: AybAuth | null, authEnabled: boolean): void => {
  if (auth) installProofInjector(auth);
  registerPageTools(auth);
  installCodeBlockCopyButtons(mount);
  installSuggestionScrollAffordance(mount);
  widget = initAgentWidget({
    target: mount,
    useShadowDom: false,
    windowKey: "aybAnalyst",
    config: buildConfig(auth, authEnabled),
  });

  const currentUserId = auth?.user?.id ?? "anonymous";
  const lastUserId = localStorage.getItem(LAST_USER_STORAGE_KEY);
  localStorage.setItem(LAST_USER_STORAGE_KEY, currentUserId);
  if (lastUserId !== currentUserId) {
    widget.clearChat();
  }

  // Pre-configure the artifact pane with onboarding content on a cold start,
  // mirroring Persona's fullscreen-assistant pattern. The first real analysis
  // replaces it via upsertArtifact + showArtifacts.
  window.setTimeout(showOnboardingArtifact, 150);
};

const renderSignInCard = (mount: HTMLElement, auth: AybAuth): void => {
  const card = document.createElement("section");
  card.className = "ayb-signin";

  card.append(
    createTextElement("h2", "", "Sign in to your workspace"),
    createTextElement(
      "p",
      "ayb-signin-copy",
      "Each account sees only the sites it is entitled to. Your login is verified by Runtype and your SQL runs under your own database session, so the isolation is enforced, not promised.",
    ),
  );

  const form = document.createElement("form");
  form.className = "ayb-signin-form";
  const email = document.createElement("input");
  email.type = "email";
  email.required = true;
  email.placeholder = "Email";
  email.autocomplete = "username";
  email.setAttribute("aria-label", "Email");
  const password = document.createElement("input");
  password.type = "password";
  password.required = true;
  password.placeholder = "Password";
  password.autocomplete = "current-password";
  password.setAttribute("aria-label", "Password");
  const submit = createTextElement("button", "ayb-signin-submit", "Sign in") as HTMLButtonElement;
  submit.type = "submit";
  const errorLine = createTextElement("p", "ayb-signin-error", "");
  form.append(email, password, submit, errorLine);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    errorLine.textContent = "";
    submit.disabled = true;
    submit.textContent = "Signing in…";
    void auth
      .signIn(email.value.trim(), password.value)
      .then((user) => {
        card.remove();
        renderUserChip(auth, user);
        bootWidget(mount, auth, true);
      })
      .catch((error: Error) => {
        errorLine.textContent = error.message;
        submit.disabled = false;
        submit.textContent = "Sign in";
      });
  });
  card.appendChild(form);

  if (DEMO_ACCOUNTS.length > 0) {
    const demo = document.createElement("div");
    demo.className = "ayb-signin-demo";
    demo.appendChild(createTextElement("span", "", "Demo accounts:"));
    for (const account of DEMO_ACCOUNTS) {
      const button = createTextElement(
        "button",
        "ayb-signin-demo-btn",
        account.label ?? account.email,
      ) as HTMLButtonElement;
      button.type = "button";
      button.addEventListener("click", () => {
        email.value = account.email;
        password.value = account.password;
        form.requestSubmit();
      });
      demo.appendChild(button);
    }
    card.appendChild(demo);
  }

  const skip = createTextElement(
    "button",
    "ayb-signin-skip",
    "Continue without signing in (see the isolation policy refuse you)",
  ) as HTMLButtonElement;
  skip.type = "button";
  skip.addEventListener("click", () => {
    card.remove();
    bootWidget(mount, null, true);
  });
  card.appendChild(skip);

  mount.appendChild(card);
};

const mount = document.getElementById("ayb-chat-root");
if (!mount) throw new Error("#ayb-chat-root is missing.");

// Reflect the configured product name in the static header.
const brandName = document.querySelector<HTMLElement>(".ayb-brand-copy strong");
if (brandName) brandName.textContent = PRODUCT_NAME;
document.title = `${PRODUCT_NAME} — InsForge × Runtype`;

// Topbar reset: clear the conversation and bring the onboarding pane back.
document.getElementById("ayb-reset-chat")?.addEventListener("click", () => {
  widget?.clearChat();
  window.setTimeout(showOnboardingArtifact, 250);
});

if (!CLIENT_TOKEN || !INSFORGE_BASE) {
  // Unconfigured deployment: show setup guidance instead of a broken widget.
  const notice = document.createElement("div");
  notice.className = "ayb-setup-notice";
  notice.append(
    createTextElement("strong", "", "Almost there: this page needs its runtime config."),
    createTextElement(
      "p",
      "",
      import.meta.env.DEV
        ? "For local development, add RUNTYPE_CLIENT_TOKEN to the repo-root .env.local and restart Vite. The InsForge URL can come from INSFORGE_BASE_URL or NEXT_PUBLIC_INSFORGE_URL."
        : "The serving function must inject window.__AYB_CONFIG__ with apiUrl, clientToken (a Runtype client token bound to your chat surface), and insforgeBaseUrl. See the deploy script in the ai-data-visualization repo.",
    ),
  );
  mount.appendChild(notice);
} else if (!INSFORGE_ANON_KEY) {
  // Legacy deployment without end-user auth: original shared-analyst behavior.
  bootWidget(mount, null, false);
} else {
  const auth = new AybAuth(INSFORGE_BASE, INSFORGE_ANON_KEY);
  void auth.restore().then((user) => {
    if (user) {
      renderUserChip(auth, user);
      bootWidget(mount, auth, true);
    } else {
      renderSignInCard(mount, auth);
    }
  });
}
