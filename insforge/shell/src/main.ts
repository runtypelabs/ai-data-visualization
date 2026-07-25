/**
 * AI Data Visualization — InsForge × Runtype demo shell.
 *
 * Fullscreen Persona assistant over the staging Business Analyst agent, with a
 * Flint-chart generative-UI artifact view. The page is served by an InsForge
 * edge function; the data lives in InsForge Postgres; Runtype is the
 * intelligence. Adapted from Persona's Northstar analytics demo.
 */
import "@runtypelabs/persona/widget.css";
import "./style.css";

import { AybAuth } from "./auth";
import { renderSignInCard, renderUserChip } from "./auth-ui";
import { bootWidget, resetChat } from "./boot";
import {
  CLIENT_TOKEN,
  INSFORGE_ANON_KEY,
  INSFORGE_BASE,
  PRODUCT_NAME,
} from "./config";
import { createTextElement } from "./dom";

const mount = document.getElementById("ayb-chat-root");
if (!mount) throw new Error("#ayb-chat-root is missing.");

// Reflect the configured product name in the static header.
const brandName = document.querySelector<HTMLElement>(".ayb-brand-copy strong");
if (brandName) brandName.textContent = PRODUCT_NAME;
document.title = `${PRODUCT_NAME} — InsForge × Runtype`;

document.getElementById("ayb-reset-chat")?.addEventListener("click", resetChat);

if (!CLIENT_TOKEN || !INSFORGE_BASE) {
  // Unconfigured deployment: show setup guidance instead of a broken widget.
  const notice = document.createElement("div");
  notice.className = "ayb-setup-notice";
  notice.append(
    createTextElement("strong", "", "Almost there: this page needs its runtime config."),
    createTextElement(
      "p",
      "",
      import.meta.env.DEV
        ? "For local development, add RUNTYPE_CLIENT_TOKEN to the repo-root .env.local and restart Vite. The InsForge URL can come from INSFORGE_BASE_URL or NEXT_PUBLIC_INSFORGE_URL."
        : "The serving function must inject window.__AYB_CONFIG__ with apiUrl, clientToken (a Runtype client token bound to your chat surface), and insforgeBaseUrl. See the deploy script in the ai-data-visualization repo.",
    ),
  );
  mount.appendChild(notice);
} else if (!INSFORGE_ANON_KEY) {
  // Legacy deployment without end-user auth: original shared-analyst behavior.
  bootWidget(mount, null, false);
} else {
  const auth = new AybAuth(INSFORGE_BASE, INSFORGE_ANON_KEY);
  void auth.restore().then((user) => {
    if (user) {
      renderUserChip(auth, user);
      bootWidget(mount, auth, true);
    } else {
      renderSignInCard(
        mount,
        auth,
        (signedIn) => {
          renderUserChip(auth, signedIn);
          bootWidget(mount, auth, true);
        },
        () => bootWidget(mount, null, true),
      );
    }
  });
}
