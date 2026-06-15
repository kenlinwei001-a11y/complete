import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

function encodeTime(ms: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomPart(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[(bytes[i] as number) % 32];
  return out;
}

/** ULID-ish: 10 chars timestamp + 16 chars randomness (monotonic enough for our use) */
export function ulid(): string {
  return encodeTime(Date.now(), 10) + randomPart(16);
}

export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
