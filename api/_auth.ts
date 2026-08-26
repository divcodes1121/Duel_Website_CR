import type { VercelRequest } from '@vercel/node';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Who is calling, from a Supabase access token.
 *
 * REPLACES `sha256(username:password)`. That scheme worked while there were 20
 * fixed accounts whose hashes could be inlined here, and it stopped working the
 * moment real signup existed: there is no list to check a new user against, and
 * the hash was never a token — it was a password derivative being used as a
 * bearer credential, so it never expired and could not be revoked.
 *
 * VERIFIED LOCALLY, NOT BY ASKING SUPABASE. The project signs with ES256 and
 * publishes its public keys at the JWKS endpoint, so the signature can be
 * checked here. `createRemoteJWKSet` fetches once and caches, and re-fetches
 * only when a token arrives with an unseen `kid` — which is what makes key
 * rotation work without a deploy. Calling `/auth/v1/user` per request would
 * also work and would add a network round trip to every deck save.
 *
 * WHAT THIS DOES NOT DO: it does not check the user still exists, or has not
 * been banned since the token was issued. Access tokens are short-lived (one
 * hour by default) and the refresh is what revokes, so the window is bounded.
 * Anything that must revoke instantly needs a database read, not a JWT.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';

/* Module scope on purpose: a warm Vercel function reuses it, so the JWKS is
   fetched once per container rather than once per request. */
const jwks = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

export interface Caller {
  /** The Supabase user id. Stable for the life of the account. */
  id: string;
  email: string | null;
}

export async function callerFrom(req: VercelRequest): Promise<Caller | null> {
  if (!jwks) return null;
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      /* `authenticated` is what Supabase puts in `aud` for a signed-in user.
         Pinning it stops a token minted for some other audience — a service
         token, or another project's — from being accepted here. */
      audience: 'authenticated',
    });
    const id = typeof payload.sub === 'string' ? payload.sub : null;
    if (!id) return null;
    return { id, email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    /* Expired, wrong signature, wrong issuer, malformed. All the same answer:
       we do not say which, because the difference is only useful to someone
       probing. */
    return null;
  }
}

/** True when the app is configured for real accounts at all. */
export const authConfigured = Boolean(SUPABASE_URL);
