import type { AybAuth } from "../auth";
import { API_URL } from "../config";

/**
 * Attach the Runtype-verifiable identityProof (bridge-minted ES256 JWT) to
 * every /v1/client/chat dispatch by wrapping window.fetch. This is the ONLY
 * seam that reliably reaches Persona 4.14's client-token dispatch: that code
 * path calls bare fetch() directly, so the widget's customFetch (generic mode
 * only) and requestMiddleware hooks never get the proof onto the wire.
 */
export const installProofInjector = (auth: AybAuth): void => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(API_URL) && url.includes("/v1/client/chat") && init?.method === "POST") {
      try {
        const body = JSON.parse((init.body as string) ?? "{}") as {
          messages?: unknown;
          identityProof?: unknown;
        };
        if (Array.isArray(body.messages) && !body.identityProof) {
          body.identityProof = { provider: "oidc", token: await auth.getBridgeToken() };
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Non-JSON body: pass through untouched; the server will refuse
        // un-proofed dispatches on its own (fail closed).
      }
    }
    return originalFetch(input, init);
  };
};
