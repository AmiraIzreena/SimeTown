import { createPrivateKey, createPublicKey, sign as rsaSign, verify as rsaVerify, type JsonWebKey } from 'node:crypto';

/**
 * The little of JSON Web Tokens that OpenID Connect needs: RS256 signing (for
 * the simulated identity provider) and RS256 verification against a key set
 * (for any provider). Nothing else is accepted: no "none", no HMAC, no other
 * algorithm, so a token cannot choose a weaker check for itself.
 */

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

export interface JwtClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  amr?: string[];
  [claim: string]: unknown;
}

export function signJwt(claims: JwtClaims, privatePem: string, kid: string): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(claims));
  const signature = rsaSign('RSA-SHA256', Buffer.from(`${header}.${body}`), createPrivateKey(privatePem));
  return `${header}.${body}.${b64url(signature)}`;
}

/** Verifies the signature only. The caller checks issuer, audience, expiry and nonce. */
export function verifyJwtSignature(token: string, keys: (JsonWebKey & { kid?: string })[]): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Not a signed token.');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('Only RS256 tokens are accepted.');
  const key = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!key || key.kty !== 'RSA') throw new Error('The token was signed with an unknown key.');
  const ok = rsaVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('The token signature is not valid.');
  return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as JwtClaims;
}
