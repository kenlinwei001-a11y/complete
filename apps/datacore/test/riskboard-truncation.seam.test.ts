import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";

/**
 * ★ WO-RISKBOARD-TRUNCATION · 风险榜**静默截断**的接缝门。
 *
 * ── 病（A 类：用户会在屏上看到错的东西，不是记账错误）─────────────────────────────────────
 * `solvers/risk.ts` 把每基地一张的越线卡按「越线日↑ → 当前张力↓ → 峰值↓」排好序后
 * `cards.slice(0, maxCards)`（`maxCards`=8），**被截掉的基地连同"它已经越线"这个事实一起从回包消失**；
 * 契约又把 `cards` 钉死在 `.max(8)`。于是屏上那 8 张卡究竟是"全网只有 8 个基地越线"
 * 还是"越线的有 13 个、这是前 8"，**在屏上无法区分**。
 *
 * 实测（seed 42·horizon 30·阈值 85·零采纳）：**13 个基地全部越线，看板只显示 8 个，5 个隐身。**
 * 这不是采纳动作触发的边角情形 —— **它是这块看板的默认状态**。
 *
 * 采纳「常州·瓶颈工序·工艺路线调整」(eff=9/T+3) 后更难看：常州峰值 98.0000 → 97.9531，
 * 比成都的 97.9935 低 **0.047 个张力点** ⇒ 掉出前 8 ⇒ 整张卡消失，
 * **而它的 `crossDay` 仍然是 1**（第 1 天就越线，一次都没被消解）。
 * 「常州不在风险榜」于是被读成「常州没事了」—— 用户会据此不派人去常州。
 *
 * ── 判据刻意不是「跑得起来吗」，是**对照实验**（铁律 1.5 判据一）───────────────────────────
 * §2 把 X（常州的采纳）从"无"改成"有"，Y（常州在不在榜上 / 在不在未上榜名单里）**必须**按
 * 可预言的方式翻面：**掉出榜 ⇒ 同时出现在未上榜名单里，且 crossDay 仍是 1**。
 * 只断言"接口 200"或"有 8 张卡"一律不算数 —— 病的原始形态就是 **200 + 8 张卡 + 数字是错的**。
 *
 * ── 诚实位的缺省必须**整块缺席**（§3/§4）─────────────────────────────────────────────
 * 没有被截断时多出来的那句话本身就是噪声，故**不是** `count: 0` 而是**整个键不存在**，
 * 回包与本诚实位引入前逐字节相同。
 *
 * ── §4 是本门最容易被"顺手统一"掉的一条，别删 ───────────────────────────────────────────
 * 计数口径有两个候选，实测只有一个是对的：
 *   (a)「越线总数 − **榜上卡数**」 —— **错**。显式点名基地时 `forced` 卡即使不越线也恒出卡，
 *       实测 `{base:"常州", factor:"设备OEE"}` 得 `cards=1 / crossDay=null / peak=79`，
 *       (a) 算出 `0 − 1 = -1` ⇒ **一个负的"还有 N 个基地在越线"，本身就是第二个错答**。
 *   (b)「`cards` 与 `shown` 的**集合差**里 `crossDay !== null` 的那些」 —— 对，且对
 *       "`shown` 是不是数组前缀"不敏感，日后排序/筛选改了也不会悄悄算错。
 * §4 用真实参把 (a) 的算式跑出来、断言它是负的，**把"为什么不选 (a)"钉成可执行的证据**而不是注释里的一句话。
 *
 * ── ⚠ 变异反证的**诚实交代**：本门拦得住"诚实位没了"，拦不住"(a) 换 (b)" ──────────────────
 * 实测两次变异（2026-09-08）：
 *   · 变异①「把诚实位整块去掉」（`...(false ? {...} : {})`）⇒ **7 条里 5 条转红**（含 §3 金丝雀）。✅
 *   · 变异②「把计数换成候选 (a)」（`count: crossingTotal - shown.length` / `shownCrossing: shown.length`）
 *     ⇒ **全绿，一条都没红**。❌
 * 别把变异② 的绿读成"(a) 也对"。它是**结构性重合**：诚实位只在被截断时下发，而
 * `cards` 在去重后是**每基地一张**；`forced` 非越线卡只在**显式点名基地**时才出现，
 * 那条路上 `cards` 至多 1 张 ⇒ **永远不会被截断** ⇒ 键永远不下发。
 * 于是"键真的下发"的那些状态里，榜上**每一张都越线**，`shown.length === shownCrossing`，(a) 与 (b) 同值。
 * ⇒ **今天两者在所有可达状态上给同一个数**；选 (b) 的理由是它的中间算式**不会算出负数**
 * （§4 实测 (a) = −1）且对"`shown` 是不是数组前缀"不敏感 —— 是**稳健性**理由，不是当下的数值差异。
 * 谁哪天放开了"榜上可以混进不越线的卡"（如调小 `maxCards`、或改去重口径），
 * (a) 会**当场开始少报**，而本门**不会**替你发现 —— 那时需要另加一条断言。**这句话别删。**
 */

type Body = { statusCode: number; body: string };
const data = (r: Body): Record<string, unknown> => {
  const j = JSON.parse(r.body) as { data?: Record<string, unknown> };
  return j.data ?? (j as Record<string, unknown>);
};

interface Unlisted {
  count: number;
  crossingTotal: number;
  shownCrossing: number;
  cap: number;
  bases: { base: string; baseId: string; factor: string; crossDay: number; peak: number }[];
  note: string;
}
type Card = { base: string; factor: string; crossDay: number | null; peak: number };

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
}, 120_000);

const risk = async (args: Record<string, unknown>) => {
  const res = await invokeSolver(t, "risk_timeline", args);
  expect(res.statusCode).toBe(200);
  return data(res as Body) as unknown as {
    cards: Card[];
    threshold: number;
    unlistedCrossings?: Unlisted;
  };
};

/** 采纳一条处置方案 = 写 `AdoptedMitigation`(ACTIVE)（与 `adopt_mitigation` 执行器落库的形状一致）。 */
const adopt = async (baseId: string, factor: string, planKey: string, eff: number, tn: number) => {
  await t.repos.objects.put({
    id: `obj_adoptedmitigation_${baseId}-${factor}-${planKey}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
    tenantId: "demo",
    type: "AdoptedMitigation",
    props: {
      adoptionId: `${baseId}-${factor}-${planKey}`,
      baseId, factor, planKey, planName: planKey, eff, tn,
      adoptedAt: "2026-01-01", status: "ACTIVE",
    },
    origin: { type: "ACTION", actionId: "test", source: "adopt_mitigation" },
  });
};

// ---------------------------------------------------------------------------
// §1 基线（零采纳）—— 截断是**默认状态**，不是边角情形
// ---------------------------------------------------------------------------

describe("WO-RISKBOARD-TRUNCATION §1 · 基线：13 个基地全越线，榜上只有 8 个", () => {
  it("越线总数 > 看板容量 ⇒ 诚实位下发，且三个数守恒", async () => {
    const out = await risk({ horizon: 30 });
    expect(out.cards.length).toBe(8);

    const u = out.unlistedCrossings;
    expect(u, "基线态就已经被截断（13 > 8）⇒ 诚实位必须在").toBeDefined();
    // 这四个数是本门的锚：改了求解器参数或种子导致它们变化，必须**看一眼是不是又把人藏起来了**再改。
    expect(u!.cap).toBe(8);
    expect(u!.crossingTotal).toBe(13);
    expect(u!.shownCrossing).toBe(8);
    expect(u!.count).toBe(5);
    // 守恒：越线总数 = 榜上越线 + 未上榜越线。任一边算错这条就红。
    expect(u!.crossingTotal).toBe(u!.shownCrossing + u!.count);
    // 数与名单**同一出处**（`count` 由 `bases.length` 派生）⇒ 永远不会互相打架。
    expect(u!.bases.length).toBe(u!.count);
  });

  it("未上榜的每一条都**真的越线**（crossDay 非空），否则这个提示自己就在撒谎", async () => {
    const u = (await risk({ horizon: 30 })).unlistedCrossings!;
    for (const b of u.bases) {
      expect(b.crossDay, `${b.base} 出现在"越线但未上榜"里却没有越线日`).not.toBeNull();
      expect(typeof b.crossDay).toBe("number");
    }
    // 名单与榜**不相交**：同一个基地不许既在榜上又在"未上榜"里。
    const shown = new Set((await risk({ horizon: 30 })).cards.map((c) => c.base));
    for (const b of u.bases) expect(shown.has(b.base)).toBe(false);
  });

  it("口径原文含真数（条数/阈值/窗口）——屏上直接用它，前端不自己编", async () => {
    const u = (await risk({ horizon: 30 })).unlistedCrossings!;
    expect(u.note).toContain("13");
    expect(u.note).toContain("85");
    expect(u.note).toContain("30");
    // R-UI-4：口径要上屏 ⇒ 不许夹带源码坐标/字段名/排期语汇。
    expect(u.note).not.toMatch(/risk\.ts|\.slice|maxCards|unlistedCrossings|WO-|工单/);
  });
});

// ---------------------------------------------------------------------------
// §2 对照实验（铁律 1.5 判据一）—— 采纳 → 常州掉出榜 ⇒ 必须仍然看得见
// ---------------------------------------------------------------------------

describe("WO-RISKBOARD-TRUNCATION §2 · 对照实验：采纳「常州·瓶颈工序·工艺路线调整」", () => {
  it("修前的病：常州掉出榜；修后：它出现在未上榜名单里，且 crossDay 仍是 1（一次都没被消解）", async () => {
    // ── X：采纳前 ──────────────────────────────────────────────────────────
    const before = await risk({ horizon: 30 });
    const czBefore = before.cards.find((c) => c.base === "常州");
    expect(czBefore, "采纳前常州应当在榜上").toBeDefined();
    expect(czBefore!.peak).toBeCloseTo(98.0, 3);

    // ── X'：把常州的处置方案真采纳掉（eff=9 / T+3，与方案库 `reroute` 同参）──────────
    await adopt("changzhou", "瓶颈工序", "reroute", 9, 3);

    // ── Y：必须按可预言的方式变化 ─────────────────────────────────────────────
    const after = await risk({ horizon: 30 });
    // ① 峰值真的降了（采纳生效），但只降了 0.047 —— 远不足以消解，第 1 天照样越线。
    const czAfter = after.unlistedCrossings!.bases.find((b) => b.base === "常州");
    expect(after.cards.find((c) => c.base === "常州"), "常州应当已掉出前 8").toBeUndefined();
    expect(czAfter, "★ 本单的核心：掉出榜 ≠ 从回包消失。掉出去的必须仍然看得见").toBeDefined();
    expect(czAfter!.peak).toBeCloseTo(97.9531, 3);
    expect(czAfter!.crossDay).toBe(1); // ← 「不在榜上」被读成「没事了」的**反证**就是这一行
    // ② 顶掉它的是成都（97.9935）—— 两者只差 0.047 个张力点。
    const cd = after.cards.find((c) => c.base === "成都");
    expect(cd, "成都补位上榜").toBeDefined();
    expect(cd!.peak).toBeCloseTo(97.9935, 3);
    expect(cd!.peak - czAfter!.peak).toBeLessThan(0.05);
    // ③ 榜的容量没变，越线总数没变 —— 变的只是"谁在榜上"，所以隐藏数仍是 5。
    expect(after.cards.length).toBe(8);
    expect(after.unlistedCrossings!.crossingTotal).toBe(13);
    expect(after.unlistedCrossings!.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// §3/§4 诚实位的**缺省**：没被截断时整块缺席（不是「还有 0 个」）
// ---------------------------------------------------------------------------

describe("WO-RISKBOARD-TRUNCATION §3 · 没截断就别说话", () => {
  it("单基地路（1 张卡·不可能被截断）⇒ **整个键不存在**", async () => {
    const out = await risk({ horizon: 30, base: "常州" });
    expect(out.cards.length).toBe(1);
    expect("unlistedCrossings" in out).toBe(false);
    expect(out.unlistedCrossings).toBeUndefined();
  });

  it("金丝雀：同一个探针在**真被截断**的全网路必须报 true（否则是探针坏了，不是「没有截断」）", async () => {
    const truncated = await risk({ horizon: 30 });
    expect("unlistedCrossings" in truncated).toBe(true);
  });
});

describe("WO-RISKBOARD-TRUNCATION §4 · 计数口径：为什么不能用「越线总数 − 榜上卡数」", () => {
  it("forced 非越线卡实测存在 ⇒ 候选口径 (a) 会算出**负数**，故本实现取集合差", async () => {
    // 显式点名 base+factor ⇒ 该卡 `forced`，**即使不越线也恒出卡**（否则"问了枣庄答了空"是另一种静默）。
    const out = await risk({ horizon: 30, base: "常州", factor: "设备OEE" });
    expect(out.cards.length).toBe(1);
    // `expect(...).toBeDefined()` **不收窄类型**（tsc 照样报 possibly undefined）⇒ 用真正的收窄。
    const only = out.cards[0];
    if (!only) throw new Error("单基地单因素路必须恰好出 1 张卡");
    expect(only.crossDay, "这张卡是 forced 且不越线——(a) 口径的反例就靠它").toBeNull();

    // 候选 (a)：越线总数 − 榜上**卡数**。这里越线总数 = 0，榜上卡数 = 1。
    const crossingTotal = out.cards.filter((c) => c.crossDay !== null).length;
    const candidateA = crossingTotal - out.cards.length;
    expect(candidateA).toBe(-1); // ← 「还有 -1 个基地在越线」

    // 本实现（集合差）：没有被藏起来的越线基地 ⇒ 整块缺席，不是 0、更不是 -1。
    expect("unlistedCrossings" in out).toBe(false);
  });
});
