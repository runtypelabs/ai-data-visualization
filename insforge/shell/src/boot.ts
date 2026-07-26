import { initAgentWidget } from "@runtypelabs/persona";

import { registerArtifactComponents, showOnboardingArtifact } from "./artifacts";
import type { AybAuth } from "./auth";
import { installCodeBlockCopyButtons } from "./enhancements/code-copy";
import { installProofInjector } from "./enhancements/proof-injector";
import { installSuggestionScrollAffordance } from "./enhancements/suggestion-scroll";
import { registerPageTools } from "./tools";
import { installRequestTiming, installWidgetTiming } from "./telemetry";
import { buildConfig } from "./widget-config";
import { getWidget, setWidget } from "./widget-session";

// Persona persists the conversation (including the server session whose
// conversation record is scope-claimed by the first verified user) per origin.
// If a DIFFERENT user signs in on the same browser, replaying that
// conversation would be refused by Runtype with `conversation_scope_mismatch`
// (fail closed — never another user's history). Reset the widget conversation
// whenever the signed-in user changes so each user starts their own session.
// A null last-user also resets: a conversation persisted from the pre-auth
// shell (or a signed-out visit) must not carry into a verified session.
const LAST_USER_STORAGE_KEY = "ayb-last-user-id";

registerArtifactComponents();

export const bootWidget = (mount: HTMLElement, auth: AybAuth | null, authEnabled: boolean): void => {
  if (auth) installProofInjector(auth);
  installRequestTiming();
  registerPageTools(auth);
  installCodeBlockCopyButtons(mount);
  installSuggestionScrollAffordance(mount);
  setWidget(
    initAgentWidget({
      target: mount,
      useShadowDom: false,
      windowKey: "aybAnalyst",
      config: buildConfig(auth, authEnabled),
    }),
  );

  const widget = getWidget();
  if (!widget) return;
  installWidgetTiming(widget);

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

export const resetChat = (): void => {
  getWidget()?.clearChat();
  window.setTimeout(showOnboardingArtifact, 250);
};
