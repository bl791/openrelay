import { describe, expect, it } from 'vitest';
import { createTokenCipher, safeEqual } from './crypto.js';

describe('createTokenCipher', () => {
  const cipher = createTokenCipher('a-sufficiently-long-encryption-key-1234');

  it('round-trips a plaintext through encrypt/decrypt', () => {
    const plaintext = 'oauth-access-token-value';
    const encrypted = cipher.encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same');
    expect(cipher.decrypt(b)).toBe('same');
  });

  it('serializes as iv:tag:ciphertext (three base64 parts)', () => {
    const parts = cipher.encrypt('value').split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it('throws when the ciphertext is tampered with', () => {
    const encrypted = cipher.encrypt('secret');
    const [iv, tag, data] = encrypted.split(':') as [string, string, string];
    // Flip the last data byte by swapping a base64 char.
    const corrupted = `${iv}:${tag}:${data.slice(0, -2)}${data.endsWith('A') ? 'B' : 'A'}=`;
    expect(() => cipher.decrypt(corrupted)).toThrow();
  });

  it('throws when decrypted with a different key', () => {
    const other = createTokenCipher('a-totally-different-key-value-987654321');
    const encrypted = cipher.encrypt('secret');
    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('throws on a malformed serialized value', () => {
    expect(() => cipher.decrypt('not-valid')).toThrow('malformed ciphertext');
  });
});

describe('safeEqual', () => {
  it('returns true for equal strings and false otherwise', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
