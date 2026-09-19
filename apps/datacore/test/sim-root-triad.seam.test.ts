import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import type { TickState } from "@platform/contracts";

/**
 * WO-SIM-ROOT-TRIAD · 三个**根源**扰动因素的接缝门
 * （G-ROOT-1 销售预测偏差 · G-ROOT-2 订单插单/取消 · G-ROOT-4 设备故障）。
 *
 * ══ 驱动的接缝 = 「种子数据 × 传导引擎」两半，任一半漏即红 ═════════════════════════
 *
 *   数据半：`seed.ts` 的规则 → `deriveSeedBaseSnapshot` 铺格子 → 真链路表上的实例
 *   引擎半：`POST /a/v1/sim/sessions` → `propagateTick` 逐拍落盘 → 回包里的世界态
 *
 * 每个根源三臂，**三臂各咬一半以上，合起来才咬住整条链**：
 *   ① **入度臂**：新量纲在**现算**的传导图上入度 = 0（它是根源，只能被外部打进来）。
 *      入度用**路由下发的真规则表**现算，不许硬编码键名清单 —— 硬编码会随下一条边失效。
 *      外加一条 **降级臂**：`demandPressure` 的入度必须**从 0 变成 ≥1**（G-ROOT-1 的模型修正）。
 *   ② **落点臂**：落点在 `world.state` 里**真带**这个量纲，且是**有分布的真值**（全距 > 0），
 *      不是 0 占位。⚠ 这是最容易假绿的一臂：只在对象属性上加变量、不进 `state`，
 *      用户在屏上"施加成功"而 `propagateTick` 读到 `undefined` ⇒ 下游一动不动
 *      （本仓注释里点名的「静默错答的老形态」）。
 *   ③ **传导臂**（标的）：同一个真世界跑两条线（基线 / 把根源那一格抬高 D），
 *      断言下游**值的方向与量级**，不是「没报错」。
 *      1 跳目标是**精确等式** `Δ = N × coefficient × D` —— 这条等式之所以成立，
 *      正因为它是根源：**没有任何规则写它** ⇒ 源值逐拍恒定 ⇒ 每拍贡献相同。
 *      量级对不上 = 引擎没照系数走；符号对不上 = 边的方向写反了。
 *
 * ══ 金丝雀（铁律 0.6：报否定结论之前先自证工具）═══════════════════════════════════
 *   · §0 恒等式：源码抽取器抽出的条数 === 路由下发的条数 === `grep -c "sourceStateVar:"`。
 *     不等 ⇒ 报「**工具坏了**」，不许报任何图结论。本单的对账文档正是被这一条救过一次
 *     （第一版正则 300 字窗口只抽出 28/35，据此得出「loadPressure 不在传导图里」的错误结论）。
 *   · §1 入度计数器拿一个**已知非零**的量纲自证（`demandLoad`），它若也报 0 ⇒ 计数器坏了，
 *     而不是「新量纲是根源」。报「入度为 0」时把这条证据一并打印。
 *   · §3 拿一个**已知走得通**的老根源（`deliveryDelay`）跑同一套机器；它若也不动 ⇒
 *     报「传导引擎不工作」，不许报「新根源接错了」。
 */

// ── 本单的三个根源（唯一出处：下面每一处都从这里取，不各写一遍）────────────────────
const TRIAD = [
  { gate: "G-ROOT-1", stateVar: "forecastBias", ruleKey: "demo_forecast_bias_to_order_demand", zh: "销售预测偏差（正=高估）" },
  { gate: "G-ROOT-2", stateVar: "orderChurn", ruleKey: "demo_order_churn_to_line_split", zh: "订单变更压力" },
  { gate: "G-ROOT-4", stateVar: "equipmentFailure", ruleKey: "demo_equipment_failure_to_process_queue", zh: "设备故障率" },
] as const;

/**
 * WO-PROP-CLAMP：传导臂判据从「**恒等于** N×系数×D」放宽为「**同号 · 非零 · 不超过**它」。
 *
 * 为什么必须改（不是为了让测试变绿）：`TICKS × coeff × BUMP × targets` 是**无衰减无夹值纯积分器**
 * 才成立的线性叠加式。本仓已给状态量加了声明取值域（保序饱和）与衰减 —— 这两件事都**只会减小** |Δ|，
 * 不会放大它。于是：
 *  · **恒等式**今天是假的（实测 G-ROOT-1 期望 144、实得 0.11 —— 目标格深度饱和，灵敏度被压到 1/(1+u)²）；
 *  · 而这条测试真正要守的东西一条没丢：**这条边接没接上（非零）· 方向对不对（同号）· 有没有凭空放大（不超过上界）**。
 *
 * ⚠ 实得远小于上界**本身就是一条情报**，不是噪声：它说明目标量纲的入流量级与其取值域不匹配
 *   （实测 `Order.demandPressure → Model.demandLoad` 单拍入流 ≈3460 注进一个 0–100 的量纲，
 *    衰减稳态约为上界的 94 倍），扰动因而落在饱和曲线的平坦段。那是**扇入未按量纲归一**这条独立缺陷，
 *   不是本条断言该掩盖的东西 —— 故这里保留上界断言，让"凭空放大"仍然会红。
 */
function expectPropagated(actual: number, ideal: number, label: string): void {
  expect(actual, `${label}：一动不动 ⇒ 这条边没接上`).not.toBe(0);
  expect(Math.sign(actual), `${label}：方向反了（期望与 ${ideal} 同号）`).toBe(Math.sign(ideal));
  expect(Math.abs(actual), `${label}：|Δ| 超过了无衰减无夹值的线性上界 ⇒ 凭空放大`).toBeLessThanOrEqual(Math.abs(ideal) + 1e-9);
}

/** 已知走得通的**老**根源 —— §3 的金丝雀（它若也不动，是引擎坏了，不是新边接错了）。 */
const CANARY_ROOT = { stateVar: "deliveryDelay", ruleKey: "demo_supplier_delay_to_material_shortage" } as const;

/** 已知入度非零的量纲 —— §1 的金丝雀（它若也报 0，是计数器坏了，不是「新量纲是根源」）。 */
const CANARY_NONROOT = "demandLoad";

const SEED_PATH = fileURLToPath(new URL("../src/seed.ts", import.meta.url));

interface LiveRule {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  viaLinkKey: string;
  targetTypeKey: string;
  targetStateVar: string;
  coefficient: number;
  delayTicks: number;
  /**
   * 对手方还手声明（WO-ADVERSARY-REACTION）。`null`/缺省 = 普通物理传导。
   * 「根源 = 入度 0」这条判据只数**物理边** —— 还手是世界之外的主体主动做的事，
   * 它写一个量纲不代表这个量纲变成了内生衍生量。
   */
  reaction?: { actorTypeKey: string; tolerance: number; move: string } | null;
}

/**
 * 从**种子源码**抽 `(sourceStateVar, targetStateVar)` 对 —— 给运行态当**独立第二证人**。
 *
 * ⚠ 抽取器是会骗人的（本仓已实测两次）：按「五行连续」写的整体正则会被行尾注释打断，
 * 按固定字符窗口写的正则会截断长条目。这里按**对象字面量切段、段内不限窗口**，
 * 并把条数恒等式交给调用方当金丝雀 —— 「抽到了一条」不度量「抽全了」。
 */
function extractSeedEdges(src: string): { edges: { from: string; to: string }[]; declaredRows: number } {
  const start = src.indexOf("const DEMO_PROPAGATION_RULES");
  const end = src.indexOf("export async function seedDemoPropagationRules");
  if (start < 0 || end < 0 || end <= start) throw new Error("工具坏了：seed.ts 里找不到 DEMO_PROPAGATION_RULES 的锚点");
  const block = src.slice(start, end);
  const edges: { from: string; to: string }[] = [];
  for (const chunk of block.split(/^\s*\{\s*$/m)) {
    const s = /^\s*sourceStateVar: "([A-Za-z0-9_]+)"/m.exec(chunk);
    const t = /^\s*targetStateVar: "([A-Za-z0-9_]+)"/m.exec(chunk);
    if (s && t) edges.push({ from: s[1]!, to: t[1]! });
  }
  // 独立口径（等价于 `grep -c 'sourceStateVar:'`）：与上面的切段法**完全不同的数法**。
  return { edges, declaredRows: (block.match(/^\s*sourceStateVar: "/gm) ?? []).length };
}

/** 入度 = 有多少条规则**写**这个量纲（现算，零硬编码名单）。 */
const inDegreeOf = (rules: readonly LiveRule[], stateVar: string): number =>
  rules.filter((r) => r.targetStateVar === stateVar).length;

/** 出度 = 有多少条规则**读**这个量纲。 */
const outDegreeOf = (rules: readonly LiveRule[], stateVar: string): number =>
  rules.filter((r) => r.sourceStateVar === stateVar).length;

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function bootstrap(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t); // 数据半：物化本体对象 + 真链路
  await seedDemoPropagationRules(t.repos); // 数据半：PUBLISHED 传导规则
  await enableSim(t);
  return t;
}

async function liveRules(t: TestApp): Promise<LiveRule[]> {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return (r.json() as { items: LiveRule[] }).items;
}

/** 某类型在本租户的对象 id（升序，与引擎的遍历序同）。 */
async function idsOfType(t: TestApp, typeKey: string): Promise<string[]> {
  const rows = await t.repos.objects.listByType("demo", typeKey);
  return rows.filter((o) => !o.mergedInto).map((o) => o.id).sort((a, b) => a.localeCompare(b));
}

/**
 * 建会话 + **逐拍**推 n 拍，回 [tick0..tickN] 的整条状态轨迹（走真路由，不碰内部函数）。
 *
 * 为什么远端臂必须用轨迹而不是端点（实测，不是推断 —— /tmp/t2-diag3.txt）：
 * 本引擎是「线性传导 + 几何衰减（λ=0.37）+ 声明域软夹」三件套。根源量（入度 0）逐拍恒定
 * （§3 头注的恒等式正靠这一条），而**衍生量**的稳态 = rest + 入流/λ —— 入流量级与声明域
 * 不匹配时（已登记的「扇入未按量纲归一」缺陷），目标格被钉死在域轨上：
 * 实测 `Model.demandLoad` 全场自 tick3 起 = 0.0000（`Order.demandPressure` 快衰减
 * 7707→5.8，而 `Order.orderChurn` 准静态 ≈7700，㊶ 翻负后 churn 项恒定 −643/型号/拍
 * 压过 dp 项 ⇒ 全场撞 0 下轨；翻负前同样饱和，只是钉在 100 上轨）。
 * 信号一旦撞轨，**该方向上的余量归零，端点差分恒 = 0** —— 端点量的是「轨的泄漏」不是「传导」。
 * 而信号**到达那一拍**是活的：G-ROOT-1 远端 tick2 = −86.97（WO-PROP-REVIEW-V2 库存环两条边进场后
 * 的重测值，/tmp/t3-triad-probe.txt；翻负后初测 −65.35 见 /tmp/t2-diag3.txt —— 库存环的恒定下压力
 * 让被扰世界提前一拍撞 0 轨，到达拍的差分从「−65」变成「把整场 86.97 全压掉」，判据不变）、
 * G-ROOT-4 远端 tick2 达峰 +0.0026 后逐拍衰减（㉜ 反向重瞄 Line.blockedPressure，T6 形态② 后重测
 * /tmp/t6-triad-probe.txt；积分器时代旧值 tick2=+0.2050 单调增至 tick8=+0.4563 见 /tmp/t5-triad-probe.txt ——
 * 量级差 ~100× 是「纯积分器累积 vs λ=0.37+[0,100] 夹后均衡」的结构性差，不是信号变弱；
 * 反向证据 = 旧落点 Equipment.loadPressure 逐拍 Δ 全 0）、
 * G-ROOT-2 远端 tick5–8 = −0.0001x∼−0.0002（四跳残迹）。
 * 故远端断言取**窗口内有向极值**
 * （方向对 ⇒ 极值必然同号非零；没到 ⇒ 恒 0），这既咬可达性又咬方向，且不拿死端点冒充证据。
 */
async function runWorldTrajectory(t: TestApp, baseSnapshot: TickState, n: number): Promise<TickState[]> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(created.statusCode, `建会话失败：${created.body}`).toBe(201);
  const sid = (created.json() as { id: string }).id;
  const traj: TickState[] = [baseSnapshot];
  for (let i = 0; i < n; i++) {
    const ticked = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(ticked.statusCode, `推拍失败：${ticked.body}`).toBe(200);
    traj.push((ticked.json() as { state: TickState }).state);
  }
  return traj;
}

/** 一批对象在某量纲上的读数之和（缺格记 0）。 */
const sumOf = (state: TickState, ids: readonly string[], stateVar: string): number =>
  ids.reduce((acc, id) => acc + (state[id]?.[stateVar] ?? 0), 0);

/** 逐拍 Δ 轨迹压成一行短串（只进断言消息：红了时轨迹本身就是诊断）。 */
const fmtTraj = (traj: readonly number[]): string => traj.map((d) => d.toFixed(4)).join("/");

/** 深拷贝一份世界态（两条线必须从**逐字节相同**的起点出发，否则差值不度量扰动）。 */
const cloneState = (s: TickState): TickState => JSON.parse(JSON.stringify(s)) as TickState;

/** 推拍数：最深的一条新链 orderChurn→demandLoad→loadIndex→(delay1)utilPressure→releasePressure 要 5 拍，8 拍留余量。 */
const TICKS = 8;
/** 抬高幅度：取一个与派生读数（0–100）同量级、且乘上任何系数都不会整成 0 的数。 */
const BUMP = 10;

describe("WO-SIM-ROOT-TRIAD · 三个根源扰动因素（SEAM：种子数据 × 传导引擎）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // §0 金丝雀先说话 —— 报任何「入度为 0 / 这个量纲不在图里」之前，先自证工具
  // ══════════════════════════════════════════════════════════════════════════
  it("§0 🐤 恒等式金丝雀：源码抽取器 === grep 口径 === 路由下发条数（三者不等即『工具坏了』）", async () => {
    const { edges, declaredRows } = extractSeedEdges(readFileSync(SEED_PATH, "utf8"));
    expect(
      edges.length,
      `工具坏了：切段法抽出 ${edges.length} 条，而 grep 口径 ${declaredRows} 条 —— 不许据此报任何传导图结论`,
    ).toBe(declaredRows);
    expect(edges.length, "抽出 0 条 ⇒ 锚点或正则坏了，不是『种子里没有规则』").toBeGreaterThan(10);

    const t = await bootstrap();
    const live = await liveRules(t);
    expect(live.length, `源码 ${edges.length} 条 vs 路由 ${live.length} 条 —— 不等说明播种漏了或路由过滤了`).toBe(edges.length);

    // 三个新量纲必须在**源码抽取器**这个独立证人里也看得见（不是只有路由说有）。
    for (const { stateVar } of TRIAD) {
      expect(
        edges.some((e) => e.from === stateVar || e.to === stateVar),
        `${stateVar} 在种子源码里一条边都没有`,
      ).toBe(true);
    }
  }, 120000);

  // ══════════════════════════════════════════════════════════════════════════
  // §1 入度臂 —— 它们是**根源**（入度 0），且 demandPressure 被**降级**
  // ══════════════════════════════════════════════════════════════════════════
  it("§1 🔴 入度臂：三个新量纲入度 = 0（现算·非硬编码名单），且 demandPressure 由 0 → ≥1（降级）", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);

    // 🐤 金丝雀：入度计数器拿一个**已知非零**的量纲自证。它若也报 0，是计数器坏了。
    const canaryIn = inDegreeOf(rules, CANARY_NONROOT);
    expect(canaryIn, `工具坏了：${CANARY_NONROOT} 的入度算出 0，而它明明被多条规则写 ⇒ 计数器不度量入度`).toBeGreaterThan(0);

    // ── 三个根源：入度必须为 0（否定结论 ⇒ 同时给出金丝雀命中证据）──────────────
    //
    // 🔴 **口径修正（WO-ADVERSARY-REACTION）**：入度只数**非还手边**。
    //    「根源 = 入度 0」这条判据说的是「世界自己不会产生它，只能被外部打进来」。
    //    而**对手方还手**恰恰是「世界之外的另一个主体主动做的事」——
    //    它写 `orderChurn` 不代表这个量纲变成了内生衍生量，而是代表**有人在跟我博弈**。
    //    两件事必须分开数，否则「客户会不会还手」这个开关一开，
    //    三个根源里就有一个被读成"不再是根源"，而它的外生性一个字节都没变。
    //    ⚠ 且还手边**默认是关的**（`sim.propagation.adversary` 在 WORLD 暗发集里），
    //    默认世界（= 单方推演）里 `orderChurn` 的入度**就是 0**，与本单引入前逐字节相同。
    const physical = rules.filter((r) => r.reaction == null);
    for (const { gate, stateVar } of TRIAD) {
      const writers = physical.filter((r) => r.targetStateVar === stateVar).map((r) => r.key);
      expect(
        writers,
        `${gate} · ${stateVar} 不再是根源：被 ${writers.join("、")} 写。` +
          `（金丝雀：${CANARY_NONROOT} 入度 ${canaryIn} > 0 ⇒ 计数器是好的，这不是工具问题）`,
      ).toEqual([]);
      // 根源必须**有下游**，否则它是个扰了也没人看的孤儿格
      expect(outDegreeOf(rules, stateVar), `${gate} · ${stateVar} 出度为 0 ⇒ 扰它什么都不会发生`).toBeGreaterThan(0);
    }

    // ── 🔴 降级臂：demandPressure 从根源变成一级衍生（本单有意的模型修正）────────
    const demandWriters = rules.filter((r) => r.targetStateVar === "demandPressure").map((r) => r.key);
    expect(
      demandWriters,
      "demandPressure 仍然入度 0 ⇒ G-ROOT-1 的模型修正没落地（预测偏差没接上需求压力）",
    ).toContain("demo_forecast_bias_to_order_demand");
    expect(inDegreeOf(rules, "demandPressure")).toBeGreaterThanOrEqual(1);

    // ── 根源集合（现算）：必须**包含**新三个 + 两个老根源，且**不含** demandPressure ──
    // 用「包含」而不是「等于」：别的单也在往图里加根源边，写死全集会把它们全变成假红。
    const vars = new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
    const roots = [...vars].filter((v) => inDegreeOf(physical, v) === 0).sort();
    for (const v of [...TRIAD.map((x) => x.stateVar), "deliveryDelay", "priceShock"]) {
      expect(roots, `${v} 应当是根源（现算根源集：${roots.join("、")}）`).toContain(v);
    }
    expect(roots, "demandPressure 已降级为一级衍生，不该再出现在根源里").not.toContain("demandPressure");

    // ── 🔴 **升格臂**（WO-ADVERSARY-REACTION，与上面的「降级臂」同款写法）──────────
    // `orderChurn` 的语义是「客户临时插单/取消」。本单之前它**只能由用户手动拨**
    // ⇒ 世界里再糟的事都不会让任何客户主动少下一张单（= 单方推演，对手不还手）。
    // 本单给了它**第一条入边**，且这条入边是**还手边**（`reaction != null`）：
    // 客户被成本转嫁压过容忍线之后自己砍单。两条断言把这件事钉死 ——
    //  · 物理边里它仍然入度 0（上面已断言，即"默认世界逐字节同旧"）；
    //  · 还手边里它入度恰好 1，且那条边确实标着 reaction（不是随手加的普通传导边）。
    const churnReactionWriters = rules.filter(
      (r) => r.targetStateVar === "orderChurn" && r.reaction != null,
    );
    expect(
      churnReactionWriters.map((r) => r.key),
      "orderChurn 没有任何还手边 ⇒ 对抗方没落地：世界仍然只有『用户手动拨客户才砍单』这一条路",
    ).toEqual(["demo_customer_reaction_cut_order"]);
    expect(churnReactionWriters[0]!.reaction!.actorTypeKey).toBe("Customer");
    expect(churnReactionWriters[0]!.reaction!.move).toBe("CUT_ORDER");
  }, 120000);

  it("§1b 🔴 中文名：三个根源在**真接口**里都拿得到人话名（下拉里没名字 = 用户挑不出来）", async () => {
    const t = await bootstrap();
    const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const cfg = r.json() as { stateVars: string[]; stateVarNames?: Record<string, string> };
    // 🐤 金丝雀：先证明这份字典真的非空，否则下面逐条比对恒绿
    expect(cfg.stateVarNames?.loadIndex, "工具坏了：连老量纲的名字都取不到").toBe("负载指数");
    for (const { gate, stateVar, zh } of TRIAD) {
      expect(cfg.stateVars, `${gate} · ${stateVar} 没进 view-config 的量纲清单`).toContain(stateVar);
      expect(cfg.stateVarNames?.[stateVar], `${gate} · ${stateVar} 没有中文名`).toBe(zh);
    }
  }, 120000);

  // ══════════════════════════════════════════════════════════════════════════
  // §2 落点臂 —— 真进了 `world.state`，且是**有分布的真值**不是 0 占位
  // ══════════════════════════════════════════════════════════════════════════
  it("§2 🔴 落点臂：三个根源在真种子世界态里**真带上**，且全距 > 0（不是 0 占位）", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);
    const { state } = await deriveSeedBaseSnapshot(t.repos, "demo"); // 生产同一支派生

    // 🐤 金丝雀：这个世界态真的非空（空世界会让下面每一条"某量纲缺席"都读作代码问题）
    const cells = Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);
    expect(cells, "工具坏了：派生出来的世界态是空的").toBeGreaterThan(100);

    /**
     * 落点集合**从生产真正 offer 给用户的那一份取**（`view-config.nodeObjectIds`），
     * ⛔ 不在测试里再抄一份过滤谓词 —— 抄一份就是装饰品：改生产那份时这份拿旧的去测、照样绿。
     *
     * ⚠ 为什么不再用 `repos.objects.listByType`（2026-09-15 改，来历是一次真事故）：
     * 引擎侧把**已完成订单**排除出推演世界（`entersSimWorld`：扰动不该推动已成交的单）之后，
     * `listByType` 仍回 500 张而 `world.state` 只剩 150 ⇒ 本断言报「350/500 个落点没进 state」。
     * 当时两种改法都能变绿，只有一种是对的：
     *   ✗ 把断言放宽成「允许缺失」—— 那等于把「静默错答」这个真风险的守卫拆掉
     *   ✓ 把「落点」的口径对齐到**用户真能选到的那一份** —— 本条采用
     * 判据没有变弱：它现在咬的是**真实接缝**（view-config ↔ world.state），
     * 谁把 `nodeObjectIds` 的过滤改漂了，这里当场红。
     */
    const vcRes = await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN });
    expect(vcRes.statusCode, "取不到 view-config ⇒ 本条无从判定").toBe(200);
    const nodeObjectIds = (vcRes.json() as { nodeObjectIds?: Record<string, string[]> }).nodeObjectIds ?? {};
    // 🐤 金丝雀：这份清单真的非空，否则下面「每个落点都在 state 里」恒真（空集恒满足）
    const offeredTotal = Object.values(nodeObjectIds).reduce((n, a) => n + a.length, 0);
    expect(offeredTotal, "工具坏了：view-config 一个落点都不下发 ⇒ 下面的全称断言恒绿").toBeGreaterThan(100);

    for (const { gate, stateVar, ruleKey } of TRIAD) {
      const rule = rules.find((r) => r.key === ruleKey);
      expect(rule, `${gate} · 规则 ${ruleKey} 没播进来`).toBeDefined();
      const landingType = rule!.sourceTypeKey;
      const ids = [...(nodeObjectIds[landingType] ?? [])];
      expect(ids.length, `${gate} · 落点类型 ${landingType} 在 demo 里零对象 ⇒ 这个根源扰不动`).toBeGreaterThan(0);

      // ── 反向咬一口：只断言「offer ⊆ state」是不够的，把 offer 砍成 1 条也满足它。
      //    所以再钉死：offer 的那份必须**恰好**是全目录里真正进了世界的那批，一个不多一个不少。
      //    多出来的会静默错答（屏上「施加成功」下游不动）；少掉的是用户本该能扰却选不到。
      const inWorld = (await idsOfType(t, landingType)).filter(
        (id) => typeof state[id]?.[stateVar] === "number",
      );
      expect(
        ids.slice().sort(),
        `${gate} · ${landingType} 的落点清单与「进了世界的那批」不是同一集合`,
      ).toEqual(inWorld.slice().sort());

      // ── 真带上：**每一个**落点对象都要有这一格（不是"某几个有"）──────────────
      const missing = ids.filter((id) => typeof state[id]?.[stateVar] !== "number");
      expect(
        missing.length,
        `${gate} · ${landingType}.${stateVar} 有 ${missing.length}/${ids.length} 个落点没进 world.state ⇒ ` +
          `用户扰它时 propagateTick 读到 undefined，屏上"施加成功"而下游一动不动（静默错答的老形态）`,
      ).toBe(0);

      // ── 值非空：全距 > 0。全距为 0 的量纲连种子扰动都会把它判出局
      //    （`pickSeedPerturbation`：「全距为 0 的变量直接出局：delta 0 = 什么都没发生」）。
      const values = ids.map((id) => state[id]![stateVar]!);
      expect(values.every((v) => Number.isFinite(v)), `${gate} · ${stateVar} 有非有限值`).toBe(true);
      expect(
        Math.max(...values) - Math.min(...values),
        `${gate} · ${landingType}.${stateVar} 全世界同一个数（全距 0）⇒ 这是 0/常数占位，不是可扰的读数`,
      ).toBeGreaterThan(0);
    }
  }, 180000);

  // ══════════════════════════════════════════════════════════════════════════
  // §3 传导臂（标的）—— 扰它，下游**真的动**，且方向与量级都对
  // ══════════════════════════════════════════════════════════════════════════
  it("§3 🔴 传导臂：每个根源抬高 D ⇒ 1 跳目标 Δ 同号·非零·不超过 N×系数×D，远端下游按预期方向动", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);
    const seed = (await deriveSeedBaseSnapshot(t.repos, "demo")).state;
    const links = await t.repos.links.list("demo");

    /** 沿某条 linkKey 从 fromId 出发、类型为 targetType 的下游对象（与引擎的 `targetsOf` 同判据）。 */
    const typeOf = new Map<string, string>();
    for (const ot of await t.repos.ontologyTypes.list("demo")) {
      for (const o of await t.repos.objects.listByType("demo", ot.key)) typeOf.set(o.id, o.type);
    }
    const targetsOf = (linkKey: string, fromId: string, targetType: string): string[] =>
      links.filter((l) => l.type === linkKey && l.fromId === fromId && typeOf.get(l.toId) === targetType).map((l) => l.toId).sort();

    // 基线：整个世界一个字节不动，逐拍推 N 拍。三个根源共用这条轨迹（省一半机器时间）。
    const baseline = await runWorldTrajectory(t, cloneState(seed), TICKS);

    /** 把某一格抬高 D 再逐拍跑一遍，回「1 跳目标的端点 Δ」与「远端下游的逐拍 Δ 轨迹」。 */
    const probe = async (rule: LiveRule, farType: string, farVar: string) => {
      const landingIds = await idsOfType(t, rule.sourceTypeKey);
      // 选落点：第一个**沿这条边真有下游**的对象（没有下游的落点扰了也不会动，测它等于测空气）
      const pick = landingIds
        .map((id) => ({ id, targets: targetsOf(rule.viaLinkKey, id, rule.targetTypeKey) }))
        .find((x) => x.targets.length > 0);
      expect(
        pick,
        `${rule.key}: ${rule.sourceTypeKey} --${rule.viaLinkKey}--> ${rule.targetTypeKey} 在真链路表上一个落点都走不通`,
      ).toBeDefined();

      const before = seed[pick!.id]?.[rule.sourceStateVar];
      // 这一句同时是落点臂在**传导现场**的复核：格子不在，下面的 Δ 就不度量任何东西。
      expect(typeof before, `${rule.key}: 落点 ${pick!.id}.${rule.sourceStateVar} 不在 world.state 里`).toBe("number");

      const bumped = cloneState(seed);
      bumped[pick!.id]![rule.sourceStateVar] = before! + BUMP;
      const after = await runWorldTrajectory(t, bumped, TICKS);

      const farIds = await idsOfType(t, farType);
      // 远端逐拍 Δ（tick1..TICKS；tick0 两世界逐字节相同，Δ 恒 0，不进窗口）。
      const farTraj = baseline.map((b, i) => sumOf(after[i]!, farIds, farVar) - sumOf(b, farIds, farVar)).slice(1);
      return {
        oneHopDelta:
          sumOf(after[TICKS]!, pick!.targets, rule.targetStateVar) - sumOf(baseline[TICKS]!, pick!.targets, rule.targetStateVar),
        oneHopTargets: pick!.targets.length,
        /** 远端窗口有向极值：min ≤ 逐拍 Δ ≤ max。信号到达 ⇒ 对应一侧非零；没到 ⇒ 两侧皆 0。 */
        farMin: Math.min(...farTraj),
        farMax: Math.max(...farTraj),
        farTraj,
        pickId: pick!.id,
      };
    };

    // ── 🐤 金丝雀：先拿**已知走得通**的老根源跑同一套机器 ────────────────────────
    // 它若也不动 ⇒ 报「传导引擎/取数坏了」，**不许**报「新根源接错了」。
    const canaryRule = rules.find((r) => r.key === CANARY_ROOT.ruleKey)!;
    const canary = await probe(canaryRule, "Model", "supplyRisk");
    expect(
      canary.oneHopDelta,
      `工具坏了：老根源 ${CANARY_ROOT.stateVar} 抬高 ${BUMP} 之后 1 跳目标一动不动 ⇒ 这是引擎/取数问题，不是新边的问题`,
    ).not.toBe(0);
    expectPropagated(canary.oneHopDelta, TICKS * canaryRule.coefficient * BUMP * canary.oneHopTargets, "金丝雀老根源");

    // ── G-ROOT-1 · 预测偏差 → 订单需求压力（**负向**：高估 ⇒ 需求压力下修）───────
    const r1 = rules.find((r) => r.key === "demo_forecast_bias_to_order_demand")!;
    expect(r1.coefficient, "G-ROOT-1 的系数必须为负：高估(+) ⇒ 需求压力下修。正系数会把方向读反").toBeLessThan(0);
    const p1 = await probe(r1, "Model", "demandLoad");
    expectPropagated(p1.oneHopDelta, TICKS * r1.coefficient * BUMP * p1.oneHopTargets, `G-ROOT-1 传导臂（落点 ${p1.pickId}）`);
    expect(p1.oneHopDelta, "方向错了：高估预测应当把需求压力**压低**").toBeLessThan(0);
    // ⚠ 远端取**窗口极值**不取端点：实测 demandLoad 全场自 tick3 起钉死 0 下轨
    //    （churn 准静态 × ㊶ −0.5 压过快衰减的 dp 项），端点差分恒 = 0 —— 死端点不度量传导。
    //    信号在到达拍是活的（tick2 = −86.97，/tmp/t3-triad-probe.txt —— WO-PROP-REVIEW-V2
    //    库存环进场后重测；初测 −65.35 见 /tmp/t2-diag3.txt），窗口 min 咬的就是它。
    expect(
      p1.farMin,
      `G-ROOT-1 远端：需求压力下修应当把型号需求负载一起带下去（窗口有向极值；逐拍 Δ = ${fmtTraj(p1.farTraj)}）`,
    ).toBeLessThan(0);

    // ── G-ROOT-2 · 订单变更 → 订单行拆分压力；远端真的走到工单下达压力 ───────────
    const r2 = rules.find((r) => r.key === "demo_order_churn_to_line_split")!;
    expect(r2.coefficient).toBeGreaterThan(0);
    const p2 = await probe(r2, "WorkOrder", "releasePressure");
    expectPropagated(p2.oneHopDelta, TICKS * r2.coefficient * BUMP * p2.oneHopTargets, `G-ROOT-2 传导臂（落点 ${p2.pickId}）`);
    // 🔴 派单原文要的是 `orderChurn → releasePressure`。Order→WorkOrder 没有任何链路
    //    （`workOrderProps` 里根本没有订单 FK），故改走 order_for_model 四跳。这一条断言的正是
    //    「虽然多了两跳，它**真的**走到了工单下达压力」—— 不然那句改接就只是说说。
    //
    // ⚠ **方向已于评审 v2 ① 翻负**（WO-PROP-COEF-CONFIG·T2，2026-09-17）：
    //    落点那张单的 orderChurn 同时点火两条边 —— 本条（→ splitPressure，**死胡同**，
    //    无出边，信号到不了工单）与 `demo_order_churn_to_model_demand_load`（㊶）。
    //    故远端信号**全部**走 ㊶ 的四跳链：orderChurn → Model.demandLoad → Base.loadIndex
    //    → Line.utilPressure → WorkOrder.releasePressure。㊶ 系数 +0.5 → **−0.5**
    //    （取消/缩水占多 ⇒ 净需求下修 ⇒ 下达压力随之下行，下游三边皆正 ⇒ 远端必为负）。
    //    断言从「顶起来」改成「压下去」—— 变的只是方向，**可达性照旧被这条咬着**。
    expect(
      p2.farMin,
      `G-ROOT-2 远端：变更沿四跳（→型号需求负载→基地负载→产线利用率→工单下达）之后工单侧必须随净需求下修而下行` +
        `（窗口有向极值 —— 四跳残迹实测 tick5–8 ≈ −0.0001x，小但同号非零；逐拍 Δ = ${fmtTraj(p2.farTraj)}）`,
    ).toBeLessThan(0);

    // ── G-ROOT-4 · 设备故障 → 工序排队压力；远端真的走到产线受阻压力 ──────────────
    const r4 = rules.find((r) => r.key === "demo_equipment_failure_to_process_queue")!;
    expect(r4.coefficient).toBeGreaterThan(0);
    const p4 = await probe(r4, "Line", "blockedPressure");
    expectPropagated(p4.oneHopDelta, TICKS * r4.coefficient * BUMP * p4.oneHopTargets, `G-ROOT-4 传导臂（落点 ${p4.pickId}）`);
    // 🔴 远端重瞄（WO-PROP-REVIEW-V2 ㉜ · 2026-09-18）：派单原文的两跳落点
    //    `queuePressure → Equipment.loadPressure` 已随 ㉜ 反向不复存在（`loadPressure` 升格根源、入度 0）。
    //    反向证据：扰 equipmentFailure 后 `loadPressure` 逐拍 Δ **全 0**（/tmp/t5-triad-probe.txt 对照行）。
    //    故障信号改经 `demo_process_queue_to_line_blocked` 走向产能主链 —— 比原来更远一跳、更贴近订单侧。
    expect(
      p4.farMax,
      `G-ROOT-4 远端：设备故障两跳（→工序排队→产线受阻）之后 Line.blockedPressure 必须真的动` +
        `（窗口有向极值；T6 形态② 后 blockedPressure 带 λ=0.37 衰减 + [0,100] 软夹，信号均衡不累积：` +
        `实测 tick2 达峰 +0.0026 后逐拍衰减（/tmp/t6-triad-probe.txt；积分器时代旧值 +0.2050→+0.4563）；逐拍 Δ = ${fmtTraj(p4.farTraj)}）`,
    ).toBeGreaterThan(0);
  }, 300000);
});
