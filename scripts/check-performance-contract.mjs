import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "runtype.config.json"), "utf8"));
const analystCapability = config.productObject.capabilities.find(
  (capability) => capability.id === "ask-analyst-capability",
);
assert(analystCapability, "Business Analyst capability is missing");

const analyst = analystCapability.agent.config;
const toolNames = analyst.tools.runtimeTools.map((tool) => tool.name);
assert(
  analyst.systemPrompt.length <= 5_500,
  `Analyst prompt regressed to ${analyst.systemPrompt.length} characters`,
);
assert.match(analyst.systemPrompt, /finalizeWithoutMoreTools=true/);
assert.match(analyst.systemPrompt, /call NO more tools/);
assert.match(analyst.systemPrompt, /insforge_query_and_chart/);
assert(!toolNames.includes("insforge_list_tables"), "Analyst restored the redundant table-list call");
assert(
  analyst.tools.maxToolCalls <= 8,
  `Analyst tool-call budget regressed to ${analyst.tools.maxToolCalls}`,
);

const renderChart = analyst.tools.runtimeTools.find(
  (tool) => tool.name === "insforge_render_chart",
);
assert(renderChart, "Hosted chart tool is missing");
assert(
  Array.isArray(renderChart.parametersSchema.properties.chartType.enum),
  "Chart type must remain schema-constrained",
);
const chatSurface = config.productObject.surfaces.find(
  (surface) => surface.id === "ask-chat-surface",
);
assert(
  chatSurface?.config?.webmcp?.allowlist?.some((rule) =>
    rule.tools?.includes("insforge_query_and_chart"),
  ),
  "Chat surface must admit the combined browser tool",
);

const widgetConfig = readFileSync(
  join(root, "insforge/shell/src/widget-config.ts"),
  "utf8",
);
assert.match(widgetConfig, /grouped:\s*false/);
assert.match(widgetConfig, /loadingAnimation:\s*"none"/);
assert.match(widgetConfig, /"insforge_query_and_chart"/);
assert.match(widgetConfig, /"create_flint_chart"/);

const styles = readFileSync(join(root, "insforge/shell/src/style.css"), "utf8");
assert(!styles.includes("ayb-step-pulse"), "Opacity pulse reintroduced tool-call flicker");

console.log(
  `Performance contract OK: ${analyst.systemPrompt.length} prompt chars, ` +
    `${analyst.tools.maxToolCalls} max calls, stable Persona tool rows`,
);
