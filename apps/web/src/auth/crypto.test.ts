import { describe, expect, it } from 'bun:test';

// Set a fixed SESSION_SECRET *before* importing the module under test so the
// getEnv cache picks it up. (32 random bytes, hex-encoded.)
process.env.SESSION_SECRET = 'a'.repeat(64);

const { decryptToken, encryptToken, pkceChallenge, signCookie, verifyCookie } = await import(
  './crypto'
);

describe('crypto', () => {
  it('AES-GCM round-trips a token', async () => {
    const plain = 'discord-access-token-abcdef.xyz';
    const blob = await encryptToken(plain);
    expect(blob).not.toContain(plain);
    expect(await decryptToken(blob)).toBe(plain);
  });

  it('encrypts the same plaintext to different blobs each call (random iv)', async () => {
    const a = await encryptToken('same');
    const b = await encryptToken('same');
    expect(a).not.toBe(b);
  });

  it('signCookie/verifyCookie accepts a valid signature', () => {
    const signed = signCookie('session-id-123');
    expect(verifyCookie(signed)).toBe('session-id-123');
  });

  it('verifyCookie rejects tampering', () => {
    const signed = signCookie('session-id-123');
    const [value, sig] = signed.split('.');
    const tamperedValue = `${value}x.${sig}`;
    const tamperedSig = `${value}.${sig?.slice(0, -1)}A`;
    expect(verifyCookie(tamperedValue)).toBeNull();
    expect(verifyCookie(tamperedSig)).toBeNull();
    expect(verifyCookie('nobody-signed-this')).toBeNull();
  });

  it('pkceChallenge is deterministic and base64url-safe', async () => {
    const verifier = 'fixed-verifier-for-test';
    const a = await pkceChallenge(verifier);
    const b = await pkceChallenge(verifier);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
