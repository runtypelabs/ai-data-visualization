import { installWebMCP } from "@mcp-b/webmcp-polyfill";

import type { AybAuth } from "../auth";
import { registerCreateFlintChartTool } from "./create-flint-chart";
import { registerQueryAndChartTool } from "./query-and-chart";
import { registerRunSqlTool } from "./run-sql";
import type { RegisterableModelContext } from "./types";

// WebMCP polyfill v6 replaces a thrown error's message with a generic
// "Tool execution failed", so surface it to the model as an isError result
// (validation, SQL, and Flint compile errors all carry guidance it needs).
// v6 registerTool is async and rejects when its signal aborts, so swallow
// that expected rejection instead of leaving it unhandled.
const reportThrownErrors = (modelContext: RegisterableModelContext): RegisterableModelContext => ({
  registerTool: (tool, options) =>
    Promise.resolve(
      modelContext.registerTool(
        {
          ...tool,
          execute: async (args, executeOptions) => {
            try {
              return await tool.execute(args, executeOptions);
            } catch (error) {
              return {
                isError: true,
                content: [
                  { type: "text", text: error instanceof Error ? error.message : String(error) },
                ],
              };
            }
          },
        },
        options,
      ),
    ).catch((error: unknown) => {
      if (!options?.signal?.aborted) console.error(`Failed to register ${tool.name}`, error);
    }),
});

export const registerPageTools = (auth: AybAuth | null): AbortController => {
  installWebMCP();
  const nativeModelContext = (document as Document & { modelContext?: RegisterableModelContext })
    .modelContext;
  if (!nativeModelContext) throw new Error("WebMCP modelContext is unavailable.");
  const modelContext = reportThrownErrors(nativeModelContext);

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
