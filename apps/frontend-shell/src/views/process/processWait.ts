import {
  PROCESS_WAIT_KINDS,
  type ProcessDefinition,
  type ProcessDomain,
  type ProcessWaitKind,
  // WO-FLOWTIME · 流程实例层类型**全部复用契约**，前端一个都不重定义（R1 contracts-only-shared）
  type ProcessFlowAbsence,
  type ProcessInstance,
  type ProcessStationDwell,
  // WO-R9-PROCESS-MERGE · 实例层等待态是**五值**（含 WAITING_APPROVAL），模板层仍是四值
  type ProcessTaskWaitState,
  type ProcessWaitStateOrigin,
} from "@platform/contracts";
import { zh } from "@/locales/zh";

/**
 * WO-WAITING-STATES-FE · 业务流程等待态（`waitKind`）前端模型层（纯函数，无 React）。
 *
 * ══ 这张页面回答什么，以及它**不是**什么 ══════════════════════════════════════
 *
 * 回答需求 §20 那一问：**「为什么这个流程现在卡住了」**。
 * 后端 65 条 `ProcessDefinition` 每条都带 `waitKind`（卡在哪一类等待）·
 * `ownerFunctionKey`（谁做）· `stdDurationDays`（标准工期），此前**一个字都没到前端**。
 *
 * ⚠ 与 `views/sim/ChainImpedimentView`（全链阻滞点）**不是同一件事，别合并**：
 *
 * |            | 全链阻滞点（`chain-impediments`）      | 本页（`process-wait`）              |
 * |------------|---------------------------------------|-------------------------------------|
 * | 层         | 链路节拍层（24 个冻结节点）           | 业务流程层（65 条流程·配置驱动）    |
 * | 数据来源   | 引擎求解器 `chain_impediments` 实时算 | `GET /a/v1/process-definitions` 配置 |
 * | 回答       | 哪里被卡住了、凭哪条规则说它被卡住    | 这条流程**在等哪一类东西、等谁**    |
 * | 时间口径   | 引擎算出的耗时 / 阈值                 | **标准工期**（配置基线·见下诚实边界）|
 *
 * 两层的关系是契约里写死的（`packages/contracts/src/process.ts:74-75`）：
 * `WAITING_SCHEDULE` 与 `chain-sim.ts` 的 `expectedCadenceWaitDays = everyDays/2`
 * 「是同一类等待的两层表述：那里算**多久**，这里只标**是哪一类**」。
 * 故本文件**不复制那条公式**（复制即第二真相源）。
 *
 * ══ 🔴 词表单源：四态不是五态，且前端一个字面量都不许自己写 ═══════════════════
 *
 * 迭代序与集合**一律取自** `PROCESS_WAIT_KINDS`（契约 §1 唯一词表）。
 * 契约注释原文：「任何一侧（数据种子 / 引擎 / 前端）再写一份字面量数组就是回退到
 * 『两个 dev 各发明一套词表、交集为 0』出事前的状态」。
 *
 * 词表**刻意只有四种**，没有 `WAITING_APPROVAL` —— 仓主已裁「流程审批不体现」
 * （`PRD-UPGRADE-decision-sandbox-v2 §6.4 #1`，`PRD-enterprise-decision-twin.md §4.2` 整节裁撤）。
 * 那是**诚实缺席，不是漏写**：补第五态会同时打红 `process-layer.test.ts:99/106/114`
 * 三条断言，并让平台开始承诺一个它不做的能力。取证见 `docs/WO-WAITING-STATES-FE-evidence.md` §2。
 *
 * 机制（不靠自觉）：`WAIT_KIND_ORDER` 由 `PROCESS_WAIT_KINDS` 派生而非手抄；
 * 文案表类型是 `Record<ProcessWaitKind, …>` ⇒ 契约哪天真加了第五态，**编译期就红**，
 * 不会出现「后端多一态、前端静默漏画」这种本仓栽过的漂移。
 *
 * ══ 诚实边界（**2026-08-13 已部分闭合，照实回写**）══════════════════════════════
 *
 * 原文（截至 2026-08-10 属实，现已过期，保留以备对照）：
 *   「本页答不出『此刻已经卡了多久』。那需要 `ProcessTask.enteredAt`，而
 *     `ProcessTask` / `ProcessInstance` **全仓不存在**（实测 `grep -rn 'ProcessTask\|ProcessInstance'
 *     apps packages --include=*.ts` 零命中）。」
 *
 * **现状（WO-FLOWTIME）**：`ProcessInstance` 承载物已落地（契约 `process-instance.ts` +
 * `migrations/033_process_instances.sql`），本页可经 `GET /a/v1/process-definitions/:key/instances`
 * 下钻到**实例粒度**：卡了多久 · 卡在谁那里 · 站间流转多久（见 §5）。
 *
 * ⚠ **但两条诚实边界一条都没放宽**：
 *  ① 实例时刻是**从既有带时间戳单据反推**的（`origin=DERIVED_FROM_DOCUMENT`），
 *    **不是**流程引擎直采（那一档叫 `MEASURED`，今天 0 条）。每条带 `sourceDocuments[]` 可当场溯源。
 *  ② 65 条流程里**只有 9 条反推得出**，其余 56 条返回 `available:false` + 缺席理由 + 复验探针
 *    （逐条清单见 `docs/WO-FLOWTIME-feasibility.md`）。
 * 且 `stdDurationDays`（**标准工期**）在本页**永远只是对照列** ——
 * **绝不拿标准工期冒充「已卡 N 天」**，那正是本仓「拿一个看起来相关的数字冒充读数」的老病。
 */

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 词表派生（单源）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 渲染顺序 = 契约词表顺序。**派生，不是手抄** —— 手抄一份就是第二真相源，
 * 而且抄的那一刻是对的、契约改了之后才悄悄错，正是最难发现的一类漂移。
 */
export const WAIT_KIND_ORDER: readonly ProcessWaitKind[] = PROCESS_WAIT_KINDS;

/**
 * 每个等待态的**视觉标识**（色 token + 记号）。
 *
 * 需求判据原文：「每个态都要有**可辨识的视觉区分**（不是 5 个都显示同一个『等待中』）——
 * 需求要的是回答『为什么卡住』，5 个态混成一个字就等于没做」。
 * 故四态四色四记号四句文案，**不合并**。
 *
 * 颜色一律用 `styles/tokens.css` 的**语义域色** `--c-*`：它们定义在裸 `:root`、
 * 且不在 light/warm 两套主题的覆盖集合里（tokens.css:106 明写 `--c-*` 属主题不变量）
 * ⇒ 三套皮下都不会失效。**零 hex 字面量**（与 `chain-impediment` 同一条纪律）。
 *
 * 选色理由（语义贴合，不是随手挑）：
 *  · 等人      → `--c-people`（人员/班组域色）
 *  · 等数据    → `--c-forecast`（预测/需求域色 = 数据齐不齐）
 *  · 等外部    → `--c-equip`（设备/外部接口域色）
 *  · 等节拍    → `--c-capacity`（产能/节拍域色）
 */
export const WAIT_KIND_STYLE: Record<ProcessWaitKind, { colorVar: string; mark: string }> = {
  WAITING_USER: { colorVar: "--c-people", mark: "人" },
  WAITING_DATA: { colorVar: "--c-forecast", mark: "数" },
  WAITING_EXTERNAL_SYSTEM: { colorVar: "--c-equip", mark: "外" },
  WAITING_SCHEDULE: { colorVar: "--c-capacity", mark: "钟" },
};

/** 文案取 `locales/zh.ts`（i18n 结构预留）；本模块不内联任何中文业务文案。 */
export const WAIT_KIND_COPY = zh.processWait.waitKind;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 响应形状（与真后端 `GET /a/v1/process-definitions` 逐字段一致）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ 本接口形状是**与真后端对账**的产物，不是前端一厢情愿：
 * 逐字段对应 `apps/datacore/src/app.ts` 的 `GET /a/v1/process-definitions` 返回体。
 * mock（`mocks/handlers.ts`）必须与本形状一致 —— 本仓有过「mock 与真后端分家、
 * 测试咬 mock 恒绿」的真事故，故 mock fixture 由种子的**真实子集**构成，不另编一套。
 */
export interface ProcessDefinitionsResponse {
  domains: ProcessDomain[];
  definitions: ProcessDefinition[];
  /** 后端下发的词表本身（前端只做完整性校验，不用它替代 `PROCESS_WAIT_KINDS` 的编译期约束）。 */
  waitKinds: readonly string[];
  ownerFunctions: readonly { key: string; displayName: string }[];
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

export interface ProcessRowVM {
  key: string;
  name: string;
  waitKind: ProcessWaitKind;
  /** 域展示名（查不到 → 回退为 domainKey 原文，**不静默吞掉**）。 */
  domainKey: string;
  domainName: string;
  /** 「等谁」的具体落点：责任职能展示名（查不到 → 回退 key 原文）。 */
  ownerFunctionKey: string;
  ownerName: string;
  /** **标准**工期（天）。不是「已经卡了多久」—— 见文件头诚实边界。 */
  stdDurationDays: number;
  carrierTypeKey: string;
}

export interface WaitKindGroupVM {
  kind: ProcessWaitKind;
  /** 该态下的流程条数。 */
  count: number;
  /** 该态累计标准工期（天）—— 回答「哪一类等待吃掉的工期最多」。 */
  totalStdDays: number;
  /** 占全部流程标准工期总和的百分比（0–100，一位小数）。空集合 ⇒ 0。 */
  pctOfTotalStdDays: number;
  /** 「等谁」的聚合：该态下涉及的责任职能展示名（去重，按流程数降序）。 */
  owners: { key: string; name: string; count: number }[];
  rows: ProcessRowVM[];
}

export interface ProcessWaitModel {
  totalProcesses: number;
  totalStdDays: number;
  /** 四态分组，**恒为四条**（空态也保留，见下方判据）。 */
  groups: WaitKindGroupVM[];
  /** 后端下发词表与契约词表的差集 —— 非空即为接缝漂移，页面要显式说出来而不是默默少画一组。 */
  vocabDrift: { missingInResponse: string[]; unknownInResponse: string[] };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 把后端响应折成视图模型。
 *
 * ── 判据①：四态**恒出现四组**，空态也画 ──────────────────────────────────────
 * 某一态本轮 0 条流程 ⇒ 仍渲染该组并显示「本租户暂无此类等待」。
 * 反面做法（`groups = groupBy(...)` 直接得几组画几组）会让「这个租户没有等外部的流程」
 * 与「前端漏画了这一态」在屏幕上**长得一模一样** —— 本仓 `provenRed` 存在的理由：
 * 集合里根本没有这一项时，针对它的断言会**恒真**，是哑门。
 *
 * ── 判据②：排序确定性（R6）────────────────────────────────────────────────────
 * 组内按 `key`（P01…P65）升序，不依赖后端返回序，也不依赖 Map 迭代序。
 *
 * ── 判据③：查不到的引用**回退为原文并可见**，不静默吞 ─────────────────────────
 * `domainKey` / `ownerFunctionKey` 在登记册里查不到时回退显示原 key。
 * 静默显示空字符串会把「数据接缝断了」伪装成「这条没有域」。
 */
export function buildProcessWaitModel(res: ProcessDefinitionsResponse): ProcessWaitModel {
  const domainName = new Map(res.domains.map((d) => [d.key, d.name]));
  const ownerName = new Map(res.ownerFunctions.map((f) => [f.key, f.displayName]));

  const rows: ProcessRowVM[] = [...res.definitions]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({
      key: p.key,
      name: p.name,
      waitKind: p.waitKind,
      domainKey: p.domainKey,
      domainName: domainName.get(p.domainKey) ?? p.domainKey,
      ownerFunctionKey: p.ownerFunctionKey,
      ownerName: ownerName.get(p.ownerFunctionKey) ?? p.ownerFunctionKey,
      stdDurationDays: p.stdDurationDays,
      carrierTypeKey: p.carrierTypeKey,
    }));

  const totalStdDays = rows.reduce((s, r) => s + r.stdDurationDays, 0);

  const groups: WaitKindGroupVM[] = WAIT_KIND_ORDER.map((kind) => {
    const mine = rows.filter((r) => r.waitKind === kind);
    const groupStdDays = mine.reduce((s, r) => s + r.stdDurationDays, 0);
    const byOwner = new Map<string, { key: string; name: string; count: number }>();
    for (const r of mine) {
      const hit = byOwner.get(r.ownerFunctionKey);
      if (hit) hit.count += 1;
      else byOwner.set(r.ownerFunctionKey, { key: r.ownerFunctionKey, name: r.ownerName, count: 1 });
    }
    return {
      kind,
      count: mine.length,
      totalStdDays: round1(groupStdDays),
      pctOfTotalStdDays: totalStdDays > 0 ? round1((groupStdDays / totalStdDays) * 100) : 0,
      // 降序按条数；同条数按职能 key 升序 —— tie-break 必须确定，否则同输入两次渲染不同序（违 R6）。
      owners: [...byOwner.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      rows: mine,
    };
  });

  // 词表漂移对账：后端下发的词表 vs 契约词表。任一侧多/少都要在页面上说出来。
  const contractSet = new Set<string>(WAIT_KIND_ORDER);
  const responseSet = new Set(res.waitKinds);
  return {
    totalProcesses: rows.length,
    totalStdDays: round1(totalStdDays),
    groups,
    vocabDrift: {
      missingInResponse: [...contractSet].filter((k) => !responseSet.has(k)),
      unknownInResponse: [...responseSet].filter((k) => !contractSet.has(k)),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · WO-FLOWTIME · 流程**实例**层响应形状（`GET /a/v1/process-definitions/:key/instances`）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ 与 §2 同一条纪律：本形状逐字段对应 `apps/datacore/src/app.ts` 的
 * `GET /a/v1/process-definitions/:key/instances` 返回体，**类型全部复用契约**
 * （`ProcessInstance` / `ProcessFlowAbsence` / `ProcessStationDwell` 直接从
 *  `@platform/contracts` import），前端一个字段都不重定义（R1 contracts-only-shared）。
 *
 * 这一段补上了本页此前那句「答不了『此刻已经卡了多久』」——
 * 承载物（`ProcessInstance`）现在有了，时刻由**既有带时间戳单据反推**而来
 * （`origin=DERIVED_FROM_DOCUMENT`，每条带 `sourceDocuments[]` 可当场溯源）。
 * ⛔ `definition.stdDurationDays` 仍然只是**对照列**：它是标准工期，不是实测滞留。
 *
 * **2026-08-14 实测**（合并后复验，battery/S/seed=42）：反推侧一次产出 >500 条实例、
 * >300 条链，且每条实例的 `sourceDocuments[].rawValue` 与仓储里那个字段的值**逐条相等**。
 * 复验：`pnpm --filter datacore exec vitest run test/process-flow-time.seam.test.ts`（断言 ①），
 * 或直接 `curl -s -H 'X-Debug-User: demo:admin:admin' \
 * 'http://127.0.0.1:4001/a/v1/process-definitions/P34/instances' | jq '{available,instanceCount}'`。
 * ⚠️ 保质期：上游种子（`seedBattery` / `flow-rules.ts` 规则表）一变，上面这些数即失真，
 * 必须复测改写而不是加豁免。
 */
export interface ProcessInstancesResponse {
  definition: ProcessDefinition;
  /** 分析截止时刻，与它是怎么定的（R13：不让读的人去猜这个「现在」哪来的）。 */
  asOf: string;
  asOfSource: "ARG" | "DATA_LATEST" | "FORECAST_START";
  /** 反推得出 ⇒ true；反推不出 ⇒ false + `absence`（**不是空数组冒充「没有卡顿」**）。 */
  available: boolean;
  absence: ProcessFlowAbsence | null;
  /** 全量基数（不受 limit 截断影响）。 */
  instanceCount: number;
  instances: ProcessInstance[];
  instancesShown: number;
  flowTime: {
    flowKey: string;
    totalDays: number;
    bottleneckProcessKey: string;
    bottleneckDwellDays: number;
    stuckProcessKey: string | null;
    stuckDays: number | null;
    thisStation: ProcessStationDwell | null;
    stations: ProcessStationDwell[];
  }[];
  waitKinds: readonly string[];
  origins: readonly string[];
}

/** 本流程实例的**屏幕模型**：把「卡了多久 / 卡在谁那里 / 站间流转多久」三问各摊成一行。 */
export interface ProcessInstanceRowVM {
  instanceKey: string;
  carrierObjectId: string;
  enteredAt: string;
  exitedAt: string | null;
  /** 站内停留天数（未出站时 = asOf − enteredAt）。 */
  dwellDays: number;
  /** 到分析截止时刻仍未出站 ⇒ **正卡在这一站**。 */
  stillIn: boolean;
  /** 「卡在谁那里」：职能 + 具体责任方（单据字段名=值，可下钻）。 */
  ownerFunctionKey: string;
  partyField: string | null;
  partyValue: string | null;
  /**
   * ⚠ **合并后是五值不是四值**（WO-R9-PROCESS-MERGE）：实例层的等待态包含 `WAITING_APPROVAL`
   * （运行时实例真的会停在一张已存在的 `ActionDraft` 上）。模板层 `ProcessDefinition.waitKind`
   * 仍是四值、一个字没动 —— 上面 §3 那张 `Record<ProcessWaitKind, …>` 文案表因此**不变**。
   * 若这里也写成 `ProcessWaitKind`，编译期就红（本单实测红过一次），那正是类型在替我们把关。
   */
  waitKind: ProcessTaskWaitState | null;
  /**
   * 🔴 上一格**是怎么来的**（合并新立的诚实位）：
   *  · `DEFINITION_TEMPLATE` = 抄自流程定义的 `waitKind`，即「**这类**流程通常卡在哪」——**平均值**；
   *  · `TASK_GATE`           = 由这一单自己的前置条件判出来的**现场值**，答得出具体卡在哪张单。
   * 界面必须把两者标开：把平均值显示成现场值，正是本仓「拿一个看起来相关的数字冒充读数」的老病。
   */
  waitStateOrigin: ProcessWaitStateOrigin | null;
  /** 到下一站的流转间隔；本站未出站或已是末站 ⇒ null（**不是 0**）。 */
  gapDaysToNext: number | null;
  /** 溯源：这条实例的进/出站时刻各来自哪张单据的哪个字段、原值是多少（R13）。 */
  sources: { field: string; rawValue: string | number; unit: string; resolvedAt: string; role: string }[];
}

export interface ProcessInstancesModel {
  processKey: string;
  available: boolean;
  asOf: string;
  asOfSource: string;
  instanceCount: number;
  /** 停留最久的排前面（全序：平手按 instanceKey 字典序，**平手返回 0**）。 */
  rows: ProcessInstanceRowVM[];
  stuckCount: number;
  /** 反推不出时的诚实缺席（缺哪种单据 / 哪个字段 / 怎么复验）。 */
  absence: ProcessFlowAbsence | null;
  /** 标准工期 —— **对照列**，绝不当作实测滞留读。 */
  stdDurationDays: number;
}

/**
 * 把端点响应摊成屏幕模型。纯函数（无 IO / 无时钟），故可被单测直喂 fixture。
 *
 * ⚠ 排序比较器**全序**：`dwellDays` 降序，平手按 `instanceKey` 字典序 tie-break，
 * **平手返回 0** —— 写成 `a > b ? -1 : 1` 会让平手时的结果依赖初始序（同数据两跑不同序）。
 */
export function buildProcessInstancesModel(res: ProcessInstancesResponse): ProcessInstancesModel {
  const dwellByKey = new Map<string, { dwellDays: number; stillIn: boolean; gapDaysToNext: number | null }>();
  for (const f of res.flowTime) {
    for (const s of f.stations) {
      dwellByKey.set(s.instanceKey, { dwellDays: s.dwellDays, stillIn: s.stillIn, gapDaysToNext: s.gapDaysToNext });
    }
  }
  const rows: ProcessInstanceRowVM[] = res.instances.map((i) => {
    const d = dwellByKey.get(i.key);
    return {
      instanceKey: i.key,
      carrierObjectId: i.carrierObjectId,
      enteredAt: i.enteredAt,
      exitedAt: i.exitedAt,
      dwellDays: d?.dwellDays ?? 0,
      stillIn: d?.stillIn ?? i.exitedAt === null,
      ownerFunctionKey: i.ownerRef.functionKey,
      partyField: i.ownerRef.partyField,
      partyValue: i.ownerRef.partyValue,
      waitKind: i.waitState,
      // 诚实位一并透传：中间层把它丢掉就等于没有（前端会把平均值当现场值画）
      waitStateOrigin: i.waitStateOrigin,
      gapDaysToNext: d?.gapDaysToNext ?? null,
      sources: i.sourceDocuments.map((s) => ({ field: s.field, rawValue: s.rawValue, unit: s.unit, resolvedAt: s.resolvedAt, role: s.role })),
    };
  });
  rows.sort((a, b) => b.dwellDays - a.dwellDays || a.instanceKey.localeCompare(b.instanceKey));
  return {
    processKey: res.definition.key,
    available: res.available,
    asOf: res.asOf,
    asOfSource: res.asOfSource,
    instanceCount: res.instanceCount,
    rows,
    stuckCount: rows.filter((r) => r.stillIn).length,
    absence: res.absence,
    stdDurationDays: res.definition.stdDurationDays,
  };
}
