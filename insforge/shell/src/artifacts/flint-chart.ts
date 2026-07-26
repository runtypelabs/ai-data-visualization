import { componentRegistry, type ComponentRenderer } from "@runtypelabs/persona";
import type { ChartAssemblyInput } from "flint-chart";
import type { ECharts, EChartsOption } from "echarts";

import { createTextElement } from "../dom";
import { recordTiming } from "../telemetry";
import type { Row } from "../types";
import { draftFollowUpFromChartClick } from "../widget-session";

type FlintArtifactProps = {
  title: string;
  description: string;
  sql: string;
  input: ChartAssemblyInput;
};

export const FLINT_COMPONENT = "AybFlintChart";

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
      const chart = await mountResponsiveFlintChart(root, chartCanvas, props.input, () => {
        loading.remove();
        recordTiming("artifact.flint.first_render", { rowCount: rows.length });
      });
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

export const registerFlintChartComponent = (): void => {
  componentRegistry.register(FLINT_COMPONENT, FlintChartRenderer);
};
