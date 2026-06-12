import { createRequire } from "node:module";
import { z } from "zod";
import { CandidateRuleSchema, type CandidateRule } from "@platform/contracts";
import type { AuthCtx, DocSegment, RuleCandidate, RuleDoc } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { BlobStore } from "./blob.js";
import type { LlmClient } from "./llm.js";
import type { Metrics } from "./metrics.js";
import type { RulesService } from "./rules.js";
import { newId } from "./ids.js";
import { invalidState, notFound, validationError } from "./errors.js";

const require_ = createRequire(import.meta.url);

const ExtractionSchema = z.object({ candidates: z.array(CandidateRuleSchema) });

const EXTRACTION_SYSTEM = `你是企业规则抽取器。只抽取可执行的约束/阈值/审批要求，不抽取叙述性内容。
对每个文本段落输出 0..n 条候选规则。sourceQuote 必须逐字摘录输入文本的子串（服务端会做子串校验，不通过的候选会被丢弃）。
expression 使用规则 DSL（如 Order.demandDelta > 0.5，支持 AND/OR/NOT、>,>=,<,<=,==,!=、SUM/MIN/MAX/COUNT/AVG），无法形式化时置空字符串。`;

/** Extract plain text from pdf/docx/md/txt buffers. */
export async function extractText(filename: string, buf: Buffer): Promise<string> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") {
    // Import the lib entry directly: pdf-parse's index.js runs debug code when
    // loaded without a CJS parent.
    const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as (b: Buffer) => Promise<{ text: string }>;
    return (await pdfParse(buf)).text;
  }
  if (ext === "docx") {
    const mammoth = require_("mammoth") as { extractRawText(o: { buffer: Buffer }): Promise<{ value: string }> };
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (ext === "md" || ext === "txt") return buf.toString("utf8");
  throw validationError(`unsupported rule-doc extension .${ext} (pdf/docx/md/txt)`);
}

/** Segment by headings/paragraphs, keeping spanStart/spanEnd offsets into the full text. */
export function segmentText(text: string): DocSegment[] {
  const segments: DocSegment[] = [];
  const parts = text.split(/\n\s*\n/);
  let offset = 0;
  let heading: string | undefined;
  let idx = 0;
  for (const part of parts) {
    const start = text.indexOf(part, offset);
    const end = start + part.length;
    offset = end;
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Headings: markdown #-prefixed lines or short "第X章/第X节" chapter titles.
    // ("第X条" items are CONTENT — they carry the actual constraints.)
    const headingMatch = /^(#{1,6}\s+.+|第[一二三四五六七八九十\d]+[章节]\s*\S{0,20})$/m.exec(
      trimmed.split("\n")[0] ?? "",
    );
    if (headingMatch && trimmed.split("\n").length === 1 && trimmed.length < 40) {
      heading = trimmed.replace(/^#+\s*/, "");
      continue;
    }
    segments.push({ idx: idx++, heading, text: part, spanStart: start, spanEnd: end });
  }
  return segments;
}

/** Dice coefficient over character bigrams — used for re-upload diffs by name similarity. */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [bg, n] of A) {
    overlap += Math.min(n, B.get(bg) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * A2 pipeline: UPLOADED → PARSED → EXTRACTED → IN_REVIEW → PUBLISHED/REJECTED.
 * sourceQuote substring validation happens server-side; failing candidates are
 * dropped and counted (dc_rule_extract_candidates_total{disposition="dropped"}).
 */
export class RuleDocService {
  constructor(
    private repos: Repos,
    private blob: BlobStore,
    private llm: LlmClient,
    private rules: RulesService,
    private metrics: Metrics,
    private model: string,
    private embeddings?: import("./embeddings.js").EmbeddingProvider,
  ) {}

  private async dupThreshold(tenantId: string): Promise<number> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    const t = (rec?.params as { dupSimilarityThreshold?: number } | undefined)?.dupSimilarityThreshold;
    return typeof t === "number" ? t : 0.92;
  }

  /** S4.2: embed name+expression; similarity > threshold vs a PUBLISHED rule → 疑似重复. */
  private async markNearDuplicates(ctx: AuthCtx, candidates: RuleCandidate[]): Promise<void> {
    if (!this.embeddings || candidates.length === 0) return;
    const published = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    if (published.length === 0) return;
    const threshold = await this.dupThreshold(ctx.tenantId);
    const ruleTexts = published.map((r) => `${r.name} ${r.expression}`);
    const candTexts = candidates.map((c) => `${c.candidate.name} ${c.candidate.expression}`);
    const [ruleVecs, candVecs] = [
      await this.embeddings.embed(ruleTexts),
      await this.embeddings.embed(candTexts),
    ];
    const { cosineSimilarity } = await import("./repo/memory.js");
    for (let i = 0; i < candidates.length; i++) {
      let best = -1;
      let bestIdx = -1;
      for (let j = 0; j < published.length; j++) {
        const s = cosineSimilarity(candVecs[i] as number[], ruleVecs[j] as number[]);
        if (s > best) {
          best = s;
          bestIdx = j;
        }
      }
      if (best > threshold && bestIdx >= 0) {
        const rule = published[bestIdx] as (typeof published)[number];
        (candidates[i] as RuleCandidate).suspectedDuplicateOf = {
          ruleId: rule.id,
          ruleKey: rule.key,
          similarity: Math.round(best * 10000) / 10000,
        };
      }
    }
  }

  async uploadAndProcess(
    ctx: AuthCtx,
    filename: string,
    content: Buffer,
  ): Promise<{ doc: RuleDoc; jobId: string; candidates: RuleCandidate[] }> {
    const blobKey = `rule-docs/${ctx.tenantId}/${newId("blob")}-${filename}`;
    await this.blob.put(blobKey, content);
    const doc: RuleDoc = {
      id: newId("doc"),
      tenantId: ctx.tenantId,
      filename,
      blobKey,
      status: "UPLOADED",
      droppedCandidates: 0,
      createdAt: new Date().toISOString(),
    };
    await this.repos.ruleDocs.put(doc);

    // PARSED
    const text = await extractText(filename, content);
    doc.segments = segmentText(text);
    doc.status = "PARSED";
    await this.repos.ruleDocs.put(doc);

    // EXTRACTED
    const extractJobId = newId("xjob");
    doc.extractJobId = extractJobId;
    const candidates: RuleCandidate[] = [];
    for (const segment of doc.segments) {
      const out = await this.llm.parseStructured({
        model: this.model,
        maxTokens: 4096,
        system: EXTRACTION_SYSTEM,
        messages: [{ role: "user", content: `<segment heading="${segment.heading ?? ""}">\n${segment.text}\n</segment>` }],
        schema: ExtractionSchema,
      });
      for (const cand of out.candidates) {
        // Server-side substring validation against the segment text (anti-hallucination).
        if (!segment.text.includes(cand.sourceQuote) || cand.sourceQuote.trim() === "") {
          doc.droppedCandidates++;
          this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "dropped" });
          continue;
        }
        this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "accepted" });
        const quoteOffset = segment.text.indexOf(cand.sourceQuote);
        const rc: RuleCandidate = {
          id: newId("cand"),
          tenantId: ctx.tenantId,
          docId: doc.id,
          extractJobId,
          segmentIdx: segment.idx,
          span: {
            start: segment.spanStart + quoteOffset,
            end: segment.spanStart + quoteOffset + cand.sourceQuote.length,
          },
          candidate: cand,
          status: "PENDING",
        };
        candidates.push(rc);
      }
    }
    await this.markDiffs(ctx, doc, candidates);
    await this.markNearDuplicates(ctx, candidates);
    for (const rc of candidates) await this.repos.ruleCandidates.put(rc);
    doc.status = candidates.length > 0 ? "IN_REVIEW" : "EXTRACTED";
    await this.repos.ruleDocs.put(doc);
    return { doc, jobId: extractJobId, candidates };
  }

  /** Re-upload diff by name similarity: 新增 / 变更 / 疑似删除. */
  private async markDiffs(ctx: AuthCtx, doc: RuleDoc, fresh: RuleCandidate[]): Promise<void> {
    const previousDocs = await this.repos.ruleDocs.list(
      ctx.tenantId,
      (d) => d.filename === doc.filename && d.id !== doc.id,
    );
    if (previousDocs.length === 0) return;
    const prevIds = new Set(previousDocs.map((d) => d.id));
    const prevCands = await this.repos.ruleCandidates.list(ctx.tenantId, (c) => prevIds.has(c.docId));
    const matchedPrev = new Set<string>();
    for (const rc of fresh) {
      let best: RuleCandidate | undefined;
      let bestScore = 0;
      for (const prev of prevCands) {
        const score = nameSimilarity(rc.candidate.name, prev.candidate.name);
        if (score > bestScore) {
          bestScore = score;
          best = prev;
        }
      }
      if (best && bestScore >= 0.6) {
        matchedPrev.add(best.id);
        rc.diff =
          best.candidate.expression === rc.candidate.expression &&
          best.candidate.severity === rc.candidate.severity
            ? undefined
            : "变更";
      } else {
        rc.diff = "新增";
      }
    }
    for (const prev of prevCands) {
      if (!matchedPrev.has(prev.id) && prev.status === "APPROVED") {
        await this.repos.ruleCandidates.put({ ...prev, diff: "疑似删除" });
      }
    }
  }

  async getDoc(ctx: AuthCtx, id: string): Promise<RuleDoc> {
    const doc = await this.repos.ruleDocs.get(ctx.tenantId, id);
    if (!doc) throw notFound("rule doc");
    return doc;
  }

  async listCandidates(ctx: AuthCtx, docId: string, status?: string): Promise<RuleCandidate[]> {
    return this.repos.ruleCandidates.list(
      ctx.tenantId,
      (c) => c.docId === docId && (status ? c.status === status : true),
    );
  }

  /** Review: APPROVE / EDIT_APPROVE / REJECT. Approval publishes into A5 with origin backlink. */
  async review(
    ctx: AuthCtx,
    candidateId: string,
    action: "APPROVE" | "EDIT_APPROVE" | "REJECT",
    patch?: Partial<Pick<CandidateRule, "name" | "expression" | "scopeObjectTypes" | "severity" | "description">>,
  ): Promise<RuleCandidate> {
    const cand = await this.repos.ruleCandidates.get(ctx.tenantId, candidateId);
    if (!cand) throw notFound("rule candidate");
    if (cand.status !== "PENDING") throw invalidState(`candidate already ${cand.status}`);
    if (action === "REJECT") {
      cand.status = "REJECTED";
      this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "rejected" });
      await this.repos.ruleCandidates.put(cand);
      await this.maybeFinalizeDoc(ctx, cand.docId);
      return cand;
    }
    const effective: CandidateRule = {
      ...cand.candidate,
      ...(action === "EDIT_APPROVE" ? patch : {}),
    };
    const rule = await this.rules.create(ctx, {
      key: effective.name.replace(/\s+/g, "_").slice(0, 64),
      name: effective.name,
      description: effective.description,
      expression: effective.expression,
      scopeObjectTypes: effective.scopeObjectTypes,
      severity: effective.severity,
      origin: { type: "DOCUMENT", docId: cand.docId, span: cand.span, extractJobId: cand.extractJobId },
      status: "PUBLISHED",
    });
    cand.status = "APPROVED";
    cand.candidate = effective;
    cand.publishedRuleId = rule.id;
    this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "approved" });
    await this.repos.ruleCandidates.put(cand);
    await this.maybeFinalizeDoc(ctx, cand.docId);
    return cand;
  }

  private async maybeFinalizeDoc(ctx: AuthCtx, docId: string): Promise<void> {
    const doc = await this.getDoc(ctx, docId);
    const cands = await this.listCandidates(ctx, docId);
    if (cands.some((c) => c.status === "PENDING")) return;
    const approved = cands.filter((c) => c.status === "APPROVED").length;
    doc.status = approved > 0 ? "PUBLISHED" : "REJECTED";
    await this.repos.ruleDocs.put(doc);
  }
}
