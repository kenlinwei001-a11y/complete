import type { AuthCtx, FeatureConfigRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { FeatureService } from "./features.js";
import { FEATURE_REGISTRY } from "./features.js";
import {
  CONFIG_BUNDLE_SCHEMA_VERSION,
  type ConfigBundle,
  type ImportConflictPolicy,
  type ImportDiff,
  type ImportJob,
} from "@platform/contracts";
import { newId } from "./ids.js";

const nowIso = () => new Date().toISOString();
const major = (v: string): string => v.split(".")[0] ?? v;

/**
 * OC3 环境间配置迁移 + 跨系统 Saga（execution-semantics §3 / OC3）。
 * 导出本租户配置 → 另一环境导入：DRY_RUN_OK→APPLYING_A（DataCore featureOverrides）→APPLYING_B
 * （AgentCore，注入客户端）→COMMITTED；B 失败 → COMPENSATING（回滚 A）→COMPENSATED。
 * schemaVersion major 兼容校验 + 冲突策略（SKIP/OVERWRITE/FAIL）。状态机持久化 import_jobs（R9）。
 */
export class ConfigBundleService {
  constructor(
    private repos: Repos,
    private features: FeatureService,
  ) {}

  /** 跨系统 Saga B 段（A→B）：把 bundle.agentCore 下发 AgentCore；未配置则 B 段为 no-op（直接 COMMIT）。 */
  private agentCoreApply?: (ctx: AuthCtx, agentCore: Record<string, unknown>) => Promise<{ ok: boolean }>;
  setAgentCoreApply(fn: (ctx: AuthCtx, agentCore: Record<string, unknown>) => Promise<{ ok: boolean }>): void {
    this.agentCoreApply = fn;
  }

  private cfgId(tenantId: string): string {
    return `fcfg_${tenantId}`;
  }

  async export(ctx: AuthCtx): Promise<ConfigBundle> {
    const cfg = await this.repos.featureConfigs.get(ctx.tenantId, this.cfgId(ctx.tenantId));
    return {
      platformSchemaVersion: CONFIG_BUNDLE_SCHEMA_VERSION,
      sourceTenantId: ctx.tenantId,
      exportedAt: nowIso(),
      featureOverrides: cfg?.overrides ?? {},
    };
  }

  private computeDiff(bundle: ConfigBundle, current: Record<string, boolean>): ImportDiff {
    const added: string[] = [];
    const changed: { key: string; from: boolean; to: boolean }[] = [];
    const same: string[] = [];
    for (const [k, v] of Object.entries(bundle.featureOverrides)) {
      if (!(k in current)) added.push(k);
      else if (current[k] !== v) changed.push({ key: k, from: current[k]!, to: v });
      else same.push(k);
    }
    return { featureOverrides: { added, changed, same }, conflicts: changed.map((c) => c.key) };
  }

  /**
   * 导入 Saga。dryRun=true → 止于 DRY_RUN_OK（只产 diff，零写）。否则跑完整状态机。
   * 每次状态跃迁持久化 import_jobs（崩溃可观测/可恢复）。
   */
  async import(ctx: AuthCtx, bundle: ConfigBundle, dryRun: boolean, conflictPolicy: ImportConflictPolicy): Promise<ImportJob> {
    const id = newId("imp");
    let job: ImportJob = {
      id,
      tenantId: ctx.tenantId,
      state: "VALIDATING",
      schemaVersion: bundle.platformSchemaVersion,
      dryRun,
      conflictPolicy,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const save = async (patch: Partial<ImportJob>): Promise<void> => {
      job = { ...job, ...patch, updatedAt: nowIso() };
      await this.repos.importJobs.put(job);
    };
    await this.repos.importJobs.put(job);

    // ① VALIDATING：schemaVersion major 兼容 + feature 键合法。
    if (major(bundle.platformSchemaVersion) !== major(CONFIG_BUNDLE_SCHEMA_VERSION)) {
      await save({ state: "FAILED", error: `schemaVersion 不兼容：bundle ${bundle.platformSchemaVersion} ≠ 平台 ${CONFIG_BUNDLE_SCHEMA_VERSION}` });
      return job;
    }
    const known = new Set(FEATURE_REGISTRY.map((f) => f.key));
    const unknown = Object.keys(bundle.featureOverrides).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      await save({ state: "FAILED", error: `未知功能键（目标环境无此 feature）：${unknown.slice(0, 5).join(", ")}` });
      return job;
    }

    // ② DRY_RUN_OK：diff（vs 目标当前）。
    const before = await this.repos.featureConfigs.get(ctx.tenantId, this.cfgId(ctx.tenantId));
    const beforeOverrides = before?.overrides ?? {};
    const diff = this.computeDiff(bundle, beforeOverrides);
    if (conflictPolicy === "FAIL" && diff.conflicts.length > 0) {
      await save({ state: "FAILED", diff, error: `存在 ${diff.conflicts.length} 项冲突且 policy=FAIL：${diff.conflicts.slice(0, 5).join(", ")}` });
      return job;
    }
    await save({ state: "DRY_RUN_OK", diff });
    if (dryRun) return job;

    // ③ APPLYING_A：应用 featureOverrides（SKIP 策略跳过冲突键）。
    const applyMap: Record<string, boolean> = { ...bundle.featureOverrides };
    if (conflictPolicy === "SKIP") for (const k of diff.conflicts) delete applyMap[k];
    await save({ state: "APPLYING_A" });
    try {
      await this.features.putTenantConfig(ctx, ctx.tenantId, applyMap);
    } catch (e) {
      await save({ state: "FAILED", error: `A 段应用失败：${(e as Error).message}` });
      return job;
    }

    // ④ APPLYING_B：跨系统（AgentCore）。失败 → 补偿回滚 A。
    await save({ state: "APPLYING_B" });
    if (this.agentCoreApply && bundle.agentCore) {
      const r = await this.agentCoreApply(ctx, bundle.agentCore).catch(() => ({ ok: false }));
      if (!r.ok) {
        await save({ state: "COMPENSATING" });
        await this.restoreA(ctx, before);
        await save({ state: "COMPENSATED", error: "B 段（AgentCore）失败 → A 段已补偿回滚（Saga 一致）" });
        return job;
      }
    }
    await save({ state: "COMMITTED" });
    return job;
  }

  /** 补偿：把 featureConfigs 记录恢复到 APPLYING_A 之前（清晰 set-all 回滚）。 */
  private async restoreA(ctx: AuthCtx, before: FeatureConfigRecord | undefined): Promise<void> {
    if (before) {
      await this.repos.featureConfigs.put(before);
    } else {
      await this.repos.featureConfigs.put({ id: this.cfgId(ctx.tenantId), tenantId: ctx.tenantId, overrides: {}, configVersion: 0, updatedBy: ctx.userId, updatedAt: nowIso() });
    }
  }
}
