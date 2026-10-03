import type { AuthCtx, KbChunkRecord, KbDocRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { AuthzService } from "./authz.js";
import type { BlobStore } from "./blob.js";
import type { EmbeddingProvider } from "./embeddings.js";
import type { OutboxService } from "./outbox.js";
import { chunkText } from "./embeddings.js";
import { extractText } from "./ruledocs.js";
import { newId } from "./ids.js";
import { notFound, validationError } from "./errors.js";
import { round } from "./prng.js";

export interface KbHit {
  text: string;
  score: number;
  docId: string;
  span: { start: number; end: number };
  source: "KB_CHUNK";
  connId: string;
}

/**
 * S4.1 knowledge_base connector adapter: docs (md/txt/pdf/docx via the A2 text
 * extraction) → ~512-token chunks (overlap 64) → EmbeddingProvider → kb_chunks
 * (VectorIndex: in-memory cosine in tests, pgvector in production).
 */
export class KbService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
    private blob: BlobStore,
    private embeddings: EmbeddingProvider,
    private outbox?: OutboxService,
  ) {}

  private async kbConnection(ctx: AuthCtx, connId: string) {
    const conn = await this.repos.connections.get(ctx.tenantId, connId);
    if (!conn) throw notFound("connection");
    if (conn.connectorTypeKey !== "knowledge_base") {
      throw validationError(`connection ${connId} is not a knowledge_base connector`);
    }
    return conn;
  }

  /** Ingest one document into a kb connection (used directly and by sync). */
  async addDoc(
    ctx: AuthCtx,
    connId: string,
    filename: string,
    content: Buffer,
  ): Promise<{ doc: KbDocRecord; chunkCount: number }> {
    await this.kbConnection(ctx, connId);
    await this.authz.require(ctx, "CONNECTION", connId, "WRITE");
    const text = await extractText(filename, content);
    const blobKey = `kb/${ctx.tenantId}/${newId("blob")}-${filename}`;
    await this.blob.put(blobKey, content);
    const doc: KbDocRecord = {
      id: newId("kbdoc"),
      tenantId: ctx.tenantId,
      connId,
      filename,
      blobKey,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
    };
    const chunks = chunkText(text);
    const vectors = await this.embeddings.embed(chunks.map((c) => c.text));
    const records: KbChunkRecord[] = chunks.map((c, i) => ({
      id: `kbch_${doc.id}_${c.seq}`,
      tenantId: ctx.tenantId,
      connId,
      docId: doc.id,
      seq: c.seq,
      text: c.text,
      span: c.span,
      embedding: vectors[i] as number[],
    }));
    await this.repos.kbChunks.upsert(records);
    doc.chunkCount = records.length;
    await this.repos.kbDocs.put(doc);
    // DF-6：知识库文档索引完成 → kb.indexed（失效 kb-search / search-test · DL10）。
    await this.outbox?.emit(
      ctx.tenantId,
      "kb.indexed",
      { connId, docId: doc.id, chunkCount: records.length, count: 1 },
      `kb:${connId}`,
    );
    return { doc, chunkCount: records.length };
  }

  /** Re-embed all stored docs of a connection (knowledge_base "sync"). */
  async sync(ctx: AuthCtx, connId: string): Promise<{ docs: number; chunks: number }> {
    await this.kbConnection(ctx, connId);
    const docs = await this.repos.kbDocs.list(ctx.tenantId, (d) => d.connId === connId);
    let chunks = 0;
    for (const doc of docs) {
      const content = await this.blob.get(doc.blobKey);
      await this.repos.kbChunks.removeByDoc(ctx.tenantId, doc.id);
      const text = await extractText(doc.filename, content);
      const parts = chunkText(text);
      const vectors = await this.embeddings.embed(parts.map((c) => c.text));
      await this.repos.kbChunks.upsert(
        parts.map((c, i) => ({
          id: `kbch_${doc.id}_${c.seq}`,
          tenantId: ctx.tenantId,
          connId,
          docId: doc.id,
          seq: c.seq,
          text: c.text,
          span: c.span,
          embedding: vectors[i] as number[],
        })),
      );
      doc.chunkCount = parts.length;
      await this.repos.kbDocs.put(doc);
      chunks += parts.length;
    }
    // DF-6：知识库连接器 sync 全量重嵌完成 → kb.indexed（失效 kb-search / search-test · DL10）。
    await this.outbox?.emit(
      ctx.tenantId,
      "kb.indexed",
      { connId, docs: docs.length, chunkCount: chunks, count: docs.length },
      `kb:${connId}`,
    );
    return { docs: docs.length, chunks };
  }

  /**
   * POST /a/v1/kb/search — tenant + PermissionPolicy filtering: results only
   * come from kb connections the caller may READ (CONNECTION resources).
   */
  async search(
    ctx: AuthCtx,
    input: { query: string; topK?: number; connId?: string },
  ): Promise<{ hits: KbHit[] }> {
    const topK = Math.min(10, Math.max(1, input.topK ?? 5));
    if (!input.query.trim()) throw validationError("query required");
    const conns = await this.repos.connections.list(
      ctx.tenantId,
      (c) => c.connectorTypeKey === "knowledge_base" && (!input.connId || c.id === input.connId),
    );
    const allowed = new Set<string>();
    for (const conn of conns) {
      const d = await this.authz.decide(ctx, "CONNECTION", conn.id, "READ");
      if (d.allowed) allowed.add(conn.id);
    }
    if (allowed.size === 0) return { hits: [] };
    const [qv] = await this.embeddings.embed([input.query]);
    const hits = await this.repos.kbChunks.search(ctx.tenantId, qv as number[], topK, (c) => allowed.has(c.connId));
    return {
      hits: hits.map((h) => ({
        text: h.chunk.text,
        score: round(h.score, 4),
        docId: h.chunk.docId,
        span: h.chunk.span,
        source: "KB_CHUNK" as const,
        connId: h.chunk.connId,
      })),
    };
  }
}
