import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";

/**
 * 「采纳处置方案」(`adopt_mitigation`) 真让**风险曲线下降** · 效果层 SEAM（G-ACTION-NOOP-EXEC 收口）。
 *
 * 病灶：审批通过后一个字节不写（此前落假 MO 号兜底，后改为诚实失败 EXECUTOR_NOT_IMPLEMENTED）。
 * 用户在风险看板点「采纳」→ 审批链走完 → **风险曲线纹丝不动**。
 *
 * 引擎半其实一直是齐的：
 *   · `risk.ts tensionSeries(..., mitigation?: {eff,tn}, ...)` 第 tn 天起扣 eff；
 *   · `params.risk.mitigations[factor]` 每个方案自带量化 {eff,tn}；
 *   · `riskTimeline` 甚至一直在算 `card.mitigated`——但那是「**如果**采纳会怎样」的**对照曲线**，
 *     真曲线用的仍是 `tensionSeries(..., undefined, ...)`。
 * 缺的只有一样：**没有地方记录"哪个方案被真采纳了"**。本单补上 `AdoptedMitigation` 台账把两半接起来。
 *
 * ⚠ 本测的头号判据是**曲线真的变了**——不是"写了一条记录"，也不是 `ok:true`/`targetRef` 非空。
 *   后两者正是让空执行病灶活到今天的那类运输层断言。
 */

const H = 30;

interface Card {
  baseId: string;
  factor: string;
  series: number[];
  peak: number;
  crossDay: number | null;
  factorSeries: Record<string, number[]>;
  adoptedMitigation?: { planKey: string; eff: number; tn: number };
}
interface RiskOut {
  cards: Card[];
  mitigationLibrary: Record<string, { key: string; name: string; eff: number; tn: number }[]>;
}

/** 强制卡（传 base+factor → 该 pair 必出一张卡，不受"未越线则丢弃"影响）。 */
async function forcedCard(t: TestApp, base: string, factor: string): Promise<Card> {
  const res = await invokeSolver(t, "risk_timeline", { base, factor, horizon: H });
  expect(res.statusCode, res.body).toBe(200);
  const out = (res.json() as { data: RiskOut }).data;
  const card = out.cards.find((c) => c.baseId === base && c.factor === factor);
  expect(card, `risk_timeline(${base},${factor}) 未出卡：${JSON.stringify(out.cards.map((c) => [c.baseId, c.factor]))}`).toBeTruthy();
  return card!;
}

async function library(t: TestApp): Promise<RiskOut["mitigationLibrary"]> {
  const res = await invokeSolver(t, "risk_timeline", { horizon: H });
  return (res.json() as { data: RiskOut }).data.mitigationLibrary;
}

/**
 * 走**完整 S2 审批链**（建草稿 submit → 逐步审批到执行）。
 * `adopt_mitigation` 的链是 [planner, admin] 两步（battery.ts BATTERY_ACTION_TYPES），
 * 故按每步待批角色换审批人——写死"approve 一次"会在链长变化时假红/假绿。
 */
const HEADER_BY_ROLE: Record<string, Record<string, string>> = {
  planner: PLANNER,
  admin: ADMIN,
};

interface DraftView {
  id: string;
  status: string;
  approvalSteps: { seq: number; role: string; decision?: string }[];
  executionResult?: { ok?: boolean; targetRef?: string; error?: string };
}

async function adopt(t: TestApp, payload: Record<string, unknown>): Promise<DraftView> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "adopt_mitigation", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;

  for (let guard = 0; guard < 6; guard++) {
    const cur = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN })).json() as DraftView;
    if (cur.status !== "PENDING_APPROVAL") return cur;
    const pending = cur.approvalSteps.find((s) => !s.decision);
    expect(pending, `PENDING_APPROVAL 但无待批步骤：${JSON.stringify(cur.approvalSteps)}`).toBeTruthy();
    const headers = HEADER_BY_ROLE[pending!.role];
    expect(headers, `审批链出现未覆盖角色「${pending!.role}」——补 HEADER_BY_ROLE`).toBeTruthy();
    const res = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers, payload: {} });
    expect(res.statusCode, `approve(step ${pending!.seq}/${pending!.role}) 失败：${res.body}`).toBeLessThan(300);
  }
  throw new Error("审批链未在 6 步内收敛");
}

describe("adopt_mitigation · 采纳后风险曲线**真的**下降（效果层）", () => {
  it("头号效果断言：采纳后第 tn 天及之后逐日降约 eff，第 tn 天之前逐字节不变", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 目标 pair 与方案：从**真方案库**里取（非写死数字）——tn 最大者，好让"第 tn 天之前不变"是条硬断言。
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const plans = (await library(t))[factor]!;
    const plan = [...plans].sort((a, b) => b.tn - a.tn || (a.key < b.key ? -1 : 1))[0]!;
    expect(plan.tn, "选中的方案 tn 必须 >1，否则「第 tn 天之前不变」退化成空断言").toBeGreaterThan(1);
    expect(plan.eff, "选中的方案 eff 必须 >0，否则「下降」退化成空断言").toBeGreaterThan(0);

    const before = (await forcedCard(t, base, factor)).series;
    expect(before.length).toBe(H);

    const done = await adopt(t, { base, factor, planKey: plan.key });
    expect(done.status, `采纳执行失败：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    // targetRef 自证采纳了什么，且**绝不是 MO 形态**（假单号与真单号不可分辨正是 G-ACTION-NOOP-EXEC 的病灶）。
    expect(done.executionResult?.targetRef).toContain("MIT-ADOPT:");
    expect(String(done.executionResult?.targetRef)).not.toMatch(/^MO-/);

    const after = (await forcedCard(t, base, factor)).series;

    // ★★ 效果层核心：这一段红 = 「点了采纳，曲线纹丝不动」回潮。
    for (let i = 0; i < H; i++) {
      const day = i + 1;
      if (day < plan.tn) {
        expect(after[i], `第 ${day} 天（< tn=${plan.tn}）不该变：${before[i]} → ${after[i]}`).toBe(before[i]);
      } else {
        const want = Math.max(0, Math.round((before[i]! - plan.eff) * 1e4) / 1e4);
        expect(after[i], `第 ${day} 天（≥ tn=${plan.tn}）该降 ${plan.eff}：${before[i]} → ${after[i]}（期望 ${want}）`).toBeCloseTo(want, 6);
      }
    }
    // 至少有一天真的降了（防止 before 全 0 之类让上面的循环空转）。
    expect(after.some((v, i) => v < before[i]!), "整条曲线一天都没降——采纳没有任何效果").toBe(true);

    // 加性披露（R13）：卡上自证吃了哪条采纳，用户不用对着一条悄悄降下去的曲线猜原因。
    const card = await forcedCard(t, base, factor);
    expect(card.adoptedMitigation).toEqual({ planKey: plan.key, eff: plan.eff, tn: plan.tn });
    // 逐因素序列（详情面板「其余因素」）必须与卡面同口径——否则同一屏自相矛盾。
    expect(card.factorSeries[factor]).toEqual(after);
  }, 300000);

  it("未采纳的 (base,factor) 逐字节不变：同基地另一因素的曲线不动，另一基地整张卡不动", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const otherFactorSameBase = "物料齐套";
    const otherBase = "changzhou";

    const b1 = await forcedCard(t, base, otherFactorSameBase);
    const b2 = await forcedCard(t, otherBase, factor);

    const done = await adopt(t, { base, factor, planKey: "debottleneck" });
    expect(done.status, done.executionResult?.error ?? "").toBe("EXECUTED");

    const a1 = await forcedCard(t, base, otherFactorSameBase);
    // 同基地、未采纳的那个因素：自己的曲线/峰值/越线日逐字节不变、且不挂 adoptedMitigation。
    expect(a1.series).toEqual(b1.series);
    expect(a1.peak).toBe(b1.peak);
    expect(a1.crossDay).toBe(b1.crossDay);
    expect(a1.adoptedMitigation).toBeUndefined();
    // 但它的 factorSeries[被采纳因素] **应该**跟着变（同一屏不许自相矛盾：卡面已消解、面板还是老曲线）。
    expect(a1.factorSeries[factor]).not.toEqual(b1.factorSeries[factor]);

    // 另一基地同因素：整张卡逐字节不变（采纳是 per-base 的，不许外溢）。
    const a2 = await forcedCard(t, otherBase, factor);
    expect(JSON.stringify(a2)).toBe(JSON.stringify(b2));
  }, 300000);

  it("R6 向后兼容硬锚：无任何采纳记录时 risk_timeline 输出与**采纳功能上线前**逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await t.repos.objects.listByType("demo", "AdoptedMitigation")).length, "本用例前提：零采纳记录").toBe(0);

    const res = await invokeSolver(t, "risk_timeline", {});
    const data = (res.json() as { data: unknown }).data;
    const json = JSON.stringify(data);

    // ⚠️ 金值口径（审核方复并时修正 —— 原版把 `ruleSetVersion` 也哈进去了，形态脆弱）：
    //   原断言 sha256(整个 payload)。而 payload 末尾的 `ruleSetVersion` 是**规则集指纹**，
    //   **任何一次规则编辑都会让它变** —— 于是每改一条规则本条就红，而"改规则→重定金值"
    //   正是橡皮图章的温床：重定几次之后，没人再会去分辨"这次该不该变"。
    //   现改为：**推演数值**（去掉指纹后的 payload）锁金值 ＋ 指纹单独断言形态。
    //   本条真正要守的是「采纳功能在未启用时零成本」，不是「规则永远不许改」。
    //
    // 归属取证（本条转红时照此做，别直接改数）：把本单 src 改动去掉重算，若哈希不变 ⇒ 是别的改动挪的，
    // 用 `git checkout --detach <sha>` 逐点二分定位到**是哪一笔**，再判断那一笔是不是有意的口径变更。
    // 本次实测：85ff02a4(基线)=d7400046… → b01a2ce8(排序契约合并)=d7400046…**未变**
    //          → 2c7ba020(C08 红线 0.3→0.2)=bb5dd844… → aa28eda1(G-10 规则一等化)=c7ec8b29…
    //   C08 是真推演变化（红线收紧，本就该变）；G-10 **只动了 ruleSetVersion**，推演数值逐字节未变
    //   （`diff` 全文只有一行不同）—— 这也正是本条改口径的直接由来。
    // ⚠️ 口径二次收窄（WO-SANDBOX-D4 并线时·2026-08-06）：本条曾把**整个 payload**锁死，
    //   于是任何**加性**新字段都会把它打红，逼人去改数字 —— 而"改数字"恰恰是本条注释警惕的橡皮图章。
    //   D4 给 risk_timeline 加了 `otdBatch`（顶层）与逐卡 `otd`（OTD 批次准时率聚合层）。
    //   归属取证（照上面的协议做的）：`otdFromRiskCard`（solvers/aggregates.ts）只**读** c.orders /
    //   affected 建映射并 `return otdBatchRate(...)`，对任何入参零写入 —— 不改 series/peak/crossDay/
    //   affectedOrders。长度 26434→30213（+3779）正是这两个新键的体积。
    //
    //   所以本条真正要守的是「**老字段一个数都不许变**」，不是「输出体积永远不许长」。
    //   改法：把已知的加性新键**剥掉**再锁金值 —— 老哈希原封不动继续生效（它是实证：
    //   剥完若仍等于上线前那个哈希，就证明 D4 确实纯加性；不等 = 真回归，照旧转红）。
    //   将来再有加性字段，按同样方式登记进 ADDITIVE_KEYS，并在此写清是哪一笔、为什么该加。
    //
    // ── 登记 #2（WO-DECISION-INFO 并线时·2026-08-06·rebase 到 wave4） ─────────────────────────
    //   决策信息单加的键：`cards[].exposure`（影响面）·`cards[].doNothing`（不作为后果）·
    //   `planRows[].options`（A/B/C 多方案 + 代价）·顶层 `exposureOrder`·`steps[].leadTime`。
    //   其中 `steps[].leadTime` 埋在 planRows 行**内部**（非顶层数组行），故剥离改为**按键名递归**
    //   —— 登记的键名在任意深度都剥掉（键名均为本单新造·不与既有字段重名）。
    //
    //   ⚠️ 本单**不是**纯加性（与 D4 不同，这点必须写明，不许含糊过去）：WO-DECISION-INFO ③.2「去魔数」
    //   有意改了**推演数值口径** —— 处置步骤里「跨基地调剂」「外协补足」两步的 `day`/`date`，
    //   此前由写死的 `trigDay + 7` / `trigDay + 14` 决定，现改为由**真对象**派生
    //   （`InterBaseTransfer.transitDays` / 合格 `Supplier.leadTime`），`rationale` 随之带上前置期出处（R13）。
    //   所以剥完加性键后**老哈希 9d8d4050… 不再成立**，这是有意的口径变更、不是回归。
    //
    //   ✅ 归属取证（rebase 时**亲手重做过一遍**，不是抄上一手的结论）：
    //      在 wave4 基线（582f3e9f）与本分支上各跑一次同一个 risk_timeline，用**同一个**递归剥离器
    //      落盘 stripped payload 再 diff（工具：临时 zz-dump-risk.test.ts·未进正线）。实测：
    //        · 基线 stripped：len 26434 · sha 9d8d4050f9ca9f34524d4497aa09e29d14e8c8ad3f60e740cbe879eff2bd1c8b
    //          —— 与本条**原有**金值逐字节相同 ⇒ 证明递归剥离器与 D4 那版剥离器在基线数据上等价（口径没被我改松）。
    //        · 本分支 stripped：len 26882 · sha 84509cbe…（即下方金值），差 **+448 字节**。
    //        · `diff old.json new.json` 的**全部**变化行按键名归类：`day`×16 · `date`×16 · `rationale`×16，
    //          **没有第四个键**、没有任何 series/peak/crossDay/affectedOrders 被挪动 ⇒ 与 ③.2 去魔数的
    //          声称完全吻合（跨基地 d8→d4·transitDays=3；外协 d15→d8·leadTime=7）。
    //   剥离后的金值据此重定一次；老字段除上述两步外仍逐字节不变（上面两条「逐字节不变」用例亦独立守着 series）。
    // ── 登记 #3（WO-SANDBOX-D2 并线时·2026-08-06·审核方合并态取证）─────────────────────────
    //   本次**没有新增加性键**，变的是**老字段的值**：26882 → 26898（+16 字节）· 84509cbe… → f677f796…。
    //
    //   ⚠️ 这不是回归，是 D2 的**数据半**碰上 WO-DECISION-INFO 的**引擎半** —— 典型接缝效应，
    //      两个单各自绿、合并态才显形（各半绿 ≠ 合并态绿）。
    //
    //   ✅ 归属取证（实跑探针·非推断）：
    //      `outsourceLeadOf`（solvers/decision-info.ts:400）取的是**全部 status==='合格' 供应商里
    //      leadTime 最大的那家**（设计即如此：外协前置期保守取上界，不 over-promise）。
    //      D2 为了让清关段有据可依，新增了唯一一家**进口**供应商 SUP-015（宇部兴产）。实测分布：
    //        SUP-015 leadTime=12 (进口) ← 新的最大值
    //        SUP-002 leadTime=7  (境内) ← D2 之前的最大值
    //        SUP-007 leadTime=7 · SUP-005 6 · SUP-009 6 …（合格 13 家 / 共 15 家）
    //      ⇒ 外协前置期 7 → 12 天。该值以两种形态各出现在 16 行里（rationale 的「前置期 N 天」
    //        与 leadTime.source.value），一位数变两位数 ⇒ **每行 +1 字节 × 16 行 = +16**，与实测完全吻合。
    //      探针另核对：全部 planRows 的 leadTime 取值集合**只有一个**
    //        {status:"OK", days:12, source:{Supplier, SUP-015, leadTime, 12}} —— 无第二个来源在漂。
    //
    //   📌 由此暴露一个真实的口径粗糙处（已另记欠账，非本次修）：外协前置期是**全局最大**，
    //      不区分要外协的是什么物料 —— 一家电解液进口商的 12 天，会被用作电芯外协的前置期。
    //      「保守」与「答非所问」只隔一层，将来要按物料/供应关系收窄。
    const ADDITIVE_KEYS = [
      "otdBatch", // WO-SANDBOX-D4（顶层）
      "otd", // WO-SANDBOX-D4（逐卡）
      "exposure", // WO-DECISION-INFO（逐卡·影响面）
      "doNothing", // WO-DECISION-INFO（逐卡·不作为后果）
      "exposureOrder", // WO-DECISION-INFO（顶层·影响面排序）
      "options", // WO-DECISION-INFO（planRows 行·A/B/C 多方案）
      "leadTime", // WO-DECISION-INFO（steps 行·前置期出处）
      // WO-SILENT-WRONG-ANSWER-3 症② 诚实位（顶层·加性）：**这次算的是谁**（BASE=单基地 / ALL=全网）。
      //   修前 risk_timeline 输出里没有任何一处说明作用域 —— 于是「问枣庄返回 8 张别的基地的卡」
      //   在屏上完全看不出来（判为「静默错答」而非「报错」的直接原因）。与 capacity_forecast 同款口径。
      //   本门断的是「老字段没被动」，这四个是**新增**键 ⇒ 登记进剥离表、长度金值不变（正是本表的用法）。
      "scope",
      "scopeBaseId",
      "scopeBaseName",
      "scopeNote",
    ];
    const stripAdditive = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(stripAdditive);
      if (!node || typeof node !== "object") return node;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (ADDITIVE_KEYS.includes(k)) continue;
        out[k] = stripAdditive(v);
      }
      return out;
    };
    const { ruleSetVersion, ...numeric } = data as Record<string, unknown>;
    const stripped = stripAdditive(JSON.parse(JSON.stringify(numeric))) as Record<string, unknown>;
    const numericJson = JSON.stringify(stripped);
    expect(numericJson.length, "剥掉已登记的加性新键后长度仍变 —— 说明动的是老字段，不是加字段").toBe(26898);
    expect(
      createHash("sha256").update(numericJson).digest("hex"),
      "无采纳记录时 risk_timeline 的**推演数值**与上线前不再逐字节一致（R6 向后兼容被破）——" +
        "先按上面的归属取证定位是哪一笔改动，确认是有意的口径变更后再更新金值，不要直接改数",
    ).toBe("f677f7965f7a58b376ed95cc87cc6c604e5686a1b61882da5340db3d7f8983fa");
    // 加性键必须**真的在**（否则本条会退化成"剥了个不存在的键"，白白放行未来的真回归）。
    expect(Object.keys(numeric), "D4 的 otdBatch 必须在顶层出现，否则 ADDITIVE_KEYS 已过期").toContain("otdBatch");
    expect(Object.keys(numeric), "WO-DECISION-INFO 的 exposureOrder 必须在顶层出现，否则 ADDITIVE_KEYS 已过期").toContain("exposureOrder");
    expect(typeof ruleSetVersion, "规则集指纹必须仍在（它变是正常的，缺了才是问题）").toBe("string");
    expect(String(ruleSetVersion)).toMatch(/^rsv_[0-9a-f]+$/);
    // 新字段绝不在无采纳时露头（避免"多了个 key"这种静默形状漂移）。
    expect(json).not.toContain("adoptedMitigation");
  }, 300000);

  it("诚实拒绝：planKey 解不出方案 → EXECUTION_FAILED 且**没有写入任何 AdoptedMitigation**", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const done = await adopt(t, { base: "jiangmen", factor: "瓶颈工序", planKey: "不存在的方案" });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult?.error).toContain("解不出方案");
    expect(done.executionResult?.error, "错误必须列出可选方案，否则用户无从修").toContain("debottleneck");
    // ★ 关键：宁可不写，也绝不写一个猜的 eff/tn（假数落库比不落库危险得多）。
    expect(await t.repos.objects.listByType("demo", "AdoptedMitigation")).toEqual([]);

    // 曲线也必须纹丝不动（失败是原子的）。
    const card = await forcedCard(t, "jiangmen", "瓶颈工序");
    expect(card.adoptedMitigation).toBeUndefined();
  }, 300000);

  it("诚实拒绝：factor 不在方案库 / base 解析不出 → 失败且不落库", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const badFactor = await adopt(t, { base: "jiangmen", factor: "查无此因素", planKey: "debottleneck" });
    expect(badFactor.status).toBe("EXECUTION_FAILED");
    expect(badFactor.executionResult?.error).toContain("不在处置方案库");

    // 决策内核在无头部基地时会传 "全域"——它不是一个基地，绝不能被当成某个基地写下去。
    const badBase = await adopt(t, { base: "全域", factor: "瓶颈工序", planKey: "debottleneck" });
    expect(badBase.status).toBe("EXECUTION_FAILED");
    expect(badBase.executionResult?.error).toContain("解析不出具体基地");

    expect(await t.repos.objects.listByType("demo", "AdoptedMitigation")).toEqual([]);
  }, 300000);

  it("单源不并存：改采同因素的另一方案 → 旧条 REVOKED、至多一条 ACTIVE，曲线按新方案走", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const plans = (await library(t))[factor]!;
    const p1 = plans.find((p) => p.key === "debottleneck")!; // eff 13 tn 6
    const p2 = plans.find((p) => p.key === "reroute")!; // eff 9  tn 3
    const before = (await forcedCard(t, base, factor)).series;

    expect((await adopt(t, { base, factor, planKey: p1.key })).status).toBe("EXECUTED");
    expect((await adopt(t, { base, factor, planKey: p2.key })).status).toBe("EXECUTED");

    const objs = await t.repos.objects.listByType("demo", "AdoptedMitigation");
    const active = objs.filter((o) => o.props.status === "ACTIVE");
    expect(objs.length, "两次采纳应留两条台账（旧条保留但 REVOKED，R13 可审计）").toBe(2);
    expect(active.length, "同一 (base,factor) 至多一条 ACTIVE —— 并存会让读侧要在多条里挑，挑错即错数").toBe(1);
    expect(active[0]!.props.planKey).toBe(p2.key);
    expect(objs.find((o) => o.props.planKey === p1.key)!.props.status).toBe("REVOKED");

    // 曲线按**新**方案（p2）走，不是旧的、也不是两者叠加。
    const after = (await forcedCard(t, base, factor)).series;
    for (let i = 0; i < H; i++) {
      const day = i + 1;
      const want = day < p2.tn ? before[i]! : Math.max(0, Math.round((before[i]! - p2.eff) * 1e4) / 1e4);
      expect(after[i], `第 ${day} 天应按 ${p2.key}(eff=${p2.eff},tn=${p2.tn}) 走`).toBeCloseTo(want, 6);
    }
  }, 300000);

  it("ACTIVE 记录残缺（eff/tn 被改坏）→ 报错，不按缺省值静默消解（③ 拒绝 > 静默错数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.repos.objects.put({
      id: "obj_adoptedmitigation_broken",
      tenantId: "demo",
      type: "AdoptedMitigation",
      props: { adoptionId: "broken", baseId: "jiangmen", factor: "瓶颈工序", planKey: "debottleneck", status: "ACTIVE" },
      origin: { type: "MANUAL" },
    });
    const res = await invokeSolver(t, "risk_timeline", { base: "jiangmen", factor: "瓶颈工序", horizon: H });
    expect(res.statusCode, "残缺采纳记录被静默跳过 → 用户以为采纳了而曲线不动（正是本单要治的病）").toBeGreaterThanOrEqual(400);
    expect(res.body).toContain("残缺");
  }, 300000);
});
