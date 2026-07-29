import type { AgentWidgetInitHandle } from "@runtypelabs/persona";

let widget: AgentWidgetInitHandle | null = null;

export const getWidget = (): AgentWidgetInitHandle | null => widget;

export const setWidget = (handle: AgentWidgetInitHandle): void => {
  widget = handle;
};

export const sendPrompt = (text: string): void => {
  if (!widget) return;
  widget.submitMessage(text);
};

export const draftFollowUpFromChartClick = (params: unknown): void => {
  const { seriesName, name } = (params ?? {}) as { seriesName?: unknown; name?: unknown };
  const subject = [seriesName, name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" in ");
  if (!subject || !widget) return;
  widget.open();
  widget.setMessage(`Tell me more about ${subject} — what's driving it?`);
  widget.focusInput();
};
