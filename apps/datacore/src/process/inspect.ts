import type {
  LeverDomainReach,
  ProcessDefinition,
  ProcessDomain,
  ProcessInspectCarrier,
  ProcessInspectRelation,
  ProcessInspectResponse,
  ProcessInspectSibling,
  SliceLayersResponse,
} from "@platform/contracts";
import { PROCESS_OWNER_FUNCTIONS } from "@platform/contracts";
import type { LinkTypeDef, ObjectTypeDef, SliceSpecRecord } from "../domain.js";

/**
 * WO-V4-INSPECT · 业务流程节点检视投影（PRD-sandbox-v4-backward-derivation §4.1 + §4.2）。
 *
 * ── 这个模块是什么 ───────────────────────────────────────────────────────────
 * 「点开一条业务流程，看它的完整本体关系」= **一次纯 join**，不是一次新建模：
 *
 *   ProcessDefinition ──carrierTypeKey──▶ ObjectTypeDef ──OntologyLink──▶ 一跳邻居类型
 *          │                                    ▲
 *          └── domainKey ▶ ProcessDomain        └── 反查 carrierTypeKey 相同者 = 同承载物流程
 *
 * **零新真值源**：入参即全部输入（调用方从 repos 装配），本模块不做 IO、不写任何东西。
 * 纯函数（R6 确定性）：无 `Date.now()` / 无随机 / 全部字典序，同入参同出参。
 *
 * ── 三条硬约束（对应 PRD 与本仓既有纪律，不是装饰）───────────────────────────
 *
 * ① **`carrierTypeKey` 解析不到是一个必须处理的态**。种子期**不校验**它存在
 *    （判据在 `apps/datacore/test/process-layer.test.ts`），所以 join 不上是**可能发生的**，
 *    不是「不可能的异常」。此时 `carrier.status="absent"` + 说明缺在哪一环，
 *    路由仍返回 200 —— 流程本身存在，缺的是它的承载物。**不许崩，也不许假设一定 join 得上。**
 *
 * ② **不下发运行态**。`ProcessTask` / `ProcessInstance` 全仓不存在 ⇒
 *    「此刻卡了多久 / 有几单堵着 / 实测在制品数」**答不出来**。
 *    只给 `stdDurationDays` 并在 `runtime` 里如实标口径，
 *    ⛔ **绝不拿标准工期冒充实测卡顿**（`GET /a/v1/process-definitions` 已立此规矩）。
 *    诚实位是**结构化字段**（`runtime.available/reason/unanswerable`）而不是前端一句文案 ——
 *    写在前端的诚实位会随改版蒸发，字段能被测试咬住（`G-FRONTEND-HARDCODED-ABSENCE`）。
 *
 * ③ **十六层复用 `ontology/slice-layers.ts`，不另造一套**。承载类型解析不到 ⇒ 层为 `null`
 *    + 说明，**不返回 16 个空壳假装算过**。
 *
 * ── R14：前端零写死词表 ─────────────────────────────────────────────────────
 * 流程名 / 域名 / 职能名 / 类型中文名 / 属性中文名 / 单位一律随响应下发；
 * 查不到就给 `null`（前端诚实回落裸键），**绝不臆造中文名**。
 */

const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** 缺省即"未确证"：一律 `null`，不回落成空串（空串在界面上和"有值但为空"分不开）。 */
const orNull = <T>(v: T | undefined | null): T | null => (v === undefined || v === null ? null : v);

/** §2 责任职能登记册 → 中文名。契约不闭合（种子可用未登记的 key），故查不到给 `null`。 */
const OWNER_FUNCTION_NAME = new Map<string, string>(PROCESS_OWNER_FUNCTIONS.map((f) => [f.key, f.displayName]));

/** 杠杆落点解析：与 `scripts/check-lever-prop-resolvable.mjs` 同一判据（三个承载位都算数）。 */
export function resolveLeverLanding(
  typeByKey: Map<string, ObjectTypeDef>,
  typeKey: string,
  propKey: string,
): { resolved: boolean; where: string | null } {
  const t = typeByKey.get(typeKey);
  if (!t) return { resolved: false, where: null };
  if (t.properties.some((p) => p.propKey === propKey)) return { resolved: true, where: "properties" };
  if ((t.derivedProperties ?? []).some((p) => p.propKey === propKey)) return { resolved: true, where: "derivedProperties" };
  if ((t.stateVariables ?? []).some((p) => p.propKey === propKey)) return { resolved: true, where: "stateVariables" };
  return { resolved: false, where: null };
}

/**
 * PRD §4.1 · 杠杆 → 承载类型 → 流程 → 业务域 的**一跳查表**（零手抄）。
 *
 * ⛔ 前端不许写死「这条杠杆影响哪几个域」的字面量表 —— 那正是本仓
 * 「两个 dev 各发明一套词表、交集为 0」那次事故的形态。此函数即那张表的唯一算法。
 *
 * 诚实边界：`processKeys` 为空**不是 bug**，它是一个真实结论 ——
 * 「这条杠杆的承载类型今天没有任何业务流程落在它上面」。空数组和空说明是两回事，
 * 界面必须把空数组当成一句话显示出来，而不是画一个空格子。
 */
export function buildLeverDomainReach(
  leverMeta: Record<string, { label: string; unit: string; kind: string }>,
  typeByKey: Map<string, ObjectTypeDef>,
  definitions: ProcessDefinition[],
  domainByKey: Map<string, ProcessDomain>,
): LeverDomainReach[] {
  return Object.keys(leverMeta)
    .sort(by)
    .map((leverKey) => {
      const i = leverKey.lastIndexOf(".");
      const objectTypeKey = i > 0 ? leverKey.slice(0, i) : leverKey;
      const propKey = i > 0 ? leverKey.slice(i + 1) : "";
      const meta = leverMeta[leverKey]!;
      const landing = resolveLeverLanding(typeByKey, objectTypeKey, propKey);
      const hit = definitions.filter((d) => d.carrierTypeKey === objectTypeKey).sort((a, b) => by(a.key, b.key));
      const domainKeys = [...new Set(hit.map((d) => d.domainKey))].sort(by);
      return {
        leverKey,
        objectTypeKey,
        propKey,
        label: meta.label,
        unit: meta.unit,
        valueKind: meta.kind,
        landingResolved: landing.resolved,
        landingWhere: landing.where,
        processKeys: hit.map((d) => d.key),
        domains: domainKeys.map((k) => ({ key: k, name: orNull(domainByKey.get(k)?.name) })),
      };
    });
}

/** 本模块的全部输入（调用方从 repos 装配；本模块不做 IO）。 */
export interface ProcessInspectInput {
  /** 被检视的流程本身。 */
  definition: ProcessDefinition;
  /** 全租户流程（用于反查同承载物流程 + 杠杆域映射）。 */
  allDefinitions: ProcessDefinition[];
  /** 全租户一级业务域。 */
  domains: ProcessDomain[];
  /** 全租户已发布对象类型。 */
  types: ObjectTypeDef[];
  /** 全租户链路定义（一跳关系的真值源）。 */
  linkTypes: LinkTypeDef[];
  /** typeKey → 本租户可见对象数（A6 行级过滤后）。只装填用得到的那几个类型，其余缺席即 `null`。 */
  objectCounts: Map<string, number>;
  /** 杠杆元数据表（`LEVER_PROP_META`，单一真值）。 */
  leverMeta: Record<string, { label: string; unit: string; kind: string }>;
  /** 承载类型的十六层投影；承载类型解析不到时传 `null`。 */
  carrierLayers: SliceLayersResponse | null;
}

/**
 * 构造给 `executeSlice` 用的**即席一跳切片规格**（root = 承载类型，paths = 每条一跳链路各一条）。
 *
 * 为什么要真跑一次 `executeSlice` 而不是自己拼一个假 graph：十六层投影的层计数是**对着真子图数的**，
 * 拿手工造的 nodes/edges 喂进去，屏上那些数字就成了编的 —— 那正是本单要消灭的东西。
 * `maxNodes` 给一个保守上界：这是一个"点开看看"的面板，不是导出全图。
 */
export function adhocCarrierSliceSpec(
  carrierTypeKey: string,
  linkTypes: LinkTypeDef[],
  maxNodes = 300,
): SliceSpecRecord["spec"] {
  const paths = linkTypes
    .filter((l) => l.fromTypeKey === carrierTypeKey || l.toTypeKey === carrierTypeKey)
    .sort((a, b) => by(a.key, b.key))
    // 自环（from == to）走 out 一次即可，两条会把同一批边数两遍。
    .map((l) => [{ linkKey: l.key, direction: (l.fromTypeKey === carrierTypeKey ? "out" : "in") as "out" | "in" }]);
  return { root: { typeKey: carrierTypeKey, selector: {} }, paths, maxNodes };
}

/** 即席切片的 sliceKey 命名（一处定义，测试与路由共用；**不是**任何已存 slice_specs 记录）。 */
export const adhocCarrierSliceKey = (processKey: string): string => `process-inspect:${processKey}`;

export function projectProcessInspect(input: ProcessInspectInput): ProcessInspectResponse {
  const d = input.definition;
  const domainByKey = new Map(input.domains.map((x) => [x.key, x]));
  const typeByKey = new Map(input.types.map((t) => [t.key, t]));
  const carrierType = typeByKey.get(d.carrierTypeKey);

  // ── 承载类型：present / absent 两态 ────────────────────────────────────────
  const carrier: ProcessInspectCarrier = carrierType
    ? {
        status: "present",
        typeKey: carrierType.key,
        displayName: orNull(carrierType.displayName),
        domain: orNull(carrierType.domain),
        description: orNull(carrierType.description),
        properties: (() => {
          const derivedKeys = new Set((carrierType.derivedProperties ?? []).map((x) => x.propKey));
          return [...carrierType.properties]
            .sort((a, b) => by(a.propKey, b.propKey))
            .map((p) => ({
              propKey: p.propKey,
              displayName: orNull(p.displayName),
              dataType: p.dataType,
              unit: orNull(p.unit),
              isPrimaryKey: p.isPrimaryKey === true,
              description: orNull(p.description),
              enumValues: p.enumValues && p.enumValues.length > 0 ? [...p.enumValues] : null,
              derived: derivedKeys.has(p.propKey),
            }));
        })(),
        derivedProperties: [...(carrierType.derivedProperties ?? [])]
          .sort((a, b) => by(a.propKey, b.propKey))
          .map((x) => {
            // 派生属性没有自己的 displayName/unit 槽位（DerivedPropertyDef 只有 propKey+formula），
            // 故回落到同名 PropertyDef 的元数据（`interBaseTransfer.etaDay` / `MaterialBalance.coverage`
            // 都是「同时登记在 properties 里」的既有先例）；没有同名 PropertyDef 就诚实给 null。
            const p = carrierType.properties.find((y) => y.propKey === x.propKey);
            return { propKey: x.propKey, displayName: orNull(p?.displayName), unit: orNull(p?.unit), formula: x.formula };
          }),
        objectCount: input.objectCounts.get(carrierType.key) ?? 0,
        absentReason: null,
      }
    : {
        status: "absent",
        typeKey: d.carrierTypeKey,
        displayName: null,
        domain: null,
        description: null,
        properties: [],
        derivedProperties: [],
        objectCount: null,
        absentReason:
          `流程 ${d.key} 的承载类型 \`${d.carrierTypeKey}\` 在本租户已发布本体（${input.types.length} 个对象类型）里**查不到**。` +
          `缺在「ProcessDefinition.carrierTypeKey → ObjectTypeDef」这一跳：种子期不校验该类型存在（判据在 test/process-layer.test.ts），` +
          `所以这里是「配了一个还没建模的承载物」，不是本页取数失败。` +
          `修法二选一：把该类型建进本体，或把这条流程的 carrierTypeKey 改指一个真实存在的类型。`,
      };

  // ── 一跳关系（沿 OntologyLink，带方向与基数）────────────────────────────────
  // 承载类型 absent 时**照样能算**：链路表是独立的，只是几乎必然为空。
  // 这里不提前 return —— 「没有关系」和「没算过关系」在屏上必须分得开。
  const relations: ProcessInspectRelation[] = input.linkTypes
    .filter((l) => l.fromTypeKey === d.carrierTypeKey || l.toTypeKey === d.carrierTypeKey)
    .sort((a, b) => by(a.key, b.key))
    .map((l) => {
      const direction: "out" | "in" = l.fromTypeKey === d.carrierTypeKey ? "out" : "in";
      const neighborTypeKey = direction === "out" ? l.toTypeKey : l.fromTypeKey;
      const nt = typeByKey.get(neighborTypeKey);
      return {
        linkKey: l.key,
        direction,
        fromTypeKey: l.fromTypeKey,
        toTypeKey: l.toTypeKey,
        cardinality: l.cardinality,
        neighborTypeKey,
        neighborDisplayName: orNull(nt?.displayName),
        // 类型查不到 ⇒ null（"这一类不存在"）；类型在但没对象 ⇒ 0（"这一类还没有数据"）。两者不许合并。
        neighborObjectCount: nt ? (input.objectCounts.get(neighborTypeKey) ?? 0) : null,
      };
    });

  // ── 同承载物的其它流程（反查 carrierTypeKey 相同者，不含自己）──────────────
  const sharedCarrierProcesses: ProcessInspectSibling[] = input.allDefinitions
    .filter((x) => x.carrierTypeKey === d.carrierTypeKey && x.key !== d.key)
    .sort((a, b) => by(a.key, b.key))
    .map((x) => ({
      key: x.key,
      name: x.name,
      domainKey: x.domainKey,
      domainName: orNull(domainByKey.get(x.domainKey)?.name),
      ownerFunctionKey: x.ownerFunctionKey,
      ownerFunctionName: orNull(OWNER_FUNCTION_NAME.get(x.ownerFunctionKey)),
      waitKind: x.waitKind,
      stdDurationDays: x.stdDurationDays,
    }));

  // ── 打到本流程承载类型的杠杆（PRD §4.1 反查方向）─────────────────────────────
  const levers = buildLeverDomainReach(input.leverMeta, typeByKey, input.allDefinitions, domainByKey).filter(
    (l) => l.objectTypeKey === d.carrierTypeKey,
  );

  return {
    process: {
      key: d.key,
      domainKey: d.domainKey,
      name: d.name,
      ownerFunctionKey: d.ownerFunctionKey,
      stdDurationDays: d.stdDurationDays,
      waitKind: d.waitKind,
      carrierTypeKey: d.carrierTypeKey,
      domainName: orNull(domainByKey.get(d.domainKey)?.name),
      ownerFunctionName: orNull(OWNER_FUNCTION_NAME.get(d.ownerFunctionKey)),
    },
    runtime: {
      available: false,
      /**
       * ⚠ **2026-08-14 照实重写（WO-R9-PROCESS-MERGE）—— 原文已成谎话。**
       *
       * 原文写「`ProcessTask` / `ProcessInstance` 两个承载物**全仓不存在**」。
       * 那句话在 2026-08-10 属实，但此后 WO-PROCESS-INSTANCE 与 WO-FLOWTIME **各自把它建出来了**
       * （`migrations/033` + `contracts/process-instance.ts`），合并后两者收敛成一个承载物。
       * 一个说「这做不到」的诚实位在能力做出来之后没人回写，就从"诚实"变成"说谎"——
       * 而且是最难发现的一种：它看起来还很谦虚。**本仓 `G-FRONTEND-HARDCODED-ABSENCE` 记的就是这个病。**
       *
       * 🔴 但 `available` 仍是 `false`，这不是妥协是**分层**：本投影是**定义层**的
       * （它答「这条流程长什么样、承载物是谁、哪些杠杆打得到」），运行态本就不该由它下发。
       * 缺席理由因此从「平台做不到」改成「**本投影不答，去哪儿答**」——
       * 前者是能力声明（已过期），后者是路由说明（长期成立）。
       */
      reason:
        "本投影**不下发运行态**，但这不再是「平台做不到」：`ProcessInstance` 承载物已落地" +
        "（`migrations/033_process_instances.sql`），`ProcessTask` 亦已落地（运行时层的步）。" +
        "本端点是**定义层**投影（答「这条流程长什么样」），运行态属**实例层**，请走 " +
        "`GET /a/v1/process-definitions/{key}/instances`（站间时长/卡在谁那里/溯源）" +
        "或求解器 `process_flow_time`。此处的 `stdDurationDays` 是标准工期，" +
        "⛔ **任何时候都不得当作「此刻已卡多久」读** —— 这一条一个字都没有放宽。",
      stdDurationDays: d.stdDurationDays,
      stdDurationCaption: "标准工期（配置值，天）—— 不是实测卡顿时长",
      unanswerable: [
        "这个流程此刻已经卡了多久？（本投影不答；走 /process-definitions/{key}/instances 的 flowTime）",
        "现在有几单堵在这一步？（本投影不答；同上端点的 instanceCount + stuckProcessKey）",
        "实测在制品数是多少？（**仍然答不出**：需要流程引擎/MES 直采即 origin=MEASURED，今天 0 条；" +
          "今天的实例全部是从既有单据反推的 DERIVED_FROM_DOCUMENT，反推不出在制品实时计数）",
      ],
    },
    carrier,
    relations,
    sharedCarrierProcesses,
    levers,
    carrierLayers: input.carrierLayers,
    carrierLayersAbsentReason:
      input.carrierLayers !== null
        ? null
        : carrier.status === "absent"
          ? `十六层投影**没有算**：它的 root 是承载类型 \`${d.carrierTypeKey}\`，而该类型在本体里查不到（见 carrier.absentReason）。` +
            `返回 null 而不是 16 个空层 —— 「没算过」和「算了但为空」是两件事，混成一个「无」就是把缺口藏起来。`
          : `十六层投影没有算（承载类型在本体里查得到，但本次未装配层输入）。`,
  };
}
