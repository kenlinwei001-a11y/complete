/**
 * WO-STEP-TEMPLATE-LAYER · **步骤模板种子（电池制造行业模板）+ 读侧服务**。
 *
 * ══ 为什么这张表在这里而不在 contracts ═════════════════════════════════════
 * 与 `flow-rules.ts` 同一条纪律：步名 / 责任职能 / 工期分摊是**行业模板知识**（R14），
 * 契约 `packages/contracts/src/process-step-template.ts` 只冻结**形状与不变量**，
 * 一个中文步名都没有。换行业换种子，契约不动。
 *
 * ══ 🔴 候选集不是我挑的 —— 它由既有单一来源算出来 ═════════════════════════
 *
 * 「给哪些流程写步骤模板」这个问题，最容易出的错是**凭手感挑一批**。
 * 本单不挑，判据是一条可复算的式子：
 *
 *   候选集 = `flowRuleCoveredProcessKeys()`（`flow-rules.ts` 的单一来源函数，今日现跑 9 条：
 *            P25 P33 P34 P35 P41 P42 P43 P47 P51）
 *
 * 理由不是"这 9 条比较重要"，而是：**这 9 条是全仓唯一被实测确认「承载对象上带真实进/出站
 * 时刻」的流程**。`flow-rules.ts` 文件头写着建表前真跑了一遍种子、对 65 条流程的
 * `carrierTypeKey` 逐个 `listByType` 数对象、逐个 dump props 看时间戳字段。
 * 给一条从没被观察过的流程写步骤模板，等于对一个没看过的东西下结论。
 *
 * 候选集 9 条里**只落地 7 条**，另 2 条如实进缺席登记（见下方 `STEP_TEMPLATE_ABSENCE_NOTES`）——
 * 缺席理由逐条引用**仓内既有的实测记录**，不是「以后再说」。
 *
 * ══ 🔴 每一步都有可核锚点，且工期守恒 ═══════════════════════════════════════
 * 契约 §2 的两条不变量在这份种子上是**硬约束**：种子加载时逐条 `validateProcessStepTemplateSet`，
 * 不过就当场抛（不是记个 warning 继续跑）。于是：
 *  · 想多编一步 ⇒ 必须从别的步匀出天数（总量不变），改动可见；
 *  · 想写一个"看着合理"的步 ⇒ 得先在承载对象上找到它的锚（时刻字段或状态值），
 *    而锚是**真跑种子后**核对的（`process-step-template.seam.test.ts`），注释里写着的枚举不算数。
 *
 * ══ R6 确定性 ═══════════════════════════════════════════════════════════════
 * 全文件常量与纯函数，无时钟无随机；id 由契约的 `processStepTemplateId()` 单一产地铸，
 * 同 SEED_DEMO 重跑字节级一致。
 */
import {
  ProcessStepTemplateSchema,
  processStepTemplateId,
  validateProcessStepTemplateSet,
  type ProcessDefinition,
  type ProcessStepTemplate,
  type ProcessStepTemplateAbsence,
  type ProcessStepTemplateResponse,
} from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import { flowRuleCoveredProcessKeys } from "./flow-rules.js";

/** 种子里一条步骤的裸形（`id`/`tenantId`/`processKey` 由播种时统一补，避免 65×N 份重复字面量）。 */
type SeedStep = Omit<ProcessStepTemplate, "id" | "tenantId" | "processKey">;

/**
 * 电池制造模板的步骤表。**键必须落在候选集内**（由 `assertCandidateSet()` 在模块加载时自证）。
 *
 * 每条 `basis` 指到具体文件 + 那段话在说什么 —— 照 `PROCESS_FLOW_STRUCTURAL_NOTES.probe` 的惯例：
 * 把「为什么这么建」连同取证留在原地，下一个人才不会照缺省理由改错方向。
 */
export const BATTERY_PROCESS_STEP_TEMPLATES: Readonly<Record<string, readonly SeedStep[]>> = {
  // ── P25 工程变更（ECN）处理 · EngineeringChange · 定义 14 天 ────────────────
  // 承载对象上恰有两个真时刻：approvedDate（批准）与 effectiveDate（生效）。
  // `flow-rules.ts` 的 engineering_change 规则用的就是这一对，且文件头记着实测
  // 「3/3 条都是 approved 早于 effective，先后关系成立」—— 先后关系不是我假设的。
  P25: [
    {
      seq: 1,
      name: "变更评审与批准",
      ownerFunctionKey: "product_engineering",
      stdDurationDays: 7,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "approvedDate", value: null },
      basis:
        "apps/datacore/src/synthetic/battery.ts engineeringChangeProps 声明 approvedBy/approvedDate 两个属性；apps/datacore/src/process/flow-rules.ts 的 engineering_change 规则以 approvedDate 为入站时刻，文件头记着实测 3/3 条 approved 早于 effective。",
    },
    {
      seq: 2,
      name: "变更生效与工艺文件发布",
      ownerFunctionKey: "process_engineering",
      stdDurationDays: 7,
      waitKind: "WAITING_SCHEDULE",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "effectiveDate", value: null },
      basis:
        "同上规则的出站时刻 effectiveDate（battery.ts engineeringChangeProps）。责任职能取 process_engineering 而非 product_engineering：生效落在工艺文件上，与 seed.ts 里 P26「工艺路线与工序设计」同一职能。",
    },
  ],

  // ── P34 进口清关 · CustomsClearance · 定义 7 天 ─────────────────────────────
  P34: [
    {
      seq: 1,
      name: "报关申报",
      ownerFunctionKey: "supply_chain",
      stdDurationDays: 3,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "declaredDay", value: null },
      basis:
        "apps/datacore/src/synthetic/battery-extended.ts 的 CustomsClearance.declaredDay 字段描述原文「申报天（相对天）。到 clearedDay 之间即「清关」腿的实测耗时」——两个时刻是同一段的两端，非我划分。",
    },
    {
      seq: 2,
      name: "海关查验与放行",
      ownerFunctionKey: "supply_chain",
      stdDurationDays: 4,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "clearedDay", value: null },
      basis:
        "同上字段对的另一端 clearedDay（「海关放行天…放行后才进入到货检验」）。责任方是清关行/海关（packages/contracts/src/procurement.ts PROCUREMENT_LEG_OWNER.customs = CUSTOMS_BROKER），平台侧对口职能是 supply_chain（与 seed.ts P34 定义的 ownerFunctionKey 一致）。",
    },
  ],

  // ── P35 到货检验（IQC）· IncomingInspection · 定义 2 天 ─────────────────────
  P35: [
    {
      seq: 1,
      name: "到货待检登记",
      ownerFunctionKey: "warehouse_logistics",
      stdDurationDays: 1,
      waitKind: "WAITING_DATA",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "arrivedDay", value: null },
      basis:
        "battery-extended.ts 的 IncomingInspection.arrivedDay 描述原文「到货待检天（相对天）：货已进厂但未放行。到 releasedDay 之间即「到货检验」腿」。收货入厂归仓储，与 seed.ts P36「物料批次入库」同一职能。",
    },
    {
      seq: 2,
      name: "检验判定与放行",
      ownerFunctionKey: "quality",
      stdDurationDays: 1,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "releasedDay", value: null },
      basis:
        "同上字段对的另一端 releasedDay（「检验放行天…此刻物料才真正可投产（到厂 ≠ 可投产）」）；责任方 QUALITY_IQC 由 packages/contracts/src/procurement.ts PROCUREMENT_LEG_OWNER.incoming_inspection 登记，原文「这段是自己的锅」。",
    },
  ],

  // ── P41 跨基地调拨决策 · InterBaseTransfer · 定义 3 天 ──────────────────────
  // 这是全表**唯一**用 STATUS_VALUE 锚的一条，刻意如此：承载对象自带一份三值状态机
  // （battery.ts `XFER_STATUS = ["PLANNED","IN_TRANSIT","DELIVERED"]`，真被写进每条对象的 status），
  // 三个推进态一一对应三步。⚠ 第四个值 CANCELLED 在 interBaseTransferProps 的行尾注释里，
  // 但**生成器不产出它**（XFER_STATUS 只有三值）——照注释建模就会造出一个数据里不存在的步，
  // 那正是铁律 0.6 点名的「拿看起来相关的东西当判据」。故本表只收数据里真出现的三个，
  // 且由接缝测试逐个回真对象里核（注释不算证据）。
  P41: [
    {
      seq: 1,
      name: "调拨计划拟定",
      ownerFunctionKey: "supply_chain",
      stdDurationDays: 1,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "STATUS_VALUE", propKey: "status", value: "PLANNED" },
      basis:
        "apps/datacore/src/synthetic/battery.ts 的 XFER_STATUS 常量（PLANNED/IN_TRANSIT/DELIVERED），每条 InterBaseTransfer 的 status 取自它 —— 承载对象自己的状态机，非本层发明。",
    },
    {
      seq: 2,
      name: "发运在途",
      ownerFunctionKey: "warehouse_logistics",
      stdDurationDays: 1,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "STATUS_VALUE", propKey: "status", value: "IN_TRANSIT" },
      basis:
        "同上状态机的第二个推进态；对应的时刻字段是 dispatchDate（flow-rules.ts 的 interbase_transfer 规则以它为入站时刻）。",
    },
    {
      seq: 3,
      name: "到货签收",
      ownerFunctionKey: "warehouse_logistics",
      stdDurationDays: 1,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "STATUS_VALUE", propKey: "status", value: "DELIVERED" },
      basis:
        "同上状态机的第三个推进态；对应的时刻字段是 etaDate（flow-rules.ts 同一条规则的出站时刻）。",
    },
  ],

  // ── P42 工单下达 · WorkOrder · 定义 1 天 ────────────────────────────────────
  // 1 天拆两步 ⇒ 0.5 + 0.5，正好落在契约的半天粒度上。这条同时是粒度规则的正面样例：
  // 若拆三步，0.5×3 = 1.5 > 1 天，算术上就不成立 ⇒ 建不出来，而不是写三个 0.33 糊过去。
  P42: [
    {
      seq: 1,
      name: "工单下达与开工",
      ownerFunctionKey: "production_planning",
      stdDurationDays: 0.5,
      waitKind: "WAITING_SCHEDULE",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "startDate", value: null },
      basis:
        "apps/datacore/src/process/flow-rules.ts 的 wo_lifecycle 规则：WorkOrder.startDate→endDate 是「工单从开工到完工的总时长」，两端俱全（文件头有实测取证，并订正过 P42 是伞不是前一站）。",
    },
    {
      seq: 2,
      name: "完工报交",
      ownerFunctionKey: "manufacturing",
      stdDurationDays: 0.5,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "endDate", value: null },
      basis:
        "同上规则的出站时刻 WorkOrder.endDate（battery.ts workOrderProps 声明该属性）。报交动作在产线，故责任职能 manufacturing（与 seed.ts P44「工序流转报工」同一职能）。",
    },
  ],

  // ── P43 齐套发料与投料 · WIPLot · 定义 1 天 ─────────────────────────────────
  P43: [
    {
      seq: 1,
      name: "齐套发料投产",
      ownerFunctionKey: "warehouse_logistics",
      stdDurationDays: 0.5,
      waitKind: "WAITING_DATA",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "startTime", value: null },
      basis:
        "apps/datacore/src/process/flow-rules.ts 的 wo_to_quality 链首站：WIPLot.startTime→lastMoveTime，实测两端俱全（该链的站间间隔约 7.8 天即由此算出）。",
    },
    {
      seq: 2,
      name: "在制流转",
      ownerFunctionKey: "manufacturing",
      stdDurationDays: 0.5,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "lastMoveTime", value: null },
      basis: "同上规则的出站时刻 WIPLot.lastMoveTime（battery.ts wipLotProps 声明该属性）。",
    },
  ],

  // ── P51 设备告警响应与维修派工 · MaintenanceOrder · 定义 1 天 ───────────────
  P51: [
    {
      seq: 1,
      name: "派工与到场",
      ownerFunctionKey: "maintenance",
      stdDurationDays: 0.5,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "actualStart", value: null },
      basis:
        "apps/datacore/src/process/flow-rules.ts 的 maintenance_execution 规则：MaintenanceOrder.actualStart→actualEnd，规则注释原文「取 actual 不取 planned：planned 是计划值，拿它算「实际卡了多久」= 拿标准工期冒充实测的同族错误」。",
    },
    {
      seq: 2,
      name: "维修执行与完工确认",
      ownerFunctionKey: "maintenance",
      stdDurationDays: 0.5,
      waitKind: "WAITING_USER",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "actualEnd", value: null },
      basis: "同上规则的出站时刻 MaintenanceOrder.actualEnd（battery.ts maintenanceOrderProps 声明该属性）。",
    },
  ],
};

/**
 * **候选集内、但仍然建不出模板**的两条 —— 逐条引用仓内既有实测记录，不是「以后再说」。
 *
 * 这两条比那 7 条更值钱：它们证明候选集不是"凡进来的都给发一份模板"。
 */
export const STEP_TEMPLATE_ABSENCE_NOTES: Readonly<Record<string, ProcessStepTemplateAbsence>> = {
  P33: {
    reason:
      "承载对象 PurchaseOrder 上确有三个时刻（orderDay/shipDay/arriveDay），但后两个**语义上不属于本流程**：packages/contracts/src/procurement.ts §1 已把 orderDay→shipDay 登记为「供应商生产」腿（责任方 SUPPLIER）、shipDay→arriveDay 登记为「在途」腿（责任方 CARRIER），两者都不是 P33 的责任职能 procurement 干的活。把它们收成 P33 的步 = 把采购段四腿那一层揉进流程步骤层，两层会对同一段时间各讲一个故事。⇒ 本流程可锚的只剩 orderDay 一个时刻，拆不出两步。",
    probe:
      "读 packages/contracts/src/procurement.ts 的 PROCUREMENT_LEG_OWNER（supplier_production→SUPPLIER · in_transit→CARRIER）；再读 apps/datacore/src/process/flow-rules.ts 的 procure_to_release 链 P33 站注释原文「中间的 shipDay（发货）是这一段内部的分割点，由 chain_loss_attribution 按「供应商生产 / 在途」两腿去分摊；本层不把它拆成两个站 —— 拆了就会与那边重复计同一段时间」。",
  },
  P47: {
    reason:
      "承载对象 QualityLot 只记了 inspectDate 一个时刻，没有「判定完成」的时刻 —— 一步都拆不出第二步的锚。这不是数据没录全，是单据本身只记了一端。",
    probe:
      "读 apps/datacore/src/process/flow-rules.ts 的 wo_to_quality 链 P47 站，exitField 显式写成 null，注释原文「QualityLot 只记了 inspectDate 一个点，没有「判定完成」的时刻…单据只记了一端，就只能说到一端。硬编一个出站时刻才是造假」。",
  },
};

/** 有模板的流程 key（升序）—— 种子/服务/测试共用同一份，不许各数一遍（照 `flowRuleCoveredProcessKeys` 的惯例）。 */
export const stepTemplateCoveredProcessKeys = (): string[] =>
  Object.keys(BATTERY_PROCESS_STEP_TEMPLATES).sort((a, b) => a.localeCompare(b));

/**
 * 模块自证：模板表的每个 key 必须落在候选集内。
 *
 * 这条不是装饰 —— 它把「候选集由 `flowRuleCoveredProcessKeys()` 算出」从一句注释变成一条会炸的断言。
 * 谁将来手滑给一条没被观察过的流程加模板，这里当场拦下，而不是等到有人发现屏上多了一条没依据的流程。
 */
function assertCandidateSet(): void {
  const candidates = new Set(flowRuleCoveredProcessKeys());
  const outside = stepTemplateCoveredProcessKeys().filter((k) => !candidates.has(k));
  if (outside.length > 0) {
    throw new Error(
      `步骤模板只能落在候选集（flowRuleCoveredProcessKeys()，今日 ${candidates.size} 条）内，越界：${outside.join(",")}`,
    );
  }
}
assertCandidateSet();

/**
 * 播种（幂等：固定 id + `putMany` 覆盖）。**写前逐条 zod parse + 逐组跑不变量**，不过就当场抛 ——
 * 与 `seedDemoProcessLayer` 的既有做法一致：种子是本层唯一数据来源，形状/算术错了要在播种时炸，
 * 而不是等某个消费方读到一条坏记录再报一个没头没尾的错。
 */
export async function seedProcessStepTemplates(repos: Repos, tenantId: string): Promise<void> {
  const defs = await repos.processDefinitions.list(tenantId);
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  const all: ProcessStepTemplate[] = [];
  for (const processKey of stepTemplateCoveredProcessKeys()) {
    const def = defByKey.get(processKey);
    if (!def) {
      throw new Error(
        `步骤模板 ${processKey} 找不到对应的 ProcessDefinition（租户 ${tenantId}）—— 孤儿模板一律拒（契约 §2 不变量 ③）`,
      );
    }
    const steps = BATTERY_PROCESS_STEP_TEMPLATES[processKey]!.map((s) =>
      ProcessStepTemplateSchema.parse({
        ...s,
        id: processStepTemplateId(tenantId, processKey, s.seq),
        tenantId,
        processKey,
      }),
    );
    const issues = validateProcessStepTemplateSet(def, steps);
    if (issues.length > 0) {
      throw new Error(
        `步骤模板 ${processKey} 不满足契约 §2 不变量：${issues.map((i) => `[${i.code}] ${i.message}`).join(" | ")}`,
      );
    }
    all.push(...steps);
  }
  await repos.processStepTemplates.putMany(all);
}

// ══════════════════════════════════════════════════════════════════════════
// 读侧服务 —— `GET /a/v1/process-definitions/{key}/step-template`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 缺席理由的**三档**分诊。三档必须分开说，混成一句「暂无步骤模板」就等于什么都没说：
 *  ① 候选集内、有专门取证 ⇒ 直接下发那条取证（`STEP_TEMPLATE_ABSENCE_NOTES`）；
 *  ② 候选集内、但没有专门取证 ⇒ 说清"进了候选集却没落地"是个待办，别装作有理由；
 *  ③ 候选集外 ⇒ 说清是"这条流程的承载对象上没有实测进/出站时刻"，并给出可复跑的探针。
 */
export function stepTemplateAbsenceFor(processKey: string): ProcessStepTemplateAbsence {
  const noted = STEP_TEMPLATE_ABSENCE_NOTES[processKey];
  if (noted) return noted;

  const candidates = flowRuleCoveredProcessKeys();
  if (candidates.includes(processKey)) {
    return {
      reason: `流程 ${processKey} 在候选集内（承载对象有实测进/出站时刻），但本批未落地步骤模板 —— 这是待办，不是"这条流程没有步骤"。`,
      probe: `node -e "import('./apps/datacore/dist/process/step-templates.js').then(m=>console.log(m.stepTemplateCoveredProcessKeys()))" 看它是否已被补上；候选集见 flowRuleCoveredProcessKeys()。`,
    };
  }
  return {
    reason: `流程 ${processKey} 的承载对象上没有实测确认的进/出站时刻，因此拆不出可锚的步骤。步骤模板的候选集 = flowRuleCoveredProcessKeys()（今日 ${candidates.length} 条：${candidates.join(" ")}），本流程不在其中。⚠ 这句话说的是"本平台还没观察到这条流程怎么跑"，不是"这条流程只有一步"。`,
    probe: `读 apps/datacore/src/process/flow-rules.ts（文件头记着建表前真跑过种子、对 65 条流程逐个 listByType 数对象并 dump 时间戳字段）；命令：node -e "import('./apps/datacore/dist/process/flow-rules.js').then(m=>console.log(m.flowRuleCoveredProcessKeys()))"。`,
  };
}

/**
 * 读一条流程的步骤模板投影。
 *
 * ⚠ `available` 与 `absence` **互斥**由本函数保证（契约只声明了这条约定，约定要有人兑现）：
 * 有步就 `available:true` + `absence:null`；没步就 `available:false` + `absence` 非空 + 合计为 `null`。
 * 合计在没模板时给 `null` 而不是 `0` —— 「算不出」与「算出来是 0」是两个命题。
 */
export async function readStepTemplate(
  repos: Repos,
  tenantId: string,
  def: ProcessDefinition,
): Promise<ProcessStepTemplateResponse> {
  const steps = (await repos.processStepTemplates.list(tenantId, (s) => s.processKey === def.key)).sort(
    (a, b) => a.seq - b.seq,
  );
  const available = steps.length > 0;
  return {
    processKey: def.key,
    processName: def.name,
    carrierTypeKey: def.carrierTypeKey,
    definitionStdDurationDays: def.stdDurationDays,
    available,
    steps,
    absence: available ? null : stepTemplateAbsenceFor(def.key),
    stepsTotalStdDurationDays: available ? steps.reduce((acc, s) => acc + s.stdDurationDays, 0) : null,
  };
}
