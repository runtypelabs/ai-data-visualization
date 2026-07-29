import {
  DEFAULT_WIDGET_CONFIG,
  markdownPostprocessor,
  type AgentWidgetConfig,
} from "@runtypelabs/persona";

import { getToolActivityLabel } from "./activity";
import { renderArtifactCard } from "./artifacts";
import type { AybAuth } from "./auth";
import { API_URL, CLIENT_TOKEN, IS_SAMPLE_DATASET, PRODUCT_NAME, STARTER_PROMPTS } from "./config";
import { createTextElement } from "./dom";
import { recordSseEvent } from "./telemetry";
import { aybTheme } from "./theme";

export const buildConfig = (auth: AybAuth | null, authEnabled: boolean): AgentWidgetConfig => ({
  ...DEFAULT_WIDGET_CONFIG,
  apiUrl: API_URL,
  clientToken: CLIENT_TOKEN,
  parserType: "json",
  onSSEEvent: recordSseEvent,
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
    welcomeTitle: "Talk to your data",
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
      : "Answers are computed from live data, with the SQL shown on every chart.",
    connectedText: auth
      ? "SQL runs under your login. Postgres row-level security decides what you can see."
      : "Answers are computed from live data, with the SQL shown on every chart.",
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
  },
  contextProviders: [
    () => ({
      workspace: {
        product: PRODUCT_NAME,
        database: "InsForge Postgres (live)",
        page: "Analyst workspace",
        currentTime: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }),
  ],
  features: {
    ...DEFAULT_WIDGET_CONFIG.features,
    scrollBehavior: { mode: "follow" },
    showReasoning: false,
    showToolCalls: true,
    suggestReplies: { expose: true },
    toolCallDisplay: {
      ...DEFAULT_WIDGET_CONFIG.features?.toolCallDisplay,
      collapsedMode: "tool-name",
      activePreview: false,
      // Keep compact per-call activity rows instead of collapsing sequential
      // tool work into a single group summary.
      grouped: false,
      expandable: false,
      loadingAnimation: "none",
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
    allowlist: auth
      ? ["insforge_run_sql", "insforge_query_and_chart", "create_flint_chart"]
      : ["create_flint_chart"],
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
