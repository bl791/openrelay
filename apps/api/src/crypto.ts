import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for OAuth tokens stored at rest. AES-256-GCM gives both
 * confidentiality and tamper detection (the auth tag is verified on decrypt, so
 * any modification of the stored value throws). The serialized form is
 * `iv:tag:ciphertext`, each part base64. The key may be any non-empty string;
 * it is hashed with SHA-256 to derive the required 32-byte key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM.
const TAG_LENGTH = 16;

/** Derive a 32-byte AES key from arbitrary key material. */
function deriveKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}

/**
 * A bound encrypt/decrypt pair using a fixed key. Construct once (e.g. from
 * `config.twitch.tokenEncryptionKey`) and reuse for every token.
 */
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(serialized: string): string;
}

/** Build a {@link TokenCipher} from arbitrary key material. */
export function createTokenCipher(keyMaterial: string): TokenCipher {
  const key = deriveKey(keyMaterial);
  return {
    encrypt(plaintext: string): string {
      return encrypt(plaintext, key);
    },
    decrypt(serialized: string): string {
      return decrypt(serialized, key);
    },
  };
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decrypt(serialized: string, key: Buffer): string {
  const parts = serialized.split(':');
  if (parts.length !== 3) {
    throw new Error('malformed ciphertext');
  }
  const [ivPart, tagPart, dataPart] = parts as [string, string, string];
  const iv = Buffer.from(ivPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');
  const ciphertext = Buffer.from(dataPart, 'base64');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('malformed ciphertext');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  // `final()` throws if the auth tag does not verify (tampering/wrong key).
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Constant-time string comparison helper, exported for callers that need to
 * compare opaque tokens without leaking length/content via timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
