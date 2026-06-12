import type { FeatureDef } from "@platform/contracts";
import type { AuthCtx, FeatureAuditRecord, FeatureConfigRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { AppError, validationError } from "./errors.js";

/**
 * Feature entitlement (增量 PRD). FeatureRegistry is code-registered; resolution
 * is platform defaults → IndustryTemplate.features → tenant overrides → role
 * narrowing. Disabled = "does not exist" → 404 FEATURE_NOT_FOUND before authz.
 */

export const FEATURE_REGISTRY: FeatureDef[] = [
  // VIEW level
  { key: "view.dash", name: "驾驶舱", level: "VIEW", defaultOn: true, bindings: { apiTags: ["dash"] } },
  { key: "view.ontology-graph", name: "本体图谱", level: "VIEW", defaultOn: true },
  { key: "view.risk-board", name: "风险推演看板", level: "VIEW", defaultOn: true, bindings: { intents: ["risk_*"], solverKeys: ["risk_timeline"], apiTags: ["risk-board"] } },
  { key: "view.ledger", name: "订单台账", level: "VIEW", defaultOn: true },
  { key: "view.plan-audit", name: "规划体检", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_audit_*"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "view.plan-generate", name: "规划建议", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_generate_*"], solverKeys: ["plan_generate"], apiTags: ["plan-generate"] } },
  { key: "view.sop-balance", name: "S&OP 月度平衡", level: "VIEW", defaultOn: true, bindings: { intents: ["sop_*"], solverKeys: ["sop_balance"], apiTags: ["sop"] } },
  { key: "view.project-sim", name: "项目沙盘推演", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["capacity_forecast"], intents: ["capacity_*"] } },
  // BLOCK level
  { key: "shell.query-dock", name: "查询对话坞", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "Agent 兜底（路径 B）", level: "BLOCK", defaultOn: true },
  { key: "view.project-sim.whatif", name: "What-if 调参", level: "BLOCK", defaultOn: true, requires: ["view.project-sim"] },
  { key: "view.risk-board.mitigation", name: "处置方案区", level: "BLOCK", defaultOn: true, requires: ["view.risk-board"] },
  { key: "view.dash.widget.capacity", name: "驾驶舱·产能卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "view.dash.widget.risk", name: "驾驶舱·风险卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // ACTION level
  { key: "act.plan-audit.apply-fix", name: "体检一键修正", level: "ACTION", defaultOn: true, requires: ["view.plan-audit"] },
  { key: "act.adopt-to-draft", name: "采纳为草稿", level: "ACTION", defaultOn: true },
  { key: "act.export", name: "导出", level: "ACTION", defaultOn: true },
];

export const ALL_FEATURE_KEYS: string[] = FEATURE_REGISTRY.map((f) => f.key);

/** Workspace view key → controlling feature (server-side navigation filter). */
export const VIEW_FEATURE_MAP: Record<string, string> = {
  dash: "view.dash",
  risk: "view.risk-board",
  order: "view.ledger",
  graph: "view.ontology-graph",
  "ontology-graph": "view.ontology-graph",
  "plan-audit": "view.plan-audit",
  "plan-generate": "view.plan-generate",
  "sop-balance": "view.sop-balance",
  "project-sim": "view.project-sim",
};

const byKey = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

export const featureNotFound = () => new AppError("FEATURE_NOT_FOUND", "feature not found", 404);

export class FeatureService {
  constructor(private repos: Repos) {}

  registry(): FeatureDef[] {
    return FEATURE_REGISTRY;
  }

  private async templateFeatures(tenantId: string): Promise<Set<string> | undefined> {
    const tenant = await this.repos.tenants.get(tenantId, tenantId);
    const industry = tenant?.industry;
    if (!industry) return undefined;
    if (industry === "battery-manufacturing") return new Set(ALL_FEATURE_KEYS); // battery default: all on
    const tmpl = (
      await this.repos.industryTemplates.list(tenantId, (t) => t.industryKey === industry)
    )[0];
    const feats = tmpl?.template.features;
    return Array.isArray(feats) ? new Set(feats) : undefined;
  }

  /** Cascade requires: a key is effective only if all ancestors are on. */
  private cascade(on: Set<string>): Set<string> {
    const effective = new Set<string>();
    const isOn = (key: string, seen: Set<string>): boolean => {
      if (seen.has(key)) return false;
      seen.add(key);
      if (!on.has(key)) return false;
      const def = byKey.get(key);
      for (const parent of def?.requires ?? []) if (!isOn(parent, seen)) return false;
      return true;
    };
    for (const key of on) if (isOn(key, new Set())) effective.add(key);
    return effective;
  }

  private async layeredSet(tenantId: string, role?: string): Promise<{ on: Set<string>; configVersion: number }> {
    // L1 platform defaults
    const on = new Set<string>(FEATURE_REGISTRY.filter((f) => f.defaultOn).map((f) => f.key));
    // L2 industry template defaults
    const tmpl = await this.templateFeatures(tenantId);
    if (tmpl) {
      for (const k of [...on]) if (!tmpl.has(k)) on.delete(k);
      for (const k of tmpl) if (byKey.has(k)) on.add(k);
    }
    // L3 tenant overrides
    let configVersion = 0;
    const tenantCfg = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}`);
    if (tenantCfg) {
      configVersion = tenantCfg.configVersion;
      for (const [k, v] of Object.entries(tenantCfg.overrides)) {
        if (v) on.add(k);
        else on.delete(k);
      }
    }
    // L4 role narrowing (can only remove)
    if (role) {
      const roleCfg = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}_${role}`);
      if (roleCfg) {
        configVersion = Math.max(configVersion, roleCfg.configVersion);
        for (const [k, v] of Object.entries(roleCfg.overrides)) if (!v) on.delete(k);
      }
    }
    return { on, configVersion };
  }

  /** Resolved effective feature set (expanded, cascaded) + configVersion. */
  async resolve(tenantId: string, role?: string): Promise<{ features: string[]; configVersion: number }> {
    const { on, configVersion } = await this.layeredSet(tenantId, role);
    return { features: [...this.cascade(on)].sort(), configVersion };
  }

  /** Union across the user's roles (each role is a narrowing of the tenant set). */
  async resolveForUser(ctx: AuthCtx): Promise<{ features: string[]; configVersion: number }> {
    const baseRoles = [...new Set(ctx.roles.map((r) => r.split(":")[0] as string))];
    if (baseRoles.length === 0) return this.resolve(ctx.tenantId);
    const union = new Set<string>();
    let configVersion = 0;
    for (const role of baseRoles) {
      const r = await this.resolve(ctx.tenantId, role);
      for (const f of r.features) union.add(f);
      configVersion = Math.max(configVersion, r.configVersion);
    }
    return { features: [...union].sort(), configVersion };
  }

  async enabled(tenantId: string, featureKey: string): Promise<boolean> {
    const { features } = await this.resolve(tenantId);
    return features.includes(featureKey);
  }

  /** Entitlement middleware: route tag / solverKey lookup → 404 when bound feature is off. */
  async requireByBinding(tenantId: string, kind: "solverKeys" | "apiTags" | "intents", value: string): Promise<void> {
    const bound = FEATURE_REGISTRY.filter((f) => (f.bindings?.[kind] ?? []).some((b) => matchBinding(b, value)));
    if (bound.length === 0) return; // untagged routes are not entitlement-controlled
    const { features } = await this.resolve(tenantId);
    for (const def of bound) {
      if (!features.includes(def.key)) throw featureNotFound();
    }
  }

  private validateKeys(overrides: Record<string, boolean>): void {
    for (const k of Object.keys(overrides)) {
      if (!byKey.has(k)) throw validationError(`unknown feature key: ${k}`);
    }
  }

  async putTenantConfig(ctx: AuthCtx, tenantId: string, overrides: Record<string, boolean>): Promise<FeatureConfigRecord> {
    this.validateKeys(overrides);
    return this.saveConfig(ctx, tenantId, undefined, overrides);
  }

  async putRoleConfig(ctx: AuthCtx, tenantId: string, role: string, overrides: Record<string, boolean>): Promise<FeatureConfigRecord> {
    this.validateKeys(overrides);
    // Role layer may only narrow within the tenant-enabled set (E6).
    const tenantSet = new Set((await this.resolve(tenantId)).features);
    for (const [k, v] of Object.entries(overrides)) {
      if (v && !tenantSet.has(k)) {
        throw new AppError("ROLE_CANNOT_EXCEED_TENANT", `role cannot enable '${k}' beyond tenant entitlement`, 422);
      }
    }
    return this.saveConfig(ctx, tenantId, role, overrides);
  }

  private async saveConfig(
    ctx: AuthCtx,
    tenantId: string,
    role: string | undefined,
    overrides: Record<string, boolean>,
  ): Promise<FeatureConfigRecord> {
    const id = role ? `fcfg_${tenantId}_${role}` : `fcfg_${tenantId}`;
    const existing = await this.repos.featureConfigs.get(tenantId, id);
    const all = await this.repos.featureConfigs.list(tenantId);
    const maxVersion = all.reduce((a, c) => Math.max(a, c.configVersion), 0);
    const rec: FeatureConfigRecord = {
      id,
      tenantId,
      role,
      overrides,
      configVersion: maxVersion + 1,
      updatedBy: ctx.userId,
      updatedAt: new Date().toISOString(),
    };
    await this.repos.featureConfigs.put(rec);
    const diff: FeatureAuditRecord["diff"] = {};
    const before = existing?.overrides ?? {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(overrides)])) {
      if (before[k] !== overrides[k] && overrides[k] !== undefined) {
        diff[k] = { from: before[k] ?? null, to: overrides[k] as boolean };
      }
    }
    await this.repos.featureAudit.put({
      id: `faud_${tenantId}_${rec.configVersion}`,
      tenantId,
      role,
      diff,
      configVersion: rec.configVersion,
      updatedBy: ctx.userId,
      updatedAt: rec.updatedAt,
    });
    return rec;
  }

  async audit(tenantId: string): Promise<FeatureAuditRecord[]> {
    const all = await this.repos.featureAudit.list(tenantId);
    return all.sort((a, b) => b.configVersion - a.configVersion);
  }
}

/** Bindings may use a trailing wildcard, e.g. intents: ["plan_audit_*"]. */
function matchBinding(pattern: string, value: string): boolean {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}
