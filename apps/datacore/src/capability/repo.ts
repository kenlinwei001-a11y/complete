import { CapabilitySchema, type Capability } from "@platform/contracts";
import type { ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { META_TENANT } from "../meta/service.js";

/**
 * 可信自我账 · WO-2（PRD-trustworthy-self-accounting §3.1）：`Capability` 一等对象持久化。
 *
 * 复用 objects 仓储（元租户 `__platform__`·**不新建表**·R9 已 memory+pg 双实现）——与 Dogfooding 元层同命名空间，
 * 业务租户经 R2 天然见不到。`type: "Capability"`，`origin: META`，props 携全量 Capability 声明 + 派生态。
 *
 * 红线（齿①）：本仓储**只持久化**已由 `deriveVerifiedStatus` / `buildCapability` 构造的 Capability——
 * **无任何 verifiedStatus setter**；调用方无法绕过派生器手打状态字（CapabilitySpec 类型上就没有 verifiedStatus）。
 */

export const CAPABILITY_TYPE = "Capability";

/** 稳定对象 id（同 key 幂等覆盖）。 */
export function capabilityObjId(key: string): string {
  return `cap_${key}`.replace(/[^\w-]/g, "_");
}

/** Capability → ObjectInstance（落 objects 仓储；props 即 Capability 全量声明）。 */
export function capabilityToObject(cap: Capability): ObjectInstance {
  const parsed = CapabilitySchema.parse(cap); // 入库前过契约（含 verifiedStatus 合法枚举）
  return {
    id: capabilityObjId(parsed.key),
    tenantId: META_TENANT,
    type: CAPABILITY_TYPE,
    props: { ...parsed, _key: parsed.key },
    origin: { type: "META", source: "capability" },
    updatedAt: new Date().toISOString(),
  };
}

/** ObjectInstance → Capability（读路径经契约再校验，杜绝脏投影）。 */
export function objectToCapability(obj: ObjectInstance): Capability {
  return CapabilitySchema.parse(obj.props);
}

/**
 * Capability 仓储（薄封装 repos.objects·R9 双实现免费得）。
 * **无 verifiedStatus setter**：upsert 只接受完整 Capability（其派生态必出自 deriveVerifiedStatus）。
 */
export class CapabilityStore {
  constructor(private repos: Repos) {}

  /** 幂等覆盖（同 key → 同 id）。传入 Capability 的 verifiedStatus 必来自派生器（本层不改）。 */
  async upsert(cap: Capability): Promise<Capability> {
    await this.repos.objects.put(capabilityToObject(cap));
    return cap;
  }

  async get(key: string): Promise<Capability | undefined> {
    const obj = await this.repos.objects.get(META_TENANT, capabilityObjId(key));
    if (!obj || obj.type !== CAPABILITY_TYPE) return undefined;
    return objectToCapability(obj);
  }

  async list(): Promise<Capability[]> {
    const objs = await this.repos.objects.listByType(META_TENANT, CAPABILITY_TYPE);
    return objs.map(objectToCapability);
  }

  async remove(key: string): Promise<void> {
    await this.repos.objects.remove(META_TENANT, capabilityObjId(key));
  }
}
