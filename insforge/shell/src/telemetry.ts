import type { AgentWidgetInitHandle } from "@runtypelabs/persona";

import { API_URL, DEBUG_TIMINGS, INSFORGE_BASE } from "./config";

type TimingDetail = Record<string, boolean | number | string | undefined>;

export type AybTimingEvent = {
  name: string;
  atMs: number;
  durationMs?: number;
  detail?: TimingDetail;
};

type AybDiagnostics = {
  startedAt: string;
  events: AybTimingEvent[];
  clear: () => void;
  print: () => void;
};

const MAX_EVENTS = 250;
const startedAt = performance.now();
const events: AybTimingEvent[] = [];
let requestTimingInstalled = false;
let activeTurn = 0;
const turnsWithText = new Set<number>();
const diagnosticsNode = DEBUG_TIMINGS ? document.createElement("script") : null;

if (diagnosticsNode) {
  diagnosticsNode.id = "ayb-timing-diagnostics";
  diagnosticsNode.type = "application/json";
  document.head.appendChild(diagnosticsNode);
}

const diagnostics: AybDiagnostics = {
  startedAt: new Date().toISOString(),
  events,
  clear: () => events.splice(0, events.length),
  print: () => console.table(events),
};

(window as Window & { __AYB_DIAGNOSTICS__?: AybDiagnostics }).__AYB_DIAGNOSTICS__ =
  diagnostics;

const pushEvent = (event: AybTimingEvent): void => {
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (diagnosticsNode) diagnosticsNode.textContent = JSON.stringify(events);
  if (DEBUG_TIMINGS) console.debug("[AYB timing]", event);
};

export const recordTiming = (name: string, detail?: TimingDetail): void => {
  pushEvent({
    name,
    atMs: Math.round((performance.now() - startedAt) * 10) / 10,
    ...(detail ? { detail } : {}),
  });
};

export const startTiming = (
  name: string,
  detail?: TimingDetail,
): ((completionDetail?: TimingDetail) => void) => {
  const start = performance.now();
  recordTiming(`${name}.start`, detail);
  return (completionDetail) => {
    pushEvent({
      name: `${name}.complete`,
      atMs: Math.round((performance.now() - startedAt) * 10) / 10,
      durationMs: Math.round((performance.now() - start) * 10) / 10,
      ...(completionDetail ? { detail: completionDetail } : {}),
    });
  };
};

const requestName = (url: string): string | null => {
  if (url.startsWith(API_URL) && url.includes("/v1/client/init")) return "request.init";
  if (url.startsWith(API_URL) && url.includes("/v1/client/chat")) return "request.chat";
  if (url.startsWith(API_URL) && url.includes("/v1/client/resume")) return "request.resume";
  if (url.startsWith(INSFORGE_BASE) && url.includes("/api/database/rpc/run_analyst_sql")) {
    return "request.sql";
  }
  return null;
};

/**
 * Records request-to-headers timing without reading or cloning response bodies.
 * The SSE milestones below measure the rest of each streamed request.
 */
export const installRequestTiming = (): void => {
  if (requestTimingInstalled) return;
  requestTimingInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const name = requestName(url);
    if (!name) return originalFetch(input, init);

    const complete = startTiming(name);
    try {
      const response = await originalFetch(input, init);
      complete({ status: response.status });
      return response;
    } catch (error) {
      complete({ error: true });
      throw error;
    }
  };
};

const SSE_MILESTONES = new Set([
  "execution_start",
  "iteration_start",
  "turn_start",
  "tool_start",
  "tool_complete",
  "tool_error",
  "await",
  "turn_complete",
  "iteration_complete",
  "execution_complete",
  "execution_error",
]);

const safeSseDetail = (payload: unknown): TimingDetail | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const outer = payload as Record<string, unknown>;
  const nested =
    outer.data && typeof outer.data === "object"
      ? (outer.data as Record<string, unknown>)
      : undefined;
  const source = nested ?? outer;
  const detail: TimingDetail = {};
  for (const key of ["iteration", "toolName", "stopReason", "success"] as const) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      detail[key] = value;
    }
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
};

export const recordSseEvent = (eventType: string, payload: unknown): void => {
  if (eventType === "turn_delta") {
    if (!turnsWithText.has(activeTurn)) {
      turnsWithText.add(activeTurn);
      recordTiming("sse.first_text", { turn: activeTurn });
    }
    return;
  }
  if (SSE_MILESTONES.has(eventType)) {
    recordTiming(`sse.${eventType}`, {
      turn: activeTurn,
      ...safeSseDetail(payload),
    });
  }
};

export const installWidgetTiming = (widget: AgentWidgetInitHandle): void => {
  let wasStreaming = widget.getState().streaming;
  widget.on("user:message", () => {
    activeTurn += 1;
    recordTiming("turn.user_message", { turn: activeTurn });
  });
  widget.on("assistant:complete", () =>
    recordTiming("message.assistant_complete", { turn: activeTurn }),
  );
  widget.on("widget:state", (state) => {
    if (state.streaming && !wasStreaming) {
      recordTiming("turn.streaming_start", { turn: activeTurn });
    } else if (!state.streaming && wasStreaming) {
      recordTiming("turn.streaming_complete", { turn: activeTurn });
    }
    wasStreaming = state.streaming;
  });
};
