// ayb-identity — identity token bridge for Runtype Identity Exchange (Deno).
//
// InsForge's native user JWTs are RS256 with a public JWKS, but carry no `iss`
// or `aud` claim. Runtype's oidc-jwt verifier deliberately requires both
// (fail-closed against issuer confusion / cross-service replay), so the native
// token cannot be presented as an identityProof directly. This function is the
// bridge: it verifies a native InsForge access token against the project's own
// JWKS, then re-mints a short-lived ES256 JWT with pinned iss/aud that Runtype
// CAN verify. The crypto chain stays honest end to end:
//
//   browser ──native RS256 token──▶ ayb-identity ──verify vs project JWKS──┐
//                                        │                                │
//   Runtype ◀──identityProof (ES256, iss/aud pinned, bridge JWKS)──mint◀──┘
//
// Endpoints (single function URL):
//   POST   Authorization: Bearer <native access token>  -> { token, expiresAt }
//   GET ?jwks=1                                         -> { keys: [...] }  (public)
//
// The ES256 signing key self-provisions on first use into ayb_bridge_signing_keys
// (RLS enabled, zero policies, zero grants -> admin-plane only; the function
// reads it with its auto-provisioned project API key). If two cold isolates race
// the first provision, both keys land in the table: JWKS serves every public key
// and signing uses the earliest row, so verification never breaks.
import * as jose from 'https://esm.sh/jose@6.0.11?bundle&target=denonext';

const PROJECT_BASE = 'https://8gx9k5sx.us-east.insforge.app';
const SELF_URL = `${PROJECT_BASE}/functions/ayb-identity`;
const ISSUER = SELF_URL;
const AUDIENCE = 'runtype-ayb';
const BRIDGE_TOKEN_TTL_SEC = 600; // < native 900s TTL; Runtype re-verifies per request
const KEY_TABLE = 'ayb_bridge_signing_keys';

const nativeJwks = jose.createRemoteJWKSet(new URL(`${PROJECT_BASE}/.well-known/jwks.json`));

async function runSql(query, params = []) {
  const response = await fetch(`${PROJECT_BASE}/api/database/advance/rawsql`, {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok) throw new Error(`sql ${response.status}: ${await response.text()}`);
  return (await response.json()).rows;
}

// Cached per isolate: { privateKey (CryptoKey), kid, publicJwks (all rows) }.
let signerPromise = null;

async function provisionSigner() {
  const existing = await runSql(
    `SELECT kid, private_jwk, public_jwk FROM ${KEY_TABLE} ORDER BY created_at ASC`,
  );
  if (existing.length === 0) {
    const { publicKey, privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
    const publicJwk = await jose.exportJWK(publicKey);
    const privateJwk = await jose.exportJWK(privateKey);
    const kid = `ayb-${crypto.randomUUID().slice(0, 8)}`;
    publicJwk.kid = kid;
    publicJwk.alg = 'ES256';
    publicJwk.use = 'sig';
    await runSql(
      `INSERT INTO ${KEY_TABLE} (kid, private_jwk, public_jwk) VALUES ($1, $2::jsonb, $3::jsonb)`,
      [kid, JSON.stringify(privateJwk), JSON.stringify(publicJwk)],
    );
    return provisionSigner(); // re-read so a provision race converges on the earliest row
  }
  const signing = existing[0];
  const privateKey = await jose.importJWK(signing.private_jwk, 'ES256');
  return {
    privateKey,
    kid: signing.kid,
    publicJwks: existing.map((row) => row.public_jwk),
  };
}

function getSigner() {
  if (!signerPromise) {
    signerPromise = provisionSigner().catch((error) => {
      signerPromise = null; // let the next request retry a failed cold start
      throw error;
    });
  }
  return signerPromise;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

export default async function (request) {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'GET') {
      if (url.searchParams.has('jwks')) {
        const signer = await getSigner();
        // Public keys only; cacheable so Runtype's verifier can poll cheaply.
        return jsonResponse(
          { keys: signer.publicJwks },
          200,
          { 'Cache-Control': 'public, max-age=300' },
        );
      }
      return jsonResponse({
        service: 'ayb-identity token bridge',
        issuer: ISSUER,
        audience: AUDIENCE,
        jwks: `${SELF_URL}?jwks=1`,
        exchange: `POST ${SELF_URL} with Authorization: Bearer <InsForge access token>`,
      });
    }

    if (request.method === 'POST') {
      const authorization = request.headers.get('Authorization') ?? '';
      const nativeToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
      if (!nativeToken) {
        return jsonResponse({ error: 'Missing Authorization: Bearer <access token>' }, 401);
      }

      // Verify the native token against the project's own JWKS. Native tokens
      // carry no iss/aud, so the project JWKS is the sole (sufficient) trust
      // anchor: only InsForge's private key produces a token that verifies here.
      let payload;
      try {
        ({ payload } = await jose.jwtVerify(nativeToken, nativeJwks, { algorithms: ['RS256'] }));
      } catch {
        return jsonResponse({ error: 'Invalid or expired InsForge access token' }, 401);
      }
      if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) {
        return jsonResponse({ error: 'Token is not an authenticated user session' }, 401);
      }

      const signer = await getSigner();
      const nowSec = Math.floor(Date.now() / 1000);
      const expSec = nowSec + BRIDGE_TOKEN_TTL_SEC;
      const token = await new jose.SignJWT({
        email: typeof payload.email === 'string' ? payload.email : undefined,
        role: payload.role,
      })
        .setProtectedHeader({ alg: 'ES256', kid: signer.kid, typ: 'JWT' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(payload.sub)
        .setIssuedAt(nowSec)
        .setExpirationTime(expSec)
        .sign(signer.privateKey);

      return jsonResponse({ token, expiresAt: new Date(expSec * 1000).toISOString() });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return jsonResponse({ error: String(error?.message ?? error) }, 500);
  }
}
