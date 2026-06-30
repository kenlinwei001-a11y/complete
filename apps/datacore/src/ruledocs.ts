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
expression 使用规则 DSL（如 Order.demandDelta > 0.5，支持 AND/OR/NOT、>,>=,<,<=,==,!=、SUM/MIN/MAX/COUNT/AVG），无法形式化时置空字符串。
1C 输出纪律：严格只输出符合 schema 的 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏。
即使段落只含一条规则，也要放进 candidates 数组；段落确无可执行规则时返回 {"candidates": []}（空数组，不要省略字段）。`;

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
    // T1#1：多实例安全——抽取经 execLock 跨进程互斥（同 doc 不双跑·死实例租约过期可续跑）。
    // 可选：未注入则单实例直跑（向后兼容；内存测试默认不注入亦可，注入则走锁路径）。
    private execLocks?: import("./execlock.js").ExecutionLockService,
  ) {}

  /** T1：在途后台抽取（fire-and-forget）的句柄集——测试可 await 收敛，生产仅用于优雅停机/可观测。 */
  private pendingExtractions = new Set<Promise<unknown>>();

  /** 等待所有在途后台抽取收敛（测试用：异步路由 202 后断言候选前调用）。 */
  async flushExtractions(): Promise<void> {
    await Promise.allSettled([...this.pendingExtractions]);
  }

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
    // 同步变体（测试 / CLI 即时需要候选）：准备 + 当场跑完抽取。
    const { doc, jobId } = await this.prepareDoc(ctx, filename, content);
    const candidates = await this.runExtraction(ctx, doc.id, jobId);
    const finalDoc = (await this.repos.ruleDocs.get(ctx.tenantId, doc.id)) ?? doc;
    return { doc: finalDoc, jobId, candidates };
  }

  /**
   * T1：异步抽取入口（HTTP 路由用）。准备 doc（blob/解析/分段，进 EXTRACTING）后**立即返回**，
   * 抽取在后台跑（真打 LLM 可达数百秒·不阻塞 HTTP·不被客户端/网关超时中断）；前端轮询 doc 状态至终态。
   */
  async uploadAndStartExtraction(
    ctx: AuthCtx,
    filename: string,
    content: Buffer,
  ): Promise<{ doc: RuleDoc; jobId: string }> {
    const { doc, jobId } = await this.prepareDoc(ctx, filename, content);
    this.fireExtraction(ctx, doc.id, jobId);
    return { doc, jobId };
  }

  /**
   * fire-and-forget 后台抽取：错误兜底落 doc 状态 + 审计（绝不静默吞）；句柄入集供测试收敛/续跑。
   * T1#1 多实例安全：经 execLock(rule_extraction|docId) 跨进程互斥——同 doc 只一个实例真跑；
   * 另一实例（含本实例 resume 重复触发）命中锁即 skip 不双跑；持锁实例死亡→租约过期，下次
   * resume 可重夺续跑。未注入 execLocks 时退化为单实例直跑（向后兼容）。
   */
  private fireExtraction(ctx: AuthCtx, docId: string, jobId: string, opts: { steal?: boolean } = {}): void {
    const exec = async (): Promise<void> => {
      if (!this.execLocks) return void (await this.runExtraction(ctx, docId, jobId));
      // WO-T5-RESUME-LEASE：重启续跑传 steal——崩溃进程留下的 60min 租约必属已死进程，安全夺锁续跑
      // （fencing 防僵尸写）；常态触发不 steal，保持同 doc 跨实例互斥（skip 不双跑）。
      const r = await this.execLocks.withLock(ctx.tenantId, "rule_extraction", docId, async () => {
        await this.runExtraction(ctx, docId, jobId);
      }, { steal: opts.steal });
      if (r.skipped) this.metrics.inc("dc_rule_extract_segments_total", { status: "skipped_locked" });
    };
    const p = exec()
      .catch(async (err) => {
        this.metrics.inc("dc_rule_extract_segments_total", { status: "failed" });
        const d = await this.repos.ruleDocs.get(ctx.tenantId, docId);
        if (d && d.status === "EXTRACTING") {
          d.status = "PARTIAL";
          d.extractError = err instanceof Error ? err.message : String(err);
          await this.repos.ruleDocs.put(d);
        }
      })
      .finally(() => this.pendingExtractions.delete(p));
    this.pendingExtractions.add(p);
  }

  /**
   * T1 续跑（restart-safe）：进程重启会中断在途 fire-and-forget 抽取，doc 永久卡 EXTRACTING。
   * 启动时跨租户扫描 EXTRACTING 的 doc → 重新触发抽取（runExtraction 幂等清旧候选再跑）。
   * 单实例 docker 部署的重启续跑根因解（非分布式队列·多实例需真 job 队列另立单）。返回续跑数。
   */
  async resumeInflightExtractions(): Promise<number> {
    const tenants = await this.repos.tenants.listAll().catch(() => []);
    let resumed = 0;
    for (const t of tenants) {
      const stuck = await this.repos.ruleDocs.list(t.id, (d) => d.status === "EXTRACTING");
      for (const doc of stuck) {
        if (!doc.extractJobId) continue;
        const ctx: AuthCtx = { tenantId: t.id, userId: "system", roles: ["admin"], attributes: {} };
        // WO-T5-RESUME-LEASE：steal 夺锁——崩溃进程留下的未过期 60min 租约否则会挡住续跑、doc 卡 EXTRACTING
        // 最长 60min；新进程启动时该锁必属已死进程，安全夺取（fence+1·fencing 防僵尸写）。
        this.fireExtraction(ctx, doc.id, doc.extractJobId, { steal: true });
        resumed++;
      }
    }
    return resumed;
  }

  /** 准备阶段（确定性·快）：落 blob → 解析文本 → 分段 → 分配 extractJobId → 进 EXTRACTING。 */
  private async prepareDoc(
    ctx: AuthCtx,
    filename: string,
    content: Buffer,
  ): Promise<{ doc: RuleDoc; jobId: string }> {
    const blobKey = `rule-docs/${ctx.tenantId}/${newId("blob")}-${filename}`;
    await this.blob.put(blobKey, content);
    const extractJobId = newId("xjob");
    const text = await extractText(filename, content);
    const doc: RuleDoc = {
      id: newId("doc"),
      tenantId: ctx.tenantId,
      filename,
      blobKey,
      status: "EXTRACTING",
      droppedCandidates: 0,
      createdAt: new Date().toISOString(),
      segments: segmentText(text),
      extractJobId,
    };
    await this.repos.ruleDocs.put(doc);
    return { doc, jobId: extractJobId };
  }

  /** 抽取阶段（慢·真打 LLM）：逐段抽取（§6 段级三态，部分失败不丢已成功段落）→ 落候选 → 终态。 */
  private async runExtraction(ctx: AuthCtx, docId: string, extractJobId: string): Promise<RuleCandidate[]> {
    const doc = await this.repos.ruleDocs.get(ctx.tenantId, docId);
    if (!doc) return [];
    // 幂等：重跑（续跑/重试）先清本 doc 既有候选 + 计数复位，避免重复堆积/双计（首跑无候选→无操作）。
    for (const old of await this.repos.ruleCandidates.list(ctx.tenantId, (c) => c.docId === docId)) {
      await this.repos.ruleCandidates.remove(ctx.tenantId, old.id);
    }
    doc.droppedCandidates = 0;
    doc.extractError = undefined;
    const candidates: RuleCandidate[] = [];
    let failedSegments = 0;
    for (const segment of doc.segments ?? []) {
      try {
        const segCands = await this.extractSegment(ctx, doc, segment, extractJobId);
        candidates.push(...segCands);
        await this.recordSegment(ctx.tenantId, doc.id, segment.idx, "OK");
      } catch (err) {
        failedSegments++;
        await this.recordSegment(
          ctx.tenantId,
          doc.id,
          segment.idx,
          "FAILED",
          err instanceof Error ? err.message : String(err),
        );
        this.metrics.inc("dc_rule_extract_segments_total", { status: "failed" });
      }
    }
    await this.markDiffs(ctx, doc, candidates);
    await this.markNearDuplicates(ctx, candidates);
    for (const rc of candidates) await this.repos.ruleCandidates.put(rc);
    // §6: 任一段落失败 → PARTIAL（已成功段落候选可审，失败段落可单独重试）
    doc.status = failedSegments > 0 ? "PARTIAL" : candidates.length > 0 ? "IN_REVIEW" : "EXTRACTED";
    await this.repos.ruleDocs.put(doc);
    return candidates;
  }

  /** Extract candidates from a single segment (throws on LLM failure → caller marks FAILED). */
  private async extractSegment(
    ctx: AuthCtx,
    doc: RuleDoc,
    segment: DocSegment,
    extractJobId: string,
  ): Promise<RuleCandidate[]> {
    const out = await this.llm.parseStructured({
      model: this.model,
      maxTokens: 4096,
      // LLM Provider 增量 §1.3：A2 抽取走用途绑定（extraction），无绑定回落 env 默认
      tenantId: ctx.tenantId,
      purpose: "extraction",
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: `<segment heading="${segment.heading ?? ""}">\n${segment.text}\n</segment>` }],
      schema: ExtractionSchema,
    });
    const out_candidates: RuleCandidate[] = [];
    for (const cand of out.candidates) {
      // Server-side substring validation against the segment text (anti-hallucination).
      if (!segment.text.includes(cand.sourceQuote) || cand.sourceQuote.trim() === "") {
        doc.droppedCandidates++;
        this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "dropped" });
        continue;
      }
      this.metrics.inc("dc_rule_extract_candidates_total", { disposition: "accepted" });
      const quoteOffset = segment.text.indexOf(cand.sourceQuote);
      out_candidates.push({
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
      });
    }
    return out_candidates;
  }

  private async recordSegment(
    tenantId: string,
    docId: string,
    segNo: number,
    status: "OK" | "FAILED" | "PENDING",
    error?: string,
  ): Promise<void> {
    await this.repos.extractSegments.put({
      id: `${docId}|${segNo}`,
      tenantId,
      docId,
      segNo,
      status,
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  /** §6: list per-segment extraction status (PARTIAL task triage). */
  async listSegments(ctx: AuthCtx, docId: string) {
    return this.repos.extractSegments.list(ctx.tenantId, (s) => s.docId === docId);
  }

  /**
   * §6: retry a single failed segment. On success the segment's candidates are
   * added; if no FAILED segments remain the doc transitions out of PARTIAL.
   */
  async retrySegment(ctx: AuthCtx, docId: string, segNo: number): Promise<RuleDoc> {
    const doc = await this.repos.ruleDocs.get(ctx.tenantId, docId);
    if (!doc) throw notFound("rule doc");
    if (doc.status !== "PARTIAL") throw invalidState("doc is not in PARTIAL state");
    const segment = (doc.segments ?? []).find((s) => s.idx === segNo);
    if (!segment) throw notFound("segment");
    if (!doc.extractJobId) throw validationError("doc has no extract job");
    const fresh = await this.extractSegment(ctx, doc, segment, doc.extractJobId);
    await this.markDiffs(ctx, doc, fresh);
    await this.markNearDuplicates(ctx, fresh);
    for (const rc of fresh) await this.repos.ruleCandidates.put(rc);
    await this.recordSegment(ctx.tenantId, doc.id, segNo, "OK");
    const segs = await this.listSegments(ctx, docId);
    const stillFailed = segs.some((s) => s.status === "FAILED");
    const anyCand = (await this.repos.ruleCandidates.list(ctx.tenantId, (c) => c.docId === docId)).length > 0;
    doc.status = stillFailed ? "PARTIAL" : anyCand ? "IN_REVIEW" : "EXTRACTED";
    await this.repos.ruleDocs.put(doc);
    return doc;
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
      // 轨N 跟进3 规则 provenance（R13·规则文档抽取路径）：诚实标产出来源——A2 文档抽取经人工审核采纳，依据真实文档。
      definedBy: "规则文档抽取（A2 · 人工审核采纳）",
      basis: `规则文档 ${cand.docId}（抽取 span ${cand.span ?? "—"}）`,
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
