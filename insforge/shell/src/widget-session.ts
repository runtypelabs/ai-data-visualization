import type { AgentWidgetInitHandle } from "@runtypelabs/persona";

let widget: AgentWidgetInitHandle | null = null;

export const getWidget = (): AgentWidgetInitHandle | null => widget;

export const setWidget = (handle: AgentWidgetInitHandle): void => {
  widget = handle;
};

/**
 * True while an assistant turn is in flight. The grouped activity checklist
 * momentarily reads "all complete" between two sequential tool calls; without
 * this check the terminal "Analysis ready" row flickers on and off once per
 * query on query-heavy turns. The handle exposes no lifecycle events, so
 * infer it from the message list: mid-turn the newest message is a tool call
 * or a streaming reply.
 */
export const isTurnActive = (): boolean => {
  const messages = (widget?.getMessages() ?? []) as Array<{
    role?: string;
    streaming?: boolean;
    toolCall?: unknown;
  }>;
  const last = messages[messages.length - 1];
  if (!last) return false;
  return last.streaming === true || last.role === "user" || last.toolCall != null;
};

export const sendPrompt = (text: string): void => {
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
