/**
 * Deterministic pseudo-embedding (S4.2 增量).
 *
 * Same algorithm family as DataCore's pseudo EmbeddingProvider (deterministic
 * hash-based bag-of-ngrams → fixed-dim vector); no cross-service call needed.
 * Used for fallback_traces semantic clustering — NOT a production embedding.
 */

const DEFAULT_DIM = 256;

/** FNV-1a 32-bit hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Char unigram+bigram hashed bag, L2-normalized. Deterministic: same text → same vector. */
export function pseudoEmbed(text: string, dim = DEFAULT_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    v[fnv1a(s[i] as string) % dim] = (v[fnv1a(s[i] as string) % dim] as number) + 1;
    if (i + 1 < s.length) {
      const g = s.slice(i, i + 2);
      v[fnv1a(g) % dim] = (v[fnv1a(g) % dim] as number) + 1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Element-wise mean of vectors (cluster centroid). */
export function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = (vectors[0] as number[]).length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] = (out[i] as number) + ((v[i] as number) ?? 0);
  }
  return out.map((x) => x / vectors.length);
}
