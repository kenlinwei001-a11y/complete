import { z } from "zod";

/**
 * WO-69 P3 · **对象接口（ObjectInterface）= 多态抽象**。
 *
 * ─ 为什么存在 ────────────────────────────────────────────────────────────────
 * 修前全仓 `interfaceKey|implementsInterface|InterfaceDef|ObjectInterface` **0 命中**：平台只有
 * 一张张彼此孤立的 `ObjectTypeDef`，说不出「这些类型共享同一个业务契约」。后果：
 *   · 「所有需要审批的东西都得有审批人/审批时间/金额」只能**逐个类型手抄**，抄漏无人知道；
 *   · 想给一族类型统一挂一个行为（Action / 求解器），没有挂载点；
 *   · 「改这个契约会影响谁」查不出来 —— 影响面只能靠人脑记。
 *
 * ─ 设计红线 ──────────────────────────────────────────────────────────────────
 * ① **组合优于继承**：接口只声明**要求**（属性/行动/函数），**不注入**任何东西。一个类型可实现 N 个接口；
 *    平台**没有** `extends`（类型继承）——不把深继承的问题引进来。
 * ② **契约在发布门兑现**：声明 `implements` 却没真长出要求的属性/行为 → **拒绝发布并逐条点名**。
 *    绿测试≠能用：接口不是注释，是发布期硬门。
 * ③ **冲突绝不静默取其一**：两个接口对同一 propKey 要求互不相容的 dataType → 发布期报错列出双方。
 * ④ **开闭/演进**：接口带 `version`，多版本共存。已发布实现者若 pin 在旧版本，改接口**不会**把它悄悄弄失效；
 *    跟 `latest` 的实现者则在下次发布时被要求补齐（拒绝 + 迁移清单），升级路径始终显式。
 * ⑤ **`functions` 不是字段拷贝器**：`solverKey` 必须在真求解器签名注册表（WO-69 P2 `SOLVER_ONTOLOGY_SIGNATURES`）
 *    里存在，且该求解器签名里**对本实现者类型声明的读取面属性**必须在该类型上真存在——否则这个"行为"
 *    在这个实现者上根本跑不通，接口就是在撒谎。
 */

/** 与 `ObjectTypeDef.PropertyDef.dataType` 同域（contracts 侧独立声明，避免跨包依赖 app 源码 R1）。 */
export const InterfaceDataTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "ref",
  "json",
]);
export type InterfaceDataType = z.infer<typeof InterfaceDataTypeSchema>;

/**
 * **dataType 兼容矩阵**：`satisfiers(required)` = 能满足该要求的实现方 dataType 集合。
 *
 * 只允许「实现方更具体」（子类型）方向：`enum`/`ref` 在存储上就是受约束的 string，故可满足 `string` 要求；
 * 反向（要求 enum、实现 string）**不允许**——那是放宽契约。数值/布尔/日期/json **只接受自身**：
 * `number ← string` 这类"宽松兼容"正是算错数的入口（"12" 与 12 在求解器里不是一回事）。
 */
export const INTERFACE_DATATYPE_SATISFIERS: Record<InterfaceDataType, InterfaceDataType[]> = {
  string: ["string", "enum", "ref"],
  number: ["number"],
  boolean: ["boolean"],
  date: ["date"],
  enum: ["enum"],
  ref: ["ref"],
  json: ["json"],
};

/** 实现方 `actual` 是否满足接口要求的 `required` 数据类型。 */
export function dataTypeSatisfies(required: InterfaceDataType, actual: InterfaceDataType): boolean {
  return (INTERFACE_DATATYPE_SATISFIERS[required] ?? [required]).includes(actual);
}

/**
 * 两个接口对同一 propKey 的要求是否**可被同一个具体属性同时满足**。
 * 返回可行的 dataType 集合（空集 = 冲突，发布期必须报错，**绝不静默取其一**）。
 */
export function jointSatisfiers(a: InterfaceDataType, b: InterfaceDataType): InterfaceDataType[] {
  const sb = new Set(INTERFACE_DATATYPE_SATISFIERS[b] ?? [b]);
  return (INTERFACE_DATATYPE_SATISFIERS[a] ?? [a]).filter((t) => sb.has(t));
}

/** 接口要求的一条属性（字段继承）。`required` 约束的是**类型必须声明该属性**，不是每个实例都有值。 */
export const InterfacePropertyRequirementSchema = z.object({
  propKey: z.string().min(1),
  dataType: InterfaceDataTypeSchema,
  unit: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().default(true),
});
export type InterfacePropertyRequirement = z.infer<typeof InterfacePropertyRequirementSchema>;

/** 接口要求的一个行动绑定（行为继承 · S2 ActionType key）。 */
export const InterfaceActionRequirementSchema = z.object({
  actionTypeKey: z.string().min(1),
  required: z.boolean().default(true),
});
export type InterfaceActionRequirement = z.infer<typeof InterfaceActionRequirementSchema>;

/** 接口要求的一个函数（行为继承 · 求解器 key，接 WO-69 P2 的 OntologySignature）。 */
export const InterfaceFunctionRequirementSchema = z.object({
  solverKey: z.string().min(1),
  required: z.boolean().default(true),
});
export type InterfaceFunctionRequirement = z.infer<typeof InterfaceFunctionRequirementSchema>;

/** 业务定义（"这个接口到底指什么/不指什么"——`excludes` 是防歧义的负面清单）。 */
export const InterfaceBusinessDefinitionSchema = z.object({
  statement: z.string().min(1),
  excludes: z.array(z.string()).optional(),
});

/** **对象接口**记录（每个 `key + version` 一条记录 → 多版本共存 = 开闭）。 */
export const ObjectInterfaceSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  key: z.string().min(1), // e.g. "Approvable"
  version: z.number().int().positive(),
  name: z.string().min(1),
  businessDefinition: InterfaceBusinessDefinitionSchema.optional(),
  properties: z.array(InterfacePropertyRequirementSchema).default([]),
  actions: z.array(InterfaceActionRequirementSchema).optional(),
  functions: z.array(InterfaceFunctionRequirementSchema).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ObjectInterface = z.infer<typeof ObjectInterfaceSchema>;

/** 创建/更新接口的入参（id/tenantId/version 由服务端分配）。 */
export const ObjectInterfaceInputSchema = ObjectInterfaceSchema.omit({
  id: true,
  tenantId: true,
  version: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({ status: z.enum(["DRAFT", "PUBLISHED"]).optional() });
export type ObjectInterfaceInput = z.infer<typeof ObjectInterfaceInputSchema>;

/**
 * `ObjectTypeDef.implements[]` 的一项。`version: "latest"` = 跟随最新**已发布**版本
 * （接口一改，下次发布即被要求补齐）；固定数字 = pin 住（接口演进不会悄悄让它失效）。
 */
export const ImplementsRefSchema = z.object({
  interfaceKey: z.string().min(1),
  version: z.union([z.number().int().positive(), z.literal("latest")]),
});
export type ImplementsRef = z.infer<typeof ImplementsRefSchema>;

// ---------------------------------------------------------------------------
// 一致性校验（发布门）—— 纯函数，输入全显式，无 IO/无时钟/无随机（R6）
// ---------------------------------------------------------------------------

export type InterfaceViolationCode =
  | "INTERFACE_NOT_FOUND"
  | "INTERFACE_NOT_PUBLISHED"
  | "INTERFACE_RETIRED"
  | "INTERFACE_PROPERTY_MISSING"
  | "INTERFACE_PROPERTY_TYPE_MISMATCH"
  | "INTERFACE_PROPERTY_CONFLICT"
  | "INTERFACE_ACTION_MISSING"
  | "INTERFACE_ACTION_UNKNOWN"
  | "INTERFACE_FUNCTION_UNKNOWN"
  | "INTERFACE_FUNCTION_UNSATISFIED";

/** 一条不合规项。`message` 必须点名到具体缺哪个东西（"报告 exactly which item is missing"）。 */
export interface InterfaceViolation {
  code: InterfaceViolationCode;
  typeKey: string;
  interfaceKey: string;
  interfaceVersion?: number;
  /** 涉及的属性 / 行动 / 求解器 key（点名用）。 */
  propKey?: string;
  actionTypeKey?: string;
  solverKey?: string;
  message: string;
}

/** 校验输入：类型侧视图（只取校验需要的面，避免把 app 内部结构泄进 contracts）。 */
export interface ConformanceTypeView {
  key: string;
  displayName?: string;
  properties: { propKey: string; dataType: InterfaceDataType }[];
  /** 派生属性（数值管线产物）——同样算"类型上有这个属性"。 */
  derivedPropKeys?: string[];
  actions?: { actionTypeKey: string }[];
  implements?: ImplementsRef[];
}

/** 校验输入：求解器签名视图（WO-69 P2 `SOLVER_ONTOLOGY_SIGNATURES` 的可序列化投影）。 */
export interface ConformanceSolverView {
  /** 求解器声明的读取面。`propKeys` 省略 = 全属性（无从逐条校验，跳过 feasibility）。 */
  reads?: { typeKey: string; propKeys?: string[] }[];
}

export interface ConformanceInput {
  types: ConformanceTypeView[];
  /** 本租户全部接口记录（含各版本）。 */
  interfaces: ObjectInterface[];
  /** 已注册 ActionType key 集合（行为继承的真实性校验）。 */
  actionTypeKeys?: string[];
  /** 已签名求解器 → 签名（WO-69 P2 单一来源）。**不在表内 = 该求解器不存在或读取面未知 → RED**。 */
  solverSignatures?: Record<string, ConformanceSolverView>;
}

/** 解析 `implements` 引用到具体接口记录（latest = 最大版本号的 PUBLISHED 记录）。 */
export function resolveInterfaceRef(
  interfaces: ObjectInterface[],
  ref: ImplementsRef,
): ObjectInterface | undefined {
  const sameKey = interfaces.filter((i) => i.key === ref.interfaceKey);
  if (ref.version === "latest") {
    const published = sameKey.filter((i) => i.status === "PUBLISHED");
    if (published.length === 0) return undefined;
    return published.reduce((a, b) => (b.version > a.version ? b : a));
  }
  return sameKey.find((i) => i.version === ref.version);
}

/** 接口自身的完整性校验（与实现者无关）：行动/函数引用必须落到真注册表。 */
export function checkInterfaceIntegrity(
  iface: ObjectInterface,
  opts: { actionTypeKeys?: string[]; solverSignatures?: Record<string, ConformanceSolverView> },
): InterfaceViolation[] {
  const out: InterfaceViolation[] = [];
  if (opts.actionTypeKeys) {
    const known = new Set(opts.actionTypeKeys);
    for (const a of iface.actions ?? []) {
      if (!known.has(a.actionTypeKey)) {
        out.push({
          code: "INTERFACE_ACTION_UNKNOWN",
          typeKey: "",
          interfaceKey: iface.key,
          interfaceVersion: iface.version,
          actionTypeKey: a.actionTypeKey,
          message: `接口 ${iface.key}@v${iface.version} 声明的行动 '${a.actionTypeKey}' 未注册为 ActionType`,
        });
      }
    }
  }
  if (opts.solverSignatures) {
    for (const f of iface.functions ?? []) {
      if (!opts.solverSignatures[f.solverKey]) {
        out.push({
          code: "INTERFACE_FUNCTION_UNKNOWN",
          typeKey: "",
          interfaceKey: iface.key,
          interfaceVersion: iface.version,
          solverKey: f.solverKey,
          message: `接口 ${iface.key}@v${iface.version} 声明的函数 '${f.solverKey}' 不在求解器签名注册表内（求解器不存在或读取面未声明 → 该行为无法兑现）`,
        });
      }
    }
  }
  return out.sort(sortViolations);
}

const sortViolations = (a: InterfaceViolation, b: InterfaceViolation): number =>
  `${a.typeKey}|${a.interfaceKey}|${a.code}|${a.propKey ?? ""}|${a.actionTypeKey ?? ""}|${a.solverKey ?? ""}`.localeCompare(
    `${b.typeKey}|${b.interfaceKey}|${b.code}|${b.propKey ?? ""}|${b.actionTypeKey ?? ""}|${b.solverKey ?? ""}`,
  );

/**
 * **发布门核心**：校验每个声明了 `implements` 的类型是否真兑现了接口契约。
 * 返回全部违规（不早退——一次把缺口报全，"报告 exactly which item is missing"）。
 * 无 `implements` 的类型**一条都不走**（零回归：逐字节沿用发布现状）。
 */
export function checkInterfaceConformance(input: ConformanceInput): InterfaceViolation[] {
  const out: InterfaceViolation[] = [];
  for (const t of input.types) {
    const refs = t.implements ?? [];
    if (refs.length === 0) continue; // 零回归：不声明接口的类型完全不受影响

    // 1) 解析引用
    const resolved: { ref: ImplementsRef; iface: ObjectInterface }[] = [];
    for (const ref of refs) {
      const iface = resolveInterfaceRef(input.interfaces, ref);
      if (!iface) {
        const anyVersion = input.interfaces.some((i) => i.key === ref.interfaceKey);
        out.push({
          code: anyVersion ? "INTERFACE_NOT_PUBLISHED" : "INTERFACE_NOT_FOUND",
          typeKey: t.key,
          interfaceKey: ref.interfaceKey,
          message: anyVersion
            ? `类型 ${t.key} 声明实现接口 ${ref.interfaceKey}@${ref.version}，但该版本不存在或未发布`
            : `类型 ${t.key} 声明实现接口 ${ref.interfaceKey}，但该接口不存在`,
        });
        continue;
      }
      if (iface.status === "RETIRED") {
        out.push({
          code: "INTERFACE_RETIRED",
          typeKey: t.key,
          interfaceKey: iface.key,
          interfaceVersion: iface.version,
          message: `类型 ${t.key} 仍实现已退役接口 ${iface.key}@v${iface.version}（需显式迁移到新版本或摘除 implements）`,
        });
        continue;
      }
      resolved.push({ ref, iface });
    }

    const propIndex = new Map<string, InterfaceDataType>();
    for (const p of t.properties) propIndex.set(p.propKey, p.dataType);
    // 派生属性走数值管线 → 视为 number（既是真值来源，也不许被当成 string 冒充）
    for (const dp of t.derivedPropKeys ?? []) if (!propIndex.has(dp)) propIndex.set(dp, "number");
    const boundActions = new Set((t.actions ?? []).map((a) => a.actionTypeKey));

    // 2) 跨接口冲突（同 propKey 被多个接口要求 → 必须存在能同时满足两侧的 dataType）
    const byProp = new Map<string, { iface: ObjectInterface; req: InterfacePropertyRequirement }[]>();
    for (const { iface } of resolved) {
      for (const req of iface.properties) {
        const arr = byProp.get(req.propKey) ?? [];
        arr.push({ iface, req });
        byProp.set(req.propKey, arr);
      }
    }
    const conflicted = new Set<string>();
    for (const [propKey, reqs] of [...byProp.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (reqs.length < 2) continue;
      for (let i = 0; i < reqs.length; i++) {
        for (let j = i + 1; j < reqs.length; j++) {
          const a = reqs[i]!;
          const b = reqs[j]!;
          if (jointSatisfiers(a.req.dataType, b.req.dataType).length > 0) continue;
          conflicted.add(propKey);
          out.push({
            code: "INTERFACE_PROPERTY_CONFLICT",
            typeKey: t.key,
            interfaceKey: `${a.iface.key},${b.iface.key}`,
            propKey,
            message:
              `类型 ${t.key} 同时实现 ${a.iface.key}@v${a.iface.version} 与 ${b.iface.key}@v${b.iface.version}，` +
              `二者对属性 '${propKey}' 要求互不相容的数据类型（${a.req.dataType} vs ${b.req.dataType}）——` +
              `平台不会替你静默取其一，请显式收敛接口定义`,
          });
        }
      }
    }

    // 3) 属性 / 行动 / 函数
    for (const { iface } of resolved) {
      for (const req of iface.properties) {
        if (conflicted.has(req.propKey)) continue; // 冲突已报，不再叠加误导性的"缺失/不匹配"
        const actual = propIndex.get(req.propKey);
        if (actual === undefined) {
          if (req.required === false) continue;
          out.push({
            code: "INTERFACE_PROPERTY_MISSING",
            typeKey: t.key,
            interfaceKey: iface.key,
            interfaceVersion: iface.version,
            propKey: req.propKey,
            message: `类型 ${t.key} 声明实现 ${iface.key}@v${iface.version}，但缺少必需属性 '${req.propKey}'（${req.dataType}）`,
          });
          continue;
        }
        if (!dataTypeSatisfies(req.dataType, actual)) {
          out.push({
            code: "INTERFACE_PROPERTY_TYPE_MISMATCH",
            typeKey: t.key,
            interfaceKey: iface.key,
            interfaceVersion: iface.version,
            propKey: req.propKey,
            message: `类型 ${t.key} 的属性 '${req.propKey}' 类型为 ${actual}，不满足 ${iface.key}@v${iface.version} 要求的 ${req.dataType}`,
          });
        }
      }

      for (const a of iface.actions ?? []) {
        if (a.required === false) continue;
        if (!boundActions.has(a.actionTypeKey)) {
          out.push({
            code: "INTERFACE_ACTION_MISSING",
            typeKey: t.key,
            interfaceKey: iface.key,
            interfaceVersion: iface.version,
            actionTypeKey: a.actionTypeKey,
            message: `类型 ${t.key} 声明实现 ${iface.key}@v${iface.version}，但未绑定必需行动 '${a.actionTypeKey}'`,
          });
        }
      }

      for (const f of iface.functions ?? []) {
        const sig = input.solverSignatures?.[f.solverKey];
        if (!sig) {
          if (input.solverSignatures) {
            out.push({
              code: "INTERFACE_FUNCTION_UNKNOWN",
              typeKey: t.key,
              interfaceKey: iface.key,
              interfaceVersion: iface.version,
              solverKey: f.solverKey,
              message: `类型 ${t.key} 实现的 ${iface.key}@v${iface.version} 声明函数 '${f.solverKey}'，但它不在求解器签名注册表内`,
            });
          }
          continue;
        }
        // **P2 兑现点**：签名说这个求解器在本类型上要读哪些属性 → 类型必须真有，否则行为跑不通。
        for (const surface of sig.reads ?? []) {
          if (surface.typeKey !== t.key || surface.propKeys === undefined) continue;
          const missing = surface.propKeys.filter((p) => !propIndex.has(p)).sort();
          if (missing.length > 0) {
            out.push({
              code: "INTERFACE_FUNCTION_UNSATISFIED",
              typeKey: t.key,
              interfaceKey: iface.key,
              interfaceVersion: iface.version,
              solverKey: f.solverKey,
              propKey: missing[0],
              message:
                `类型 ${t.key} 实现 ${iface.key}@v${iface.version} 的函数 '${f.solverKey}' 无法兑现：` +
                `该求解器的本体签名声明会读取 ${t.key}.{${missing.join(",")}}，但类型上不存在这些属性`,
            });
          }
        }
      }
    }
  }
  return out.sort(sortViolations);
}

/** 把违规清单压成一条可读的发布拒绝原因（点名到 类型→接口→缺失项）。 */
export function formatInterfaceViolations(violations: InterfaceViolation[]): string {
  return violations.map((v) => `[${v.code}] ${v.message}`).join("；");
}
