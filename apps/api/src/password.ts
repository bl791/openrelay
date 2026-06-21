import argon2 from 'argon2';

/** Hash a plaintext password using argon2id with library defaults. */
export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

/** Verify a plaintext password against a stored argon2 hash. */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
