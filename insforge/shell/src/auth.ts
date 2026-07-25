/**
 * InsForge end-user auth for the AI Data Visualization shell.
 *
 * Wraps the InsForge auth REST surface (web client flow: httpOnly refresh
 * cookie + CSRF token) and the ayb-identity token bridge that re-mints the
 * native RS256 access token as an ES256 identityProof Runtype can verify.
 *
 * Native access tokens live 900s; the bridge token 600s. Both are refreshed
 * on demand with a safety margin, so callers just ask for a fresh token
 * before each use.
 */

export interface AybUser {
  id: string;
  email: string;
  name?: string;
}

interface SessionState {
  accessToken: string;
  /** ms epoch of the native token's exp claim */
  accessTokenExpiresAt: number;
  user: AybUser;
}

interface BridgeState {
  token: string;
  /** ms epoch */
  expiresAt: number;
}

const CSRF_STORAGE_KEY = "ayb-auth-csrf";
const REFRESH_MARGIN_MS = 60_000;

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const payload = token.split(".")[1] ?? "";
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(normalized)) as Record<string, unknown>;
};

const tokenExpiryMs = (token: string): number => {
  const { exp } = decodeJwtPayload(token);
  return typeof exp === "number" ? exp * 1000 : Date.now();
};

export class AybAuth {
  private session: SessionState | null = null;
  private bridge: BridgeState | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly anonKey: string,
  ) {}

  get user(): AybUser | null {
    return this.session?.user ?? null;
  }

  get nativeAccessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.anonKey}`,
      "Content-Type": "application/json",
    };
  }

  private adoptSession(payload: {
    accessToken?: string | null;
    csrfToken?: string | null;
    user?: { id?: string; email?: string; name?: string } | null;
  }): void {
    if (!payload.accessToken) throw new Error("No access token in auth response.");
    const claims = decodeJwtPayload(payload.accessToken);
    const user: AybUser = {
      id: payload.user?.id ?? String(claims.sub ?? ""),
      email: payload.user?.email ?? String(claims.email ?? ""),
      name: payload.user?.name ?? undefined,
    };
    if (!user.id) throw new Error("Auth response has no user id.");
    this.session = {
      accessToken: payload.accessToken,
      accessTokenExpiresAt: tokenExpiryMs(payload.accessToken),
      user,
    };
    this.bridge = null;
    if (payload.csrfToken) {
      localStorage.setItem(CSRF_STORAGE_KEY, payload.csrfToken);
    }
  }

  /** Try to restore a session from the refresh cookie. Null when signed out. */
  async restore(): Promise<AybUser | null> {
    const csrf = localStorage.getItem(CSRF_STORAGE_KEY);
    if (!csrf) return null;
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh?client_type=web`, {
        method: "POST",
        headers: { ...this.authHeaders(), "X-CSRF-Token": csrf },
        credentials: "include",
      });
      if (!response.ok) {
        localStorage.removeItem(CSRF_STORAGE_KEY);
        return null;
      }
      this.adoptSession(await response.json());
      return this.user;
    } catch {
      return null;
    }
  }

  async signIn(email: string, password: string): Promise<AybUser> {
    const response = await fetch(`${this.baseUrl}/api/auth/sessions?client_type=web`, {
      method: "POST",
      headers: this.authHeaders(),
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (response.status === 401) throw new Error("Wrong email or password.");
      if (response.status === 403) {
        throw new Error("This account's email is not verified yet.");
      }
      throw new Error(body?.message ?? body?.error ?? `Sign-in failed (${response.status}).`);
    }
    this.adoptSession(await response.json());
    if (!this.user) throw new Error("Sign-in returned no user.");
    return this.user;
  }

  async signOut(): Promise<void> {
    const token = this.session?.accessToken;
    this.session = null;
    this.bridge = null;
    localStorage.removeItem(CSRF_STORAGE_KEY);
    if (token) {
      // Best-effort server-side session teardown; local state is already gone.
      await fetch(`${this.baseUrl}/api/auth/sessions/current`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      }).catch(() => undefined);
    }
  }

  /** Native InsForge access token, refreshed when within the safety margin. */
  async getFreshAccessToken(): Promise<string> {
    if (!this.session) throw new Error("Not signed in.");
    if (Date.now() < this.session.accessTokenExpiresAt - REFRESH_MARGIN_MS) {
      return this.session.accessToken;
    }
    const restored = await this.restore();
    if (!restored || !this.session) throw new Error("Your session expired. Sign in again.");
    return this.session.accessToken;
  }

  /**
   * Runtype-verifiable identityProof token from the ayb-identity bridge,
   * cached until its own expiry margin.
   */
  async getBridgeToken(): Promise<string> {
    if (this.bridge && Date.now() < this.bridge.expiresAt - REFRESH_MARGIN_MS) {
      return this.bridge.token;
    }
    const nativeToken = await this.getFreshAccessToken();
    const response = await fetch(`${this.baseUrl}/functions/ayb-identity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${nativeToken}` },
    });
    if (!response.ok) {
      throw new Error(`Identity bridge rejected the session (${response.status}).`);
    }
    const body = (await response.json()) as { token: string; expiresAt: string };
    this.bridge = { token: body.token, expiresAt: Date.parse(body.expiresAt) };
    return this.bridge.token;
  }
}
