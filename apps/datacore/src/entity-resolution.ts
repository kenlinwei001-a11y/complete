import type { MergeCandidate, MergeCandidateView, ObjectMerge } from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import { newId } from "./ids.js";
import { notFound, validationError } from "./errors.js";

const UNMERGE_WINDOW_MS = 72 * 60 * 60 * 1000;

/** 归一名称：去空白/标点、小写——确定性匹配键（R6）。 */
function normName(props: Record<string, unknown>): string {
  const raw = String(props.name ?? props.displayName ?? props.title ?? "");
  return raw.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * 实体解析与黄金记录（OC1）：多源同实体 → 匹配产出候选 → 人审合并（golden 存活、被并置
 * mergedInto、links 重指 golden）→ 检索/切片/聚合只见 golden；72h 内可 unmerge 还原。
 * 确定性匹配（归一名称一致，R6），不调网络/LLM。
 */
export class EntityResolutionService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
  ) {}

  /** 增量扫描：按归一名称分组，≥2 个未合并对象同名 → 产候选（score=名称一致度）。 */
  async scan(ctx: AuthCtx, typeKey: string): Promise<MergeCandidate[]> {
    const objs = (await this.repos.objects.listByType(ctx.tenantId, typeKey)).filter((o) => !o.mergedInto);
    const groups = new Map<string, ObjectInstance[]>();
    for (const o of objs) {
      const k = normName(o.props);
      if (!k) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
    }
    const existing = await this.repos.mergeCandidates.list(ctx.tenantId, (c) => c.status === "PENDING" && c.typeKey === typeKey);
    const seen = new Set(existing.map((c) => c.objectIds.slice().sort().join("|")));
    const created: MergeCandidate[] = [];
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      const objectIds = members.map((m) => m.id).sort();
      const key = objectIds.join("|");
      if (seen.has(key)) continue;
      const cand: MergeCandidate = {
        id: newId("mc"),
        tenantId: ctx.tenantId,
        typeKey,
        objectIds,
        score: 1, // 归一名称完全一致
        rule: "归一名称完全一致",
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      await this.repos.mergeCandidates.put(cand);
      await this.outbox.emit(ctx.tenantId, "merge_candidate.created", { candidateId: cand.id, typeKey, objectIds });
      created.push(cand);
    }
    return created;
  }

  async listCandidates(ctx: AuthCtx): Promise<MergeCandidateView[]> {
    const cands = await this.repos.mergeCandidates.list(ctx.tenantId, (c) => c.status === "PENDING");
    const views: MergeCandidateView[] = [];
    for (const c of cands) {
      const objects = [];
      for (const id of c.objectIds) {
        const o = await this.repos.objects.get(ctx.tenantId, id);
        if (o) objects.push({ id: o.id, props: o.props });
      }
      views.push({ ...c, objects });
    }
    return views.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listMerges(ctx: AuthCtx): Promise<ObjectMerge[]> {
    return (await this.repos.objectMerges.list(ctx.tenantId)).sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1));
  }

  /** 合并：golden 存活，其余置 mergedInto=golden；links 重指 golden（去重）；记 object_merges。 */
  async merge(ctx: AuthCtx, candidateId: string, goldenId?: string, survivorship?: Record<string, string>): Promise<ObjectMerge> {
    const cand = await this.repos.mergeCandidates.get(ctx.tenantId, candidateId);
    if (!cand || cand.status !== "PENDING") throw notFound("merge candidate");
    const golden = goldenId ?? cand.objectIds[0]!;
    if (!cand.objectIds.includes(golden)) throw validationError("goldenId 不在候选对象集内");
    const mergedIds = cand.objectIds.filter((id) => id !== golden);

    // survivorship：把选定来源的字段值写入 golden
    if (survivorship) {
      const g = await this.repos.objects.get(ctx.tenantId, golden);
      if (g) {
        const props = { ...g.props };
        for (const [prop, fromId] of Object.entries(survivorship)) {
          const src = await this.repos.objects.get(ctx.tenantId, fromId);
          if (src && prop in src.props) props[prop] = src.props[prop];
        }
        await this.repos.objects.put({ ...g, props });
      }
    }

    // 被并对象置 mergedInto
    for (const id of mergedIds) {
      const o = await this.repos.objects.get(ctx.tenantId, id);
      if (o) await this.repos.objects.put({ ...o, mergedInto: golden });
    }

    // links 重指 golden（去重：同 type+from+to 只留一条）
    const links = await this.repos.links.list(ctx.tenantId);
    const mergedSet = new Set(mergedIds);
    const seenLink = new Set<string>();
    for (const l of links) {
      const from = mergedSet.has(l.fromId) ? golden : l.fromId;
      const to = mergedSet.has(l.toId) ? golden : l.toId;
      if (from === l.fromId && to === l.toId) continue; // 未涉及
      const dedupeKey = `${l.type}|${from}|${to}`;
      if (from === to || seenLink.has(dedupeKey)) {
        await this.repos.links.remove(ctx.tenantId, l.id);
        continue;
      }
      seenLink.add(dedupeKey);
      await this.repos.links.put({ ...l, fromId: from, toId: to });
    }

    const now = new Date().toISOString();
    const rec: ObjectMerge = {
      id: newId("omg"),
      tenantId: ctx.tenantId,
      typeKey: cand.typeKey,
      goldenId: golden,
      mergedIds,
      ...(survivorship ? { survivorship } : {}),
      mergedBy: ctx.userId,
      mergedAt: now,
      unmergeUntil: new Date(Date.now() + UNMERGE_WINDOW_MS).toISOString(),
    };
    await this.repos.objectMerges.put(rec);
    await this.repos.mergeCandidates.put({ ...cand, status: "MERGED" });
    await this.outbox.emit(ctx.tenantId, "objects.merged", { goldenId: golden, mergedIds, typeKey: cand.typeKey });
    return rec;
  }

  async reject(ctx: AuthCtx, candidateId: string): Promise<void> {
    const cand = await this.repos.mergeCandidates.get(ctx.tenantId, candidateId);
    if (!cand || cand.status !== "PENDING") throw notFound("merge candidate");
    await this.repos.mergeCandidates.put({ ...cand, status: "REJECTED" });
  }

  /** 逆操作（72h 内）：被并对象清 mergedInto 还原；删除 merge 记录。links 不自动还原（审计提示）。 */
  async unmerge(ctx: AuthCtx, mergeId: string): Promise<void> {
    const rec = await this.repos.objectMerges.get(ctx.tenantId, mergeId);
    if (!rec) throw notFound("object merge");
    if (Date.now() > Date.parse(rec.unmergeUntil)) throw validationError("超过 72h unmerge 窗口，需人工处理并审计");
    for (const id of rec.mergedIds) {
      const o = await this.repos.objects.get(ctx.tenantId, id);
      if (o && o.mergedInto === rec.goldenId) await this.repos.objects.put({ ...o, mergedInto: undefined });
    }
    await this.repos.objectMerges.remove(ctx.tenantId, mergeId);
    await this.outbox.emit(ctx.tenantId, "objects.merged", { goldenId: rec.goldenId, mergedIds: [], unmerged: true });
  }
}
