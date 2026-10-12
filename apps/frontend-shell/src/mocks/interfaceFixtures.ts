import {
  checkInterfaceConformance,
  checkInterfaceIntegrity,
  formatInterfaceViolations,
  type ConformanceSolverView,
  type ConformanceTypeView,
  type InterfaceViolation,
  type ObjectInterface,
  type ObjectInterfaceInput,
} from "@platform/contracts";
import { db } from "./db";

/**
 * WO-INTERFACE-ADMIN-UI · 对象接口（ObjectInterface）的 mock 世界。
 *
 * ══ 两条纪律（照 orgFixtures 同一份模板，都是本仓踩出来的）══════════════════
 *
 * ① **判定逻辑不许在这里再写一遍。**
 *    一致性校验直接调 `@platform/contracts` 的 `checkInterfaceConformance()` /
 *    `checkInterfaceIntegrity()` —— 与真后端 `apps/datacore/src/ontology.ts interfaceViolations`
 *    （发布门 `assertInterfaceConformance` 与只读报告共用）**同一份实现**。
 *    自己抄一份 if-else 的后果：后端改了兼容矩阵，mock 照旧放行，前端测试全绿而生产 400 —— 哑门。
 *    装配部分（版本演进 / implementers 报告拼装）是编排不是判定，contracts 里没有可复用函数，
 *    故照 `apps/datacore/src/ontology-governance.ts ObjectInterfaceService` 逐步复刻并注明锚点。
 *
 * ② **数据照抄真种子**，不另发明一套接口/类型。
 *    R1 禁止前端 import 后端源码，所以只能复制；复制就要**逐字对齐**，否则 mock 模式演示的是
 *    一个真实租户里不存在的接口世界。对齐锚点（改动任一侧都会被接缝测试 §事实锁 当场咬）：
 *      · 接口种子   `apps/datacore/src/synthetic/battery.ts` `BATTERY_OBJECT_INTERFACES`（Approvable）
 *      · 类型绑定   同文件 `BATTERY_TYPE_INTERFACE_BINDINGS`（ARInvoice / OverdueRecord → latest）
 *      · 类型属性   `apps/datacore/src/synthetic/battery-extended.ts` 的 def("ARInvoice"/"OverdueRecord")
 *      · 行动注册表  同 battery.ts `BATTERY_ACTION_TYPES`（"对象数据变更"）
 *      · 求解器签名  `apps/datacore/src/solvers/ontology-signature.ts` `credit_exposure.reads`
 */

const TENANT = "demo";
const now = () => new Date().toISOString();

/** 接口种子：照抄 `BATTERY_OBJECT_INTERFACES`（battery.ts:3015-3037），version/status 由服务装配语义补上。 */
const MOCK_INTERFACE_SEED: ObjectInterface[] = [
  {
    id: "oif_demo_Approvable_1",
    tenantId: TENANT,
    key: "Approvable",
    version: 1,
    name: "可审批物",
    businessDefinition: {
      statement:
        "需要经人工审批才能生效的业务记录：必须能说清审批人（approver）、审批时间（approvedAt）与审批金额（amount）。",
      excludes: ["系统自动产生、无人工决策环节的派生记录", "只读的统计/投影对象（无状态变更）"],
    },
    properties: [
      { propKey: "approver", dataType: "string", description: "审批人（用户标识）", required: true },
      { propKey: "approvedAt", dataType: "date", description: "审批时间", required: true },
      { propKey: "amount", dataType: "number", description: "本次审批涉及的金额", required: true },
    ],
    actions: [{ actionTypeKey: "对象数据变更", required: true }],
    functions: [{ solverKey: "credit_exposure", required: true }],
    status: "PUBLISHED",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

/**
 * 一致性校验的**类型侧视图**种子：照抄 battery-extended.ts 的 def("ARInvoice")(:206) / def("OverdueRecord")(:162)
 * 属性清单 + battery.ts `BATTERY_TYPE_INTERFACE_BINDINGS`(:3043-3050) 的 implements/actions 绑定。
 * （`p("amount")` 缺省 dataType=number —— 后端 `def/p` 帮助函数的缺省口径。）
 */
const MOCK_INTERFACE_TYPE_VIEW: ConformanceTypeView[] = [
  {
    key: "ARInvoice",
    displayName: "应收发票",
    properties: [
      { propKey: "invoiceId", dataType: "string" },
      { propKey: "custName", dataType: "string" },
      { propKey: "amount", dataType: "number" },
      { propKey: "overdueDays", dataType: "number" },
      { propKey: "approver", dataType: "string" },
      { propKey: "approvedAt", dataType: "date" },
    ],
    actions: [{ actionTypeKey: "对象数据变更" }],
    implements: [{ interfaceKey: "Approvable", version: "latest" }],
  },
  {
    key: "OverdueRecord",
    displayName: "逾期记录",
    properties: [
      { propKey: "overdueId", dataType: "string" },
      { propKey: "invoiceRef", dataType: "string" },
      { propKey: "overdueDays", dataType: "number" },
      { propKey: "customerRef", dataType: "string" },
      { propKey: "amount", dataType: "number" },
      { propKey: "approver", dataType: "string" },
      { propKey: "approvedAt", dataType: "date" },
    ],
    actions: [{ actionTypeKey: "对象数据变更" }],
    implements: [{ interfaceKey: "Approvable", version: "latest" }],
  },
];

/** 行动注册表镜像：battery.ts `BATTERY_ACTION_TYPES` 里接口种子引用的那条（:3162 `对象数据变更`）。 */
const MOCK_INTERFACE_ACTION_TYPE_KEYS = ["对象数据变更"];

/**
 * 求解器签名镜像：ontology-signature.ts `SOLVER_ONTOLOGY_SIGNATURES.credit_exposure.reads`(:365-372)。
 * 只镜像接口种子引用的这一条；新声明别的 solverKey ⇒ 完整性校验判 `INTERFACE_FUNCTION_UNKNOWN`
 * —— 与真后端「不在表内 = 求解器不存在或读取面未知」同口径。
 */
const MOCK_INTERFACE_SOLVER_SIGNATURES: Record<string, ConformanceSolverView> = {
  credit_exposure: {
    reads: [
      { typeKey: "Customer", propKeys: ["creditLimit", "custName", "receivables", "wipUnbilled"] },
      { typeKey: "ARInvoice", propKeys: ["amount", "custName", "invoiceId", "overdueDays"] },
      { typeKey: "Line", propKeys: ["baseId"] },
      { typeKey: "Model", propKeys: ["modelId"] },
    ],
  },
};

// ---------------------------------------------------------------------------
// 有状态 store（模块态，逐用例复位 —— 见 resetMockInterfaces 挂进 handlers.ts 的 resetMockOntologyRelations）
// ---------------------------------------------------------------------------

let mockInterfaces: ObjectInterface[] = MOCK_INTERFACE_SEED.map((i) => structuredClone(i));
let mockInterfaceSeq = 0;

export function resetMockInterfaces(): void {
  mockInterfaces = MOCK_INTERFACE_SEED.map((i) => structuredClone(i));
  mockInterfaceSeq = 0;
}

/** 镜像 `ObjectInterfaceService.list`：key→version 排序；缺省每 key 只回最新一条。 */
export function listMockInterfaces(allVersions: boolean): ObjectInterface[] {
  const sorted = [...mockInterfaces].sort((a, b) => a.key.localeCompare(b.key) || a.version - b.version);
  if (allVersions) return sorted;
  const latest = new Map<string, ObjectInterface>();
  for (const i of sorted) {
    const cur = latest.get(i.key);
    if (!cur || i.version > cur.version) latest.set(i.key, i);
  }
  return [...latest.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** 镜像 `ObjectInterfaceService.get`：指定 version 取该版；缺省取最新已发布版（无已发布则取最大版本号）。 */
export function getMockInterface(key: string, version?: number): ObjectInterface | undefined {
  const all = mockInterfaces.filter((i) => i.key === key);
  if (all.length === 0) return undefined;
  if (version !== undefined) return all.find((i) => i.version === version);
  const published = all.filter((i) => i.status === "PUBLISHED");
  const pool = published.length > 0 ? published : all;
  return pool.reduce((a, b) => (b.version > a.version ? b : a));
}

/** 镜像 `latestRecord`：发布/退役按"最新那条（含 DRAFT）"操作。 */
function latestMockRecord(key: string): ObjectInterface | undefined {
  const all = mockInterfaces.filter((i) => i.key === key);
  if (all.length === 0) return undefined;
  return all.reduce((a, b) => (b.version > a.version ? b : a));
}

/**
 * 镜像 `ObjectInterfaceService.upsert`：
 *   · 已 PUBLISHED 的 key **不原地改**，新开一个 DRAFT 版本；草稿则原地覆盖（开闭/演进）。
 *   · 接口自身完整性写入时就兑现（`checkInterfaceIntegrity`，与后端同一份 contracts 实现）——
 *     不合法根本存不进去，返回 violations 由 handler 翻成 400 逐条点名。
 */
export function upsertMockInterface(
  input: ObjectInterfaceInput,
): { ok: true; record: ObjectInterface } | { ok: false; violations: InterfaceViolation[] } {
  const latest = latestMockRecord(input.key);
  const reuseDraft = latest !== undefined && latest.status === "DRAFT";
  const rec: ObjectInterface = {
    id: reuseDraft ? latest.id : `oif_${TENANT}_${input.key}_${(latest?.version ?? 0) + 1}_${++mockInterfaceSeq}`,
    tenantId: TENANT,
    key: input.key,
    version: reuseDraft ? latest.version : (latest?.version ?? 0) + 1,
    name: input.name,
    ...(input.businessDefinition ? { businessDefinition: input.businessDefinition } : {}),
    properties: input.properties,
    ...(input.actions ? { actions: input.actions } : {}),
    ...(input.functions ? { functions: input.functions } : {}),
    status: input.status ?? "DRAFT",
    createdAt: reuseDraft ? (latest.createdAt ?? now()) : now(),
    updatedAt: now(),
  };
  const bad = checkInterfaceIntegrity(rec, {
    actionTypeKeys: MOCK_INTERFACE_ACTION_TYPE_KEYS,
    solverSignatures: MOCK_INTERFACE_SOLVER_SIGNATURES,
  });
  if (bad.length > 0) return { ok: false, violations: bad };
  mockInterfaces = [...mockInterfaces.filter((i) => !(reuseDraft && i.id === latest.id)), rec];
  return { ok: true, record: rec };
}

/** 镜像 `ObjectInterfaceService.publish`：完整性不过 ⇒ violations（handler 翻 400）；RETIRED 不可发布。 */
export function publishMockInterface(
  key: string,
): { ok: true; record: ObjectInterface } | { ok: false; status: number; message: string } {
  const rec = latestMockRecord(key);
  if (!rec) return { ok: false, status: 404, message: `对象接口 '${key}' 不存在` };
  if (rec.status === "RETIRED") return { ok: false, status: 409, message: `接口 ${key}@v${rec.version} 已退役，不可发布` };
  const bad = checkInterfaceIntegrity(rec, {
    actionTypeKeys: MOCK_INTERFACE_ACTION_TYPE_KEYS,
    solverSignatures: MOCK_INTERFACE_SOLVER_SIGNATURES,
  });
  if (bad.length > 0) {
    return { ok: false, status: 400, message: `接口定义不合法（${bad.length} 项）：${formatInterfaceViolations(bad)}` };
  }
  const next: ObjectInterface = { ...rec, status: "PUBLISHED", updatedAt: now() };
  mockInterfaces = mockInterfaces.map((i) => (i.id === rec.id ? next : i));
  return { ok: true, record: next };
}

/** 镜像 `ObjectInterfaceService.retire`。 */
export function retireMockInterface(
  key: string,
): { ok: true; record: ObjectInterface } | { ok: false; status: number; message: string } {
  const rec = latestMockRecord(key);
  if (!rec) return { ok: false, status: 404, message: `对象接口 '${key}' 不存在` };
  const next: ObjectInterface = { ...rec, status: "RETIRED", updatedAt: now() };
  mockInterfaces = mockInterfaces.map((i) => (i.id === rec.id ? next : i));
  return { ok: true, record: next };
}

/** 当前全量违规（`checkInterfaceConformance` 同一份 contracts 实现 = 发布门同一把尺子）。 */
function currentViolations(): InterfaceViolation[] {
  return checkInterfaceConformance({
    types: MOCK_INTERFACE_TYPE_VIEW,
    interfaces: mockInterfaces,
    actionTypeKeys: MOCK_INTERFACE_ACTION_TYPE_KEYS,
    solverSignatures: MOCK_INTERFACE_SOLVER_SIGNATURES,
  });
}

/** 镜像 `ObjectInterfaceService.conformance`（只读发布门预览）。 */
export function mockInterfaceConformance(): { ok: boolean; violations: InterfaceViolation[] } {
  const violations = currentViolations();
  return { ok: violations.length === 0, violations };
}

/**
 * 镜像 `ObjectInterfaceService.implementers` 的装配（判定部分仍走 contracts `checkInterfaceConformance`）。
 * 影响面里的 `views` 扫的是 mock 世界真实的 adminViews（`db.adminViews`），判据照抄后端
 * `JSON.stringify(v).includes('"${typeKey}"')` —— 不写死空表，mock 世界里有了引用就真的会亮出来。
 */
export function mockInterfaceImplementers(key: string, version?: number) {
  const all = mockInterfaces.filter((i) => i.key === key);
  const iface = getMockInterface(key, version);
  const impls = MOCK_INTERFACE_TYPE_VIEW.filter((t) =>
    (t.implements ?? []).some((r) => r.interfaceKey === key),
  ).sort((a, b) => a.key.localeCompare(b.key));
  const violations = currentViolations();

  const versions = [...all]
    .sort((a, b) => a.version - b.version)
    .map((v) => ({
      version: v.version,
      status: v.status,
      implementerCount: impls.filter((t) => {
        const ref = (t.implements ?? []).find((r) => r.interfaceKey === key);
        if (!ref) return false;
        if (ref.version === "latest") {
          const latestPub = all.filter((i) => i.status === "PUBLISHED").sort((a, b) => b.version - a.version)[0];
          return latestPub?.version === v.version;
        }
        return ref.version === v.version;
      }).length,
    }));

  const implementers = impls.map((t) => {
    const ref = (t.implements ?? []).find((r) => r.interfaceKey === key)!;
    const resolved =
      ref.version === "latest"
        ? all.filter((i) => i.status === "PUBLISHED").sort((a, b) => b.version - a.version)[0]
        : all.find((i) => i.version === ref.version);
    const own = violations.filter((v) => v.typeKey === t.key && v.interfaceKey.includes(key));
    return {
      typeKey: t.key,
      displayName: t.displayName ?? t.key,
      pinnedVersion: ref.version,
      ...(resolved ? { resolvedVersion: resolved.version } : {}),
      conformant: own.length === 0,
      violations: own,
    };
  });

  const implKeys = implementers.map((i) => i.typeKey);
  const actions = [
    ...new Set([
      ...(iface?.actions ?? []).map((a) => a.actionTypeKey),
      ...impls.flatMap((t) => (t.actions ?? []).map((a) => a.actionTypeKey)),
    ]),
  ].sort();
  const functions = (iface?.functions ?? [])
    .map((f) => ({
      solverKey: f.solverKey,
      registered: Boolean(MOCK_INTERFACE_SOLVER_SIGNATURES[f.solverKey]),
      ...(MOCK_INTERFACE_SOLVER_SIGNATURES[f.solverKey]
        ? { ontologySignature: MOCK_INTERFACE_SOLVER_SIGNATURES[f.solverKey] }
        : {}),
    }))
    .sort((a, b) => a.solverKey.localeCompare(b.solverKey));
  // 后端扫 `repos.viewConfigs`（记录形 {id, role?}）；mock 世界的对应物是 db.adminViews（AdminViewConfig，
  // 主键叫 viewKey、无 role 字段）—— 按 mock 世界真有的形状投影，不编造 role。
  const views = db.adminViews
    .filter((v) => {
      const blob = JSON.stringify(v);
      return implKeys.some((k) => blob.includes(`"${k}"`));
    })
    .map((v) => ({ id: v.viewKey }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const migrationRequired = implementers
    .filter((i) => !i.conformant)
    .map((i) => ({
      typeKey: i.typeKey,
      missing: [...new Set(i.violations.map((v) => v.propKey ?? v.actionTypeKey ?? v.solverKey ?? v.code))].sort(),
    }));

  return {
    interfaceKey: key,
    ...(iface ? { interface: iface } : {}),
    versions,
    implementers,
    impact: { objectTypes: implKeys, actions, functions, views, migrationRequired },
  };
}
