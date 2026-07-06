import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthCtx, LinkInstance, ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import { META_ACCESS_DEFAULT_ROLES } from "@platform/contracts";
import { parseMetaOntology, type JudgeResults, type MetaEdge, type MetaNode } from "./parse.js";

/** Dogfooding 元租户：系统自我模型挂此命名空间,业务租户经 R2 天然见不到（铁纪律①）。 */
export const META_TENANT = "__platform__";

export interface MetaSyncResult {
  objects: number;
  links: number;
  byKind: Record<string, number>;
}

export interface MetaImpactResult {
  node: string;
  affected: { id: string; via: string }[];
}

/**
 * Dogfooding P1：把系统本体（SYSTEM-ONTOLOGY.md + prd-ontology-index.json）确定性投影为
 * 元租户 __platform__ 的 ObjectInstance + Link。markdown 单一来源,对象只读派生（R4 豁免）。
 * 复用 objects/links 仓储（不新建表,R9 已双实现）。
 */
/**
 * 本体源目录解析（cwd 无关·治本 G-DM）：以本模块 URL 为锚 → repo/docs，避免依赖 process.cwd()。
 * 本文件构建后位于 apps/datacore/dist/meta/service.js（src 同深度 apps/datacore/src/meta），
 * 上溯 4 级到仓库根再取 docs/。可用 env `DOCS_DIR` 显式覆盖（容器/非标准布局兜底）。
 * 旧实现 join(process.cwd(),"..","..","docs") 假设 cwd=apps/datacore，从仓库根启动即得 /home/docs → ENOENT 500。
 */
export function resolveDocsDir(): string {
  const override = process.env.DOCS_DIR?.trim();
  if (override) return override;
  const here = dirname(fileURLToPath(import.meta.url)); // apps/datacore/{dist|src}/meta
  return join(here, "..", "..", "..", "..", "docs");
}

export class MetaOntologyService {
  constructor(
    private repos: Repos,
    private outbox: OutboxService,
    /** 本体源目录（运行时需可读;默认经 import.meta.url 锚定 repo docs/,cwd 无关。部署须随容器带 docs/;env DOCS_DIR 可覆盖）。 */
    private docsDir: string = resolveDocsDir(),
  ) {}

  private objId(n: MetaNode): string {
    return `meta_${n.kind}_${n.key}`.replace(/[^\w-]/g, "_");
  }
  private edgeId(e: MetaEdge): string {
    return `metalnk_${e.from}_${e.kind}_${e.to}`.replace(/[^\w-]/g, "_");
  }

  /** 读取本体源（markdown + prd-index）。端点侧 IO,纯解析在 parse.ts。 */
  private async readSources(): Promise<{ ontologyMd: string; prdIndex: unknown }> {
    const ontologyMd = await readFile(join(this.docsDir, "SYSTEM-ONTOLOGY.md"), "utf8");
    const prdIndex = JSON.parse(await readFile(join(this.docsDir, "prd-ontology-index.json"), "utf8"));
    return { ontologyMd, prdIndex };
  }

  /**
   * 幂等重物化（R6 确定性）：同 markdown → 同投影;清旧 META 对象/链路后重建,发 meta.ontology_synced。
   * META-RUNTIME-TRUTH（§3.5）：传 `judgeResults` 时断点 status 派生为运行时真相（声称 FIXED 但
   * 判据不通 → DRIFT；无判据 → UNCHECKED），「用平台查平台自己」落库的即运行时真相非 §8 emoji 声称；
   * 不传（测试/纯投影）则维持读 §8 声称，向后兼容。
   */
  async sync(
    _ctx: AuthCtx,
    sources?: { ontologyMd: string; prdIndex: unknown },
    opts?: { judgeResults?: JudgeResults },
  ): Promise<MetaSyncResult> {
    const { ontologyMd, prdIndex } = sources ?? (await this.readSources());
    const { nodes, edges } = parseMetaOntology(ontologyMd, prdIndex as Parameters<typeof parseMetaOntology>[1], opts);

    await this.repos.objects.removeWhere(META_TENANT, (o) => o.origin.type === "META");
    await this.repos.links.removeWhere(META_TENANT, (l) => l.origin.type === "META");

    const byKind: Record<string, number> = {};
    for (const n of nodes) {
      const obj: ObjectInstance = {
        id: this.objId(n),
        tenantId: META_TENANT,
        type: n.kind,
        props: { ...n.props, _key: n.key },
        origin: { type: "META", source: "SYSTEM-ONTOLOGY.md" },
      };
      await this.repos.objects.put(obj);
      byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    }
    for (const e of edges) {
      const lnk: LinkInstance = {
        id: this.edgeId(e),
        tenantId: META_TENANT,
        type: e.kind,
        fromId: e.from.startsWith("meta_") || e.from.includes(":") ? this.refToObjId(e.from) : e.from,
        toId: this.refToObjId(e.to),
        props: e.label ? { label: e.label } : undefined,
        origin: { type: "META", source: "SYSTEM-ONTOLOGY.md" },
      };
      await this.repos.links.put(lnk);
    }
    await this.outbox.emit(META_TENANT, "meta.ontology_synced", { objects: nodes.length, links: edges.length });
    return { objects: nodes.length, links: edges.length, byKind };
  }

  /** "<kind>:<key>" / "PRD:<file>" → 对象 id（PRD 非落库节点,保留原引用串）。 */
  private refToObjId(ref: string): string {
    if (ref.startsWith("PRD:")) return ref;
    return `meta_${ref}`.replace(/[^\w-]/g, "_");
  }

  async listAll(_ctx: AuthCtx): Promise<ObjectInstance[]> {
    return (await this.repos.objects.list(META_TENANT)).filter((o) => o.origin.type === "META");
  }

  async getBreakpoint(_ctx: AuthCtx, id: string): Promise<ObjectInstance | undefined> {
    return this.repos.objects.get(META_TENANT, `meta_SystemBreakpoint_${id}`.replace(/[^\w-]/g, "_"));
  }

  /** 按类型+键取元对象（invariants/events/domains/slices/object-types 通用）。 */
  async getNode(_ctx: AuthCtx, kind: string, key: string): Promise<ObjectInstance | undefined> {
    return this.repos.objects.get(META_TENANT, `meta_${kind}_${key}`.replace(/[^\w-]/g, "_"));
  }

  // ---- P2 可配置鉴权：MetaAccessPolicy（角色白名单,按调用方租户;默认 ["admin"]）----

  async getAccessPolicy(ctx: AuthCtx): Promise<{ tenantId: string; roles: string[] }> {
    const rec = await this.repos.metaAccessPolicies.get(ctx.tenantId, ctx.tenantId);
    return { tenantId: ctx.tenantId, roles: rec?.roles ?? [...META_ACCESS_DEFAULT_ROLES] };
  }

  async setAccessPolicy(ctx: AuthCtx, roles: string[]): Promise<{ tenantId: string; roles: string[] }> {
    await this.repos.metaAccessPolicies.put({ id: ctx.tenantId, tenantId: ctx.tenantId, roles, updatedAt: new Date().toISOString() });
    return { tenantId: ctx.tenantId, roles };
  }

  /** 鉴权门：调用方角色 ∩ 本租户白名单 ≠ ∅ → 放行。默认仅 admin。 */
  async hasAccess(ctx: AuthCtx): Promise<boolean> {
    const { roles } = await this.getAccessPolicy(ctx);
    const callerBaseRoles = new Set(ctx.roles.map((r) => r.split(":")[0]));
    return roles.some((r) => callerBaseRoles.has(r));
  }

  /**
   * P4 #14 自动派生（保守、只读、默认不写）：从 code 内省机器可派生段（求解器注册表）→ 与本体
   * markdown 现状 diff。**只产 diff,绝不自动改 markdown / 不 commit**（评审纪律:人只策展语义）。
   */
  async deriveDiff(_ctx: AuthCtx, solverKeys: string[], ontologyMd?: string): Promise<{
    dimension: string;
    code: string[];
    inCodeNotInDoc: string[];
    note: string;
  }> {
    const md = ontologyMd ?? (await this.readSources()).ontologyMd;
    const docMentions = new Set([...md.matchAll(/`([a-z_]{3,})`/g)].map((m) => m[1] as string));
    const inCodeNotInDoc = solverKeys.filter((k) => !docMentions.has(k)).sort();
    return {
      dimension: "solvers",
      code: [...solverKeys].sort(),
      inCodeNotInDoc,
      note: "只读 diff（#14 保守:不自动改 markdown,人确认后手工策展;现状守门仍靠 ontology:check）",
    };
  }

  /** 影响分析（轻量 BFS）：以 node（R14 / G-5 / SystemObjectType:Solver …）为 root，沿 META links 遍历。 */
  async impact(_ctx: AuthCtx, node: string, maxDepth = 3): Promise<MetaImpactResult> {
    const links = (await this.repos.links.list(META_TENANT)).filter((l) => l.origin.type === "META");
    // node 入参归一为对象 id 或节点引用：R14→meta_SystemInvariant_R14;G-5→meta_SystemBreakpoint_G-5;含":"→按 kind:key
    const root = /^R\d+$/.test(node)
      ? `meta_SystemInvariant_${node}`
      : /^G-\d+$/.test(node)
        ? `meta_SystemBreakpoint_${node}`
        : node.includes(":")
          ? this.refToObjId(node)
          : node;
    const seen = new Set<string>([root]);
    const affected: { id: string; via: string }[] = [];
    let frontier = [root];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const l of links) {
          for (const [a, b] of [[l.fromId, l.toId], [l.toId, l.fromId]] as const) {
            if (a === cur && !seen.has(b)) { seen.add(b); affected.push({ id: b, via: l.type }); next.push(b); }
          }
        }
      }
      frontier = next;
    }
    return { node: root, affected };
  }
}
