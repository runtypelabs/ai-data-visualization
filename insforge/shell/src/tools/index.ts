import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

import type { AybAuth } from "../auth";
import { registerCreateFlintChartTool } from "./create-flint-chart";
import { registerQueryAndChartTool } from "./query-and-chart";
import { registerRunSqlTool } from "./run-sql";
import type { RegisterableModelContext } from "./types";

export const registerPageTools = (auth: AybAuth | null): AbortController => {
  initializeWebMCPPolyfill();
  const modelContext = (document as Document & { modelContext?: RegisterableModelContext })
    .modelContext;
  if (!modelContext) throw new Error("WebMCP modelContext is unavailable.");

  const controller = new AbortController();
  if (auth) {
    registerRunSqlTool(modelContext, auth, controller.signal);
    registerQueryAndChartTool(modelContext, auth, controller.signal);
  }
  // Keep the two-step chart tool as a fallback for existing Runtype surfaces
  // whose server-side WebMCP policy has not admitted the combined tool yet.
  registerCreateFlintChartTool(modelContext, controller.signal);
  return controller;
};
