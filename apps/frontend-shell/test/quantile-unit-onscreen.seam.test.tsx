import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
// 「事实还在不在」一律走仓内既有的**剥注释后判命中**机制（自带金丝雀），不在本文件另做一套。
import { commentOnlyCanary, factHits, srcCode } from "./factlock";

/**
 * WO-P50-REMAINING-3 · **分位量纲屏上可分辨**接缝门（本体 §8 `G-QUANTILE-NAME-COLLISION`）。
 *
 * ── 这道门拦的是什么（真发生过，不是假想）───────────────────────────────────────
 * 2026-08-14 仓主实测撞上：`p50` 一个名字在本仓背 **6 个量纲**，屏上只写「p50」或「万套」，
 * 用户分不出「这行是需求的万套/年、产能的万套/窗口，还是 S&OP 的万套/月」。
 * 改名（`check-quantile-field-naming`）只解决**代码可读性**；仓主撞上的是**屏上**那一半。
 * 故本文件咬的是**渲染结果**，不是字段名 —— 字段名那半由门脚本咬。
 *
 * ── 咬四件事，缺一件这道门就只是「排练」────────────────────────────────────────
 *  ① **判据自身没瞎**（铁律 0.6 金丝雀）：直接 import 门脚本导出的 `analyze()`，
 *     喂已知必中的坏样例（同名两量纲 / 裸分位名）必须被咬中。
 *     金丝雀不中 ⇒ 报「工具坏了」，**不许**把本次结果读作「契约干净」。
 *  ② **契约里没有裸分位名**（旧名不回潮）：同一份 `analyze()` 扫真契约目录。
 *     这一条与门脚本共用实现 —— 在测试里另抄一份正则 = 装饰品（改主正则时它拿旧的去测、照样绿）。
 *  ③ **屏上真出现单位**：S&OP 平衡台三处（KPI 条 / ② 三线对照表头 / ⑤ 版本演进表头）
 *     与订单全链交期判，都必须把**分母**印出来。
 *  ④ **同屏两个分母必须同时可见且不同**：S&OP 页上方 KPI 是 `万套/月`（26.58 量级）、
 *     下方版本演进表是 `万套/年`（375 量级）——**相差 12 倍、同屏并列**。
 *     只断言「有单位」不够：两处都写「万套」也算有单位，那正是仓主分不出的那个状态。
 *
 * ⚠ 这不是「测某个函数好不好用」，是测**那条链**：契约命名 → 后端下发 `unit` →
 *   前端表头 → 屏上文字。任一环退回旧样，本文件当场红。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const GATE = join(REPO_ROOT, "scripts/check-quantile-field-naming.mjs");
const CONTRACT_DIR = join(REPO_ROOT, "packages/contracts/src");

type QField = { name: string; file: string; line: number; unit: string | null; bare: boolean };
type QReport = {
  fields: QField[];
  collisions: { name: string; units: { unit: string }[] }[];
  bare: QField[];
  undeclared: QField[];
  ok: boolean;
};

/** 判据从**门脚本本体**取 —— 测试里不另写一份（两处写判据迟早对不上）。 */
async function loadAnalyze(): Promise<(sources: { file: string; text: string }[]) => QReport> {
  const mod = (await import(/* @vite-ignore */ GATE)) as { analyze: (s: { file: string; text: string }[]) => QReport };
  return mod.analyze;
}

/** 递归收契约源文件（与门脚本 `collectSources` 同口径：只认 `.ts`）。 */
async function contractSources(): Promise<{ file: string; text: string }[]> {
  const { readdirSync } = await import("node:fs");
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ file: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(CONTRACT_DIR);
  return out;
}

describe("§1 · 判据自身没瞎（金丝雀先说话）", () => {
  it("同名两量纲被咬中 · 裸分位名被咬中 · 带口径的名字判干净", async () => {
    const analyze = await loadAnalyze();

    // 必咬-1：同一个 `p50` 背两个量纲（COLLISION），且两处都是裸名（BARE）。
    const collide = analyze([
      { file: "canary-a.ts", text: `export const A = z.object({\n  /** @unit 万套/年 */\n  p50: z.number(),\n});\n` },
      { file: "canary-b.ts", text: `export const B = z.object({\n  /** @unit 万套/月 */\n  p50: z.number(),\n});\n` },
    ]);
    expect(collide.collisions).toHaveLength(1);
    expect(collide.bare).toHaveLength(2);

    // 必咬-2：为向后兼容留的**别名**（与新名同量纲 ⇒ COLLISION 抓不到，只有 BARE 抓得到）。
    // 「零兼容别名」这条纪律的机器化落点就在这里。
    const alias = analyze([
      {
        file: "canary-alias.ts",
        text:
          `export const C = z.object({\n` +
          `  /** @unit 万套/月 */\n  rollingWanPerMonthP90: z.number(),\n` +
          `  /** @unit 万套/月 */\n  p90: z.number(),\n});\n`,
      },
    ]);
    expect(alias.collisions).toHaveLength(0); // 同量纲 ⇒ 判据①看不见
    expect(alias.bare.map((f) => f.name)).toEqual(["p90"]); // 判据②看得见
    expect(alias.ok).toBe(false);

    // 必不咬：名字自带口径 ⇒ 干净。
    const clean = analyze([
      {
        file: "canary-clean.ts",
        text:
          `export const D = z.object({\n` +
          `  /** @unit 万套/年 */\n  demandWanPerYearP50: z.number(),\n` +
          `  /** @unit 万套/月 */\n  rollingWanPerMonthP90: z.number(),\n` +
          `  /** @unit 套/周 */\n  packsPerWeekP50: z.number(),\n});\n`,
      },
    ]);
    expect(clean.ok).toBe(true);
    expect(clean.fields).toHaveLength(3);
  });
});

describe("§2 · 契约里零裸分位名（旧名不回潮）", () => {
  it("`packages/contracts/src` 全扫：无 COLLISION · 无 BARE · 无 UNDECLARED", async () => {
    const analyze = await loadAnalyze();
    const r = analyze(await contractSources());

    // 先自证扫描面非空 —— 「我没找到」和「它不存在」是两个命题。
    expect(r.fields.length).toBeGreaterThanOrEqual(10);

    const say = (fs: QField[]) => fs.map((f) => `${f.name}@${f.file}:${f.line}`).join(" , ");
    expect(r.collisions.map((c) => c.name), `同名多量纲：${JSON.stringify(r.collisions)}`).toEqual([]);
    expect(r.bare.map((f) => f.name), `裸分位名（含兼容别名）：${say(r.bare)}`).toEqual([]);
    expect(r.undeclared.map((f) => f.name), `缺 @unit：${say(r.undeclared)}`).toEqual([]);
  });

  it("本单三个量纲的新名都在册，且量纲各不相同（①年 · ⑤月 · ⑥周）", async () => {
    const analyze = await loadAnalyze();
    const r = analyze(await contractSources());
    const unitOf = (n: string) => r.fields.find((f) => f.name === n)?.unit ?? null;

    expect(unitOf("rollingWanPerMonthP90")).toBe("万套/月"); // ⑤ S&OP 三线对照
    expect(unitOf("packsPerWeekP50")).toBe("套/周"); // ⑥ 交期判
    expect(unitOf("packsPerWeekP90")).toBe("套/周");
    // ② ③ ④（上一单已落地）不许被本单碰坏
    expect(unitOf("capWanP50")).toBe("万套/窗口");
    expect(unitOf("cellsPerDayP50")).toBe("电芯/日");
    expect(unitOf("packsP50At30")).toBe("套");

    // 「万套」系三兄弟必须**分母互不相同** —— 只写「万套」正是让用户分不出的那半个信息。
    const wanUnits = new Set([unitOf("capWanP50"), unitOf("rollingWanPerMonthP90"), "万套/年"]);
    expect(wanUnits.size).toBe(3);
  });

  it("① DemandSegment 的年口径在本体属性上写死（datacore 半·前端表头不是唯一真相源）", () => {
    const battery = readFileSync(join(REPO_ROOT, "apps/datacore/src/synthetic/battery.ts"), "utf8");
    expect(battery).toContain(`{ propKey: "demandWanPerYearP50"`);
    expect(battery).toMatch(/demandWanPerYearP50[^\n]*unit: "万套\/年"/);
    expect(battery).toMatch(/demandWanPerYearP90[^\n]*unit: "万套\/年"/);
    // ⑤ 同屏的版本演进对比是**年**口径，也必须写死（它与上方 KPI 条差 12 倍）
    expect(battery).toMatch(/propKey: "demand"[^\n]*unit: "万套\/年"/);
    expect(battery).toMatch(/propKey: "supply"[^\n]*unit: "万套\/年"/);
    // 旧裸名不回潮（`props.p50` 形态的属性定义）
    expect(battery).not.toMatch(/propKey: "p(50|90)"/);
  });

  /**
   * 门 `check-quantile-field-naming` 只认 **zod 字段声明**，看不见 React prop ——
   * 而 `DynamicLeverPanel` 的「调整前」参照量恰恰是同一个病长在 prop 上：
   * 原名 `baseP50` 被两个调用方分别喂 **万套/窗口**（ProjectSimView `capWanP50`）与
   * **张力 0–100**（RiskBoardView `card.peak`）。名字自称 P50 而其中一个根本不是分位数。
   * 已改量纲中立的 `beforeValue`（口径由 `beforeLabel` 上屏说明）——本例咬它不回潮。
   */
  it("React prop 侧同样零分位裸名：DynamicLeverPanel 的「调整前」参照量是量纲中立名", () => {
    // 判据落在**剥掉注释后的可执行代码**上（本文件的说明注释里就写着 `baseP50` 三个字；
    // 拿原文判会把「记账」误读成「回潮」——那正是 factlock 那道机制当初要治的病）。
    const code = srcCode("apps/frontend-shell/src");
    // 金丝雀：只在注释里提到探针的合成样例必须**零命中**，否则 stripComments 坏了，
    // 本次「已不存在」的结论一律作废（不许把工具坏了读成代码干净）。
    expect(factHits(commentOnlyCanary("baseP50"), "baseP50")).toEqual([]);
    expect(code.length).toBeGreaterThan(100); // 扫描面非空自证

    expect(factHits(code, /\bbaseP50\b/)).toEqual([]);
    // 两个调用方各传各的量纲 ⇒ 都走中立名；RiskBoardView 传的不是分位数，必须自带 beforeLabel 覆盖默认文案
    const at = (rel: string) => code.find(([f]) => f.endsWith(rel))?.[1] ?? "";
    expect(at("views/RiskBoardView.tsx")).toContain("beforeValue={card.peak}");
    expect(at("views/RiskBoardView.tsx")).toContain("beforeLabel=");
    expect(at("views/sim/ProjectSimView.tsx")).toContain("beforeValue={out.capWanP50}");
    expect(at("views/sim/DynamicLeverPanel.tsx")).toContain("beforeValue");
  });
});

describe("§3 · 屏上真出现单位（渲染结果，不是字段名）", () => {
  it("S&OP：KPI 条 + ② 三线对照表头 = 万套/月；⑤ 版本演进表头 = 万套/年（同屏两个分母，可分辨）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");
    await user.click(await screen.findByTestId("sop-create"));

    // KPI 条：需求/可供给/缺口三卡都必须带**分母**
    const kpiBar = await screen.findByTestId("sop-kpi-bar");
    for (const key of ["demand", "supply", "gap"]) {
      const card = within(kpiBar).getByTestId(`sop-kpi-${key}`);
      expect(card.textContent, `sop-kpi-${key} 少了分母：${card.textContent}`).toContain("万套/月");
    }

    // ① → ② 走到三线对照表
    await user.click(screen.getByTestId("sop-run-1"));
    await screen.findByTestId("sop-s1-table");
    await user.click(screen.getByTestId("sop-step-chip-2"));
    await user.click(await screen.findByTestId("sop-run-2"));
    const s2 = await screen.findByTestId("sop-s2-table");
    const head = s2.querySelector("thead")!;
    // 四列同分母（目标 / 滚动 P50 / 滚动 P90 / 上月实际），量纲取后端 `steps.s2.unit` 单源下发值
    expect(head.textContent).toContain("滚动 P90(万套/月)");
    expect(head.textContent).toContain("滚动 P50(万套/月)");
    // 旧样：表头只写「滚动 P90」不带分母 ⇒ 回潮即红
    expect(head.textContent).not.toMatch(/滚动 P90(?!\()/);
    // P90 是**下**分位：同分母才谈得上这条（跨分母比就是本轮修掉的那个 bug）
    await waitFor(() => expect(screen.getByTestId("sop-p90-total")).toBeInTheDocument());

    // ⑤ 版本演进对比：年口径，且与上方 KPI 的月口径**同屏可分辨**
    await user.click(screen.getByTestId("sop-step-chip-5"));
    const vc = await screen.findByTestId("sop-version-compare-table");
    const vcHead = vc.querySelector("thead")!;
    expect(vcHead.textContent).toContain("需求(万套/年)");
    expect(vcHead.textContent).toContain("供给(万套/年)");
    expect(vcHead.textContent).toContain("缺口(万套/年)");
    // 关键判据：两个分母**同时在屏上**且**不相同** —— 只断言「有单位」不够
    expect(kpiBar.textContent).toContain("万套/月");
    expect(vcHead.textContent).not.toContain("万套/月");
  });

  it("订单全链 ①交期判：屏上写清「套/周」，且不再把整单量说成「本周需求」", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("ofc-panel");
    const judges = await within(panel).findByTestId("ofc-judges");

    expect(judges.textContent).toContain("套/周");
    expect(judges.textContent).toContain("周供给 P90");
    // 折算假设不许伪装成事实：右边是 `Order.qty`（整单量），不是订单自带的周需求
    expect(judges.textContent).toContain("本单需求");
    expect(judges.textContent).not.toContain("本周需求");
    // 假设本身必须有披露入口（第一层留可见记号，口径进浮层）
    expect(within(judges).getByTestId("info-ofc-cap-basis")).toBeTruthy();

    // KPI 条同样写清分母（`deliveryPacksPerWeekP90`）
    expect(panel.textContent).toContain("交期判(周供给 套/周)");
  });
});
