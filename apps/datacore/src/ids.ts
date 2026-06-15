import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** prefix + random suffix, e.g. conn_, doc_, draft_, job_, pol_, rule_ */
export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += ALPHABET[(bytes[i] as number) % 32];
  return `${prefix}_${s}`;
}
