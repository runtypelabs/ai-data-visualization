import { createTextElement } from "./dom";
import { isTurnActive } from "./widget-session";

const TOOL_ACTIVITY: Record<string, readonly [active: string, complete: string]> = {
  insforge_list_tables: ["Scanning the live database", "Scanned the live database"],
  insforge_run_sql: ["Running SQL under your login", "Ran SQL under your login"],
  create_flint_chart: ["Assembling your dashboard", "Assembled your dashboard"],
  set_reminder: ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  get_current_time: ["Checking the clock", "Checked the clock"],
  "Get Current Time": ["Checking the clock", "Checked the clock"],
  "Set Reminder": ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  runtype_record_upsert: ["Saving the analysis snapshot", "Saved the analysis snapshot"],
  runtype_record_get: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
  runtype_record_list: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
};

export const getToolActivityLabel = (
  toolName: string | undefined,
): readonly [active: string, complete: string] | undefined => {
  const bareName = toolName?.replace(/^webmcp:/, "");
  return bareName ? TOOL_ACTIVITY[bareName] : undefined;
};

// Visually hidden live region: sighted users read progress from the grouped
// activity checklist; screen readers hear the same updates here.
const statusAnnouncer = createTextElement("div", "ayb-sr-status", "");
statusAnnouncer.setAttribute("role", "status");
document.body.appendChild(statusAnnouncer);

const announceStatus = (text: string): void => {
  if (statusAnnouncer.textContent !== text) statusAnnouncer.textContent = text;
};

export const renderGroupedToolActivity = (
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
