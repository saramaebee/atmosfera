import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@atmosfera/config';

function secretBytes(): Buffer {
  const hex = getEnv().SESSION_SECRET;
  if (!hex) throw new Error('SESSION_SECRET not set');
  return Buffer.from(hex, 'hex');
}

export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretBytes(), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // WebCrypto's AES-GCM appends the 16-byte tag to the ciphertext.
  return Buffer.concat([iv, Buffer.from(cipher)]).toString('base64url');
}

export async function decryptToken(blob: string): Promise<string> {
  const buf = Buffer.from(blob, 'base64url');
  if (buf.length < 12 + 16) throw new Error('decryptToken: blob too short');
  const iv = buf.subarray(0, 12);
  const ct = buf.subarray(12);
  const key = await crypto.subtle.importKey('raw', secretBytes(), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

/** Sign a value with HMAC-SHA256. Output: `${value}.${sig}` (both base64url). */
export function signCookie(value: string): string {
  const sig = createHmac('sha256', secretBytes()).update(value).digest('base64url');
  return `${value}.${sig}`;
}

export function verifyCookie(signed: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const presented = signed.slice(dot + 1);
  const expected = createHmac('sha256', secretBytes()).update(value).digest('base64url');
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}

/**
 * PKCE: base64url(SHA-256(verifier)).
 * The verifier itself is a random URL-safe string.
 */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}
