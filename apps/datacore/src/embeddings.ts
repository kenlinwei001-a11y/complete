import type { EmbeddingProviderConfig } from "@platform/contracts";
import { hashString } from "./prng.js";

/** S4: EmbeddingProvider interface — embed(texts) → vectors (dim configurable). */
export interface EmbeddingProvider {
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Tokenize for the pseudo embedding: ascii words + CJK chars + CJK bigrams. */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = lower.match(/[a-z0-9_.]+/g) ?? [];
  const cjk = lower.match(/[一-鿿]/g) ?? [];
  tokens.push(...cjk);
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(`${cjk[i]}${cjk[i + 1]}`);
  return tokens;
}

/**
 * Deterministic hash pseudo-vector (default; used in ALL tests). Bag-of-tokens
 * hashed into `dim` buckets, L2-normalized — identical texts → similarity 1,
 * near-identical texts → > 0.92 (rule near-duplicate threshold).
 */
export class PseudoEmbeddingProvider implements EmbeddingProvider {
  constructor(public readonly dim = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dim).fill(0);
      for (const tok of tokenize(t)) {
        const idx = hashString(tok) % this.dim;
        v[idx] = (v[idx] as number) + 1;
      }
      let norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
      if (norm === 0) {
        v[0] = 1;
        norm = 1;
      }
      return v.map((x) => x / norm);
    });
  }
}

/** OpenAI-compatible embeddings endpoint: POST {baseUrl}/embeddings. Thin fetch impl, not exercised in tests. */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly dim: number,
    private baseUrl: string,
    private model: string,
    private apiKey: string | undefined,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embeddings endpoint failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }
}

/** Voyage AI embeddings: POST https://api.voyageai.com/v1/embeddings. Not exercised in tests. */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  constructor(
    public readonly dim: number,
    private model: string,
    private apiKey: string | undefined,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`voyage embeddings failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }
}

/** Selected via EMBEDDING_PROVIDER / EMBEDDING_BASE_URL / EMBEDDING_MODEL / EMBEDDING_DIM / EMBEDDING_API_KEY_ENV. */
export function createEmbeddingProvider(
  cfg: Partial<EmbeddingProviderConfig> & { kind?: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): EmbeddingProvider {
  const dim = cfg.dim ?? 1024;
  const apiKey = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined;
  switch (cfg.kind) {
    case "openai_compatible":
      if (!cfg.baseUrl) throw new Error("EMBEDDING_BASE_URL required for openai_compatible");
      return new OpenAiCompatibleEmbeddingProvider(dim, cfg.baseUrl, cfg.model ?? "text-embedding-3-small", apiKey, fetchImpl);
    case "voyage":
      return new VoyageEmbeddingProvider(dim, cfg.model ?? "voyage-3", apiKey, fetchImpl);
    case "pseudo":
    default:
      return new PseudoEmbeddingProvider(Math.min(dim, 1024));
  }
}

// ---------------------------------------------------------------------------
// Chunking (~512 tokens, overlap 64) — token = ascii word / CJK char.
// ---------------------------------------------------------------------------

export interface TextChunk {
  text: string;
  span: { start: number; end: number };
  seq: number;
}

export function chunkText(text: string, chunkTokens = 512, overlapTokens = 64): TextChunk[] {
  // token spans over the original text
  const re = /[A-Za-z0-9_]+|[一-鿿]|[^\sA-Za-z0-9一-鿿]/g;
  const spans: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length });
  if (spans.length === 0) return [];
  const chunks: TextChunk[] = [];
  let seq = 0;
  let i = 0;
  while (i < spans.length) {
    const endTok = Math.min(spans.length, i + chunkTokens);
    const start = (spans[i] as { start: number }).start;
    const end = (spans[endTok - 1] as { end: number }).end;
    chunks.push({ text: text.slice(start, end), span: { start, end }, seq: seq++ });
    if (endTok >= spans.length) break;
    i = Math.max(i + 1, endTok - overlapTokens);
  }
  return chunks;
}
