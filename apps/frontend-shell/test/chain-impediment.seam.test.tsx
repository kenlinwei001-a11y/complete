import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChainImpedimentSchema, compareChainImpediment } from "@platform/contracts";

/**
 * WO-IMPEDIMENT-FE · 全链阻滞点（卡点 / 堵点 / 断点）—— SEAM + 三类分类 + 判定依据 + **dataMode 如实渲染**。
 *
 * ── 头号判据（缺则本单退回）────────────────────────────────────────────────────
 * **`dataMode` 必须如实渲染**：
 *   · `PARTIAL` 当 `LIVE` 渲染 → 红；
 *   · `EMPTY` 渲染成 0 / 空白 → 红；
 *   · `PARTIAL` 的削弱说明**必须逐字符等于引擎 `caveats[].note` 原文**（前端改写一个字即红）。
 * 这三条各有专门用例，且都用「改载荷 → 界面必须跟着变」的手法咬，不是断言一句静态文案。
 *
 * ── SEAM 的咬点（"是数据驱动，不是渲染写死"）─────────────────────────────────
 *  ① **咬链路不咬组件**：一律经 `getRenderer("chain-impediments")` 取到 lazy renderer 再渲染。
 *     直接 `import` 组件只能证明"函数能跑"，证明不了"接线了" —— 本仓 F2/F3/F4 连踩三次
 *     `组件零生产调用方`（实现有、测试有、全绿、零路由渲染得到）。
 *  ② **改引擎返回的 kind / dataMode / 阈值 → 界面必须跟着变**（分组归属、诚实位文案、实测 vs 阈值）。
 *
 * ── 载荷来源与它的诚实边界 ────────────────────────────────────────────────────
 * `fixtures/chain-impediment-baseline.json`：**不是**一次 live capture（本单范围边界禁止改
 * `apps/datacore/**`，无法在引擎里加 dump 钩子）。它逐字段对齐后端两处单一来源：
 * `apps/datacore/test/chain-impediment-seam.test.ts` 的断言（跑在真合成种子上的 CI 门）
 * 与 `apps/datacore/src/synthetic/battery*.ts` 的真发生器。fixture 头部逐条注明了出处 file:line。
 * 「§7 fixture 对齐后端单一来源」这一组把 fixture 的 bindingId 与 caveat 模板**回查引擎源码**，
 * 故本 fixture **无法**靠手写漂移过门。
 */

// ── 网络桩：唯一数据源是引擎求解器，这里把它替换成可编排的返回 ──────────────────
const net = vi.hoisted(() => ({
  payload: null as unknown,
  fail: null as unknown,
  calls: [] as { key: string; args: Record<string, unknown> }[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (net.fail !== null) throw net.fail;
      return { data: net.payload, snapshotVersion: "sv-test" };
    }),
  };
});

import { getRenderer } from "@/views/registry";
import { checkedTree, factHits } from "./factlock";
import {
  buildChainImpedimentModel,
  CHAIN_IMPEDIMENT_SOLVER_KEY,
  ChainImpedimentPayloadSchema,
  DATA_MODE_CLAIM,
  DATA_MODE_LABEL,
  honestyOf,
  stageLabelOf,
  type ChainImpedimentPayload,
} from "@/views/sim/chainImpediment";

// ── 仓根 / 载荷 ───────────────────────────────────────────────────────────────
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let dir = TEST_DIR;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error(`[chain-impediment.seam] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const BASE: ChainImpedimentPayload = ChainImpedimentPayloadSchema.parse(
  JSON.parse(readFileSync(join(TEST_DIR, "fixtures/chain-impediment-baseline.json"), "utf8")),
);

const clone = (): ChainImpedimentPayload => JSON.parse(JSON.stringify(BASE)) as ChainImpedimentPayload;

/** 三类里各挑一条真行（**不写死 id** —— 从载荷里挑）。 */
const anyOf = (kind: "BOTTLENECK" | "CONGESTION" | "BREAK") => BASE.impediments.find((i) => i.kind === kind)!;
const PARTIAL_ONE = BASE.impediments.find((i) => i.dataMode === "PARTIAL")!;
const SYNTH_ONE = BASE.impediments.find((i) => i.dataMode === "SYNTHETIC")!;
const C05_CAVEAT = BASE.caveats.find((c) => c.ruleKey === PARTIAL_ONE.evidence.ruleKey)!;

async function mount(options?: Record<string, unknown>) {
  const View = getRenderer("chain-impediments");
  expect(View, "registry 里没有 chain-impediments —— 组件再绿也没有任何路由渲染得到它").toBeDefined();
  const Lazy = View!;
  const utils = render(
    <Suspense fallback={<div data-testid="ci-suspense" />}>
      <Lazy view={{ key: "chain-impediments", title: "阻滞点", ...(options ? { options } : {}) } as never} />
    </Suspense>,
  );
  await screen.findByTestId("ci-root");
  return utils;
}

beforeEach(() => {
  net.payload = clone();
  net.fail = null;
  net.calls.length = 0;
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM ①：链路可达 —— 经 registry 的字符串键拿到组件并真渲染
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM ① · 渲染器可达（咬链路，不咬组件）", () => {
  it("getRenderer('chain-impediments') 取得到，且真渲染出三类分组与逐条阻滞点", async () => {
    await mount();
    expect(await screen.findByTestId("ci-summary")).toBeInTheDocument();
    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"] as const) {
      expect(screen.getByTestId(`ci-group-${kind}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId(`ci-item-${anyOf("BOTTLENECK").impedimentId}`)).toBeInTheDocument();
  });

  it("数据只来自引擎求解器 chain_impediments（没有第二条取数路径）", async () => {
    await mount();
    await screen.findByTestId("ci-summary");
    expect(net.calls.length).toBeGreaterThan(0);
    expect(net.calls.every((c) => c.key === CHAIN_IMPEDIMENT_SOLVER_KEY)).toBe(true);
  });

  it("view.options 的范围真透传给求解器（未给 = 未限定，前端不编默认范围）", async () => {
    const first = await mount();
    await waitFor(() => expect(net.calls.length).toBeGreaterThan(0));
    expect(net.calls[0]!.args).toEqual({ scope: {} });
    first.unmount();

    net.calls.length = 0;
    await mount({ baseIds: ["changzhou"] });
    await waitFor(() => expect(net.calls.length).toBeGreaterThan(0));
    expect(net.calls[0]!.args).toEqual({ scope: { baseIds: ["changzhou"] } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PRD §5.1 三类可判定分类 —— 每类都得看得见，且分组归属由载荷 kind 驱动
// ═══════════════════════════════════════════════════════════════════════════════
describe("三类阻滞点（PRD §5.1）· 分类与「加产能有没有用」都上屏", () => {
  it("卡点 / 堵点 / 断点三个分组都在，条数与引擎载荷一致", async () => {
    await mount();
    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"] as const) {
      const n = BASE.impediments.filter((i) => i.kind === kind).length;
      expect(screen.getByTestId(`ci-count-${kind}`)).toHaveTextContent(`${n} 条`);
    }
  });

  it("三类互斥的业务判据（加产能有用 / 没用 / 先接上）逐类写在界面上，不是只有一个词", async () => {
    await mount();
    expect(screen.getByTestId("ci-group-BOTTLENECK")).toHaveTextContent("加产能有用");
    expect(screen.getByTestId("ci-group-CONGESTION")).toHaveTextContent("加产能没用");
    expect(screen.getByTestId("ci-group-BREAK")).toHaveTextContent("接不上");
  });

  it("断点亚型（物理断 / 时间断 / 数据断）如实标出 —— 不是笼统一个「断点」", async () => {
    await mount();
    const br = anyOf("BREAK");
    expect(screen.getByTestId(`ci-kind-${br.impedimentId}`)).toHaveTextContent("物理断");
    expect(screen.getByTestId(`ci-item-${br.impedimentId}`)).toHaveAttribute("data-break-subtype", "MATERIAL");
  });

  it("SEAM ② · 改引擎返回的 kind → 该条真的换组（分类是数据驱动，不是渲染写死）", async () => {
    const p = clone();
    const target = p.impediments.find((i) => i.kind === "CONGESTION")!;
    const id = target.impedimentId;
    // 基线：它在堵点组里。
    const first = await mount();
    expect(screen.getByTestId(`ci-group-CONGESTION`)).toContainElement(screen.getByTestId(`ci-item-${id}`));
    expect(screen.getByTestId(`ci-item-${id}`)).toHaveAttribute("data-kind", "CONGESTION");
    first.unmount();

    // 把这一条改成卡点（仍是合法载荷：非 BREAK 不带 breakSubtype）。
    target.kind = "BOTTLENECK";
    p.counts.CONGESTION -= 1;
    p.counts.BOTTLENECK += 1;
    net.payload = p;
    await mount();
    expect(screen.getByTestId(`ci-item-${id}`)).toHaveAttribute("data-kind", "BOTTLENECK");
    expect(screen.getByTestId("ci-group-BOTTLENECK")).toContainElement(screen.getByTestId(`ci-item-${id}`));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 判定依据：触发了哪条规则红线 · 实测值 vs 阈值 · 旋钮在哪
// ═══════════════════════════════════════════════════════════════════════════════
describe("判定依据（R13：每个数都能回答「凭什么」）", () => {
  it("每条阻滞点都写出：规则码 · 实测值 · 阈值 · 单位 · 越线幅度", async () => {
    await mount();
    for (const im of BASE.impediments) {
      const metric = screen.getByTestId(`ci-metric-${im.impedimentId}`);
      expect(metric).toHaveTextContent(String(im.evidence.metricValue));
      expect(metric).toHaveTextContent(String(im.evidence.threshold));
      expect(metric).toHaveTextContent(im.evidence.unit);
      expect(metric).toHaveTextContent("越线");
      expect(screen.getByTestId(`ci-rule-${im.impedimentId}`)).toHaveTextContent(im.evidence.ruleKey!);
    }
  });

  it("位置落到**真对象**上（objectType + objectId + label），不是一句字符串描述", async () => {
    await mount();
    for (const im of BASE.impediments) {
      const locus = screen.getByTestId(`ci-locus-${im.impedimentId}`);
      expect(locus).toHaveTextContent(im.locus.label);
      expect(locus).toHaveTextContent(im.locus.objectId);
      expect(locus).toHaveTextContent(im.locus.objectType);
      // 段名走中文显示名，不把契约枚举裸英文甩给用户。
      expect(locus).toHaveTextContent(`${stageLabelOf(im.stage)} 段`);
      expect(locus.textContent).not.toContain(`${im.stage} 段`);
    }
  });

  it("SEAM ② · 改引擎返回的阈值 → 界面上的「实测 vs 阈值」跟着变（不是渲染写死的数）", async () => {
    const im = BASE.impediments.find((i) => i.evidence.threshold !== 0)!;
    const moved = im.evidence.threshold + 7;
    const p = clone();
    p.impediments.find((x) => x.impedimentId === im.impedimentId)!.evidence.threshold = moved;
    net.payload = p;
    await mount();
    const metric = screen.getByTestId(`ci-metric-${im.impedimentId}`);
    expect(metric).toHaveTextContent(String(moved));
  });

  it("阈值出处表把三种旋钮形态分得清（params / 表达式字面量 / 对象属性）", async () => {
    await mount();
    const table = screen.getByTestId("ci-thresholds");
    expect(table).toHaveTextContent("改 params 即改判定");
    expect(table).toHaveTextContent("改 expression 即改判定");
    expect(table).toHaveTextContent("改数据即改判定");
    // param 型的必须指到具体键名（改哪个旋钮）。
    const paramRow = BASE.thresholds.find((t) => t.source === "param")!;
    expect(screen.getByTestId(`ci-threshold-${paramRow.bindingId}`)).toHaveTextContent(`params.${paramRow.ruleParamKey}`);
  });

  it("排序直接用 contracts 冻结的全序比较器（前端不自排一套）", async () => {
    const model = buildChainImpedimentModel(BASE);
    const flat = model.groups.flatMap((g) => g.items);
    const expected = [...BASE.impediments].sort(compareChainImpediment).map((i) => i.impedimentId);
    // 分组后组内顺序必须仍是全序的子序列。
    for (const g of model.groups) {
      const ids = g.items.map((i) => i.impedimentId);
      expect(ids).toEqual(expected.filter((id) => ids.includes(id)));
    }
    expect(flat.length).toBe(BASE.impediments.length);
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    expect(factHits(fe, /\.sort\(\s*compareChainImpediment/), "前端不再用契约冻结的全序比较器排序 —— 要么自排了一套，要么接线断了").not.toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. **头号判据** · dataMode 如实渲染
// ═══════════════════════════════════════════════════════════════════════════════
describe("dataMode 如实渲染（本单头号判据）", () => {
  it("四态四句 —— 任意两态的「这条结论断言了什么」都不许相同（相同 = 把降级冒充实测）", () => {
    const claims = Object.values(DATA_MODE_CLAIM);
    expect(new Set(claims).size).toBe(claims.length);
    const labels = Object.values(DATA_MODE_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("PARTIAL 的削弱说明 = 引擎 caveats[] 的**原文**（前端改写一个字即红）", async () => {
    await mount();
    const detail = screen.getByTestId(`ci-honesty-detail-${PARTIAL_ONE.impedimentId}`);
    expect(detail.textContent).toBe(C05_CAVEAT.note);
    // 引擎那句话的要害两点必须真在屏上（不是只写「部分数据」了事）。
    expect(detail).toHaveTextContent("只比对快照与规则红线");
    expect(detail).toHaveTextContent("未校验持续天数");
  });

  it("PARTIAL 不许被画成 LIVE：徽标、data-mode、降级标记三处都得区分", async () => {
    await mount();
    const tag = screen.getByTestId(`ci-datamode-${PARTIAL_ONE.impedimentId}`);
    expect(tag).toHaveAttribute("data-mode", "PARTIAL");
    expect(tag).toHaveAttribute("data-degraded", "1");
    expect(tag.textContent).toBe(DATA_MODE_LABEL.PARTIAL);
    expect(tag.textContent).not.toBe(DATA_MODE_LABEL.LIVE);
    expect(screen.getByTestId(`ci-item-${PARTIAL_ONE.impedimentId}`)).toHaveAttribute("data-data-mode", "PARTIAL");
    expect(screen.getByTestId(`ci-honesty-claim-${PARTIAL_ONE.impedimentId}`)).toHaveTextContent("部分");
  });

  it("SEAM ② · 把同一条从 PARTIAL 改成 LIVE → 界面文案与徽标真的翻转（诚实位是数据驱动的）", async () => {
    const id = PARTIAL_ONE.impedimentId;
    const p = clone();
    p.impediments.find((x) => x.impedimentId === id)!.dataMode = "LIVE";
    p.caveats = []; // LIVE 不该再挂 caveat
    net.payload = p;
    await mount();
    const tag = screen.getByTestId(`ci-datamode-${id}`);
    expect(tag).toHaveAttribute("data-mode", "LIVE");
    expect(tag).toHaveAttribute("data-degraded", "0");
    expect(tag.textContent).toBe(DATA_MODE_LABEL.LIVE);
    expect(screen.getByTestId(`ci-honesty-claim-${id}`)).toHaveTextContent("实测判定");
    // LIVE 不再显示削弱说明（否则就是把 caveat 当装饰品挂着）。
    expect(screen.queryByTestId(`ci-honesty-detail-${id}`)).toBeNull();
  });

  it("EMPTY（数据断）明说「算不出来」，**不渲染成 0、不渲染成空白**", async () => {
    // 数据断：契约硬约束 breakSubtype==="DATA" ⟺ dataMode==="EMPTY"。
    const p = clone();
    const dataBreak = {
      impedimentId: "imp_BREAK.DATA.datasource-stale_erp",
      tenantId: "demo",
      scanId: p.scanId,
      kind: "BREAK" as const,
      breakSubtype: "DATA" as const,
      stage: "CAPACITY" as const,
      scope: {},
      locus: { objectType: "DataSourceHealth", objectId: "erp", label: "ERP 销售/财务" },
      severity: 80,
      evidence: {
        solverKey: "chain_impediments",
        ruleKey: "C09",
        ruleParamKey: "staleHours",
        metricValue: 1.8,
        threshold: 1,
        unit: "小时",
      },
      dataMode: "EMPTY" as const,
    };
    // 先证明它是合法契约对象（不是我编的形状）。
    expect(ChainImpedimentSchema.safeParse(dataBreak).success).toBe(true);
    p.impediments = [dataBreak, ...p.impediments];
    p.counts.BREAK += 1;
    p.counts.total += 1;
    net.payload = p;
    await mount();

    const item = screen.getByTestId(`ci-item-${dataBreak.impedimentId}`);
    expect(item).toHaveAttribute("data-data-mode", "EMPTY");
    expect(screen.getByTestId(`ci-kind-${dataBreak.impedimentId}`)).toHaveTextContent("数据断");
    const claim = screen.getByTestId(`ci-honesty-claim-${dataBreak.impedimentId}`);
    expect(claim).toHaveTextContent("算不出来");
    // 关键：它**不是** 0，也**不是**空白。
    expect(claim).toHaveTextContent("不是一个「0」");
    expect(claim.textContent!.trim().length).toBeGreaterThan(10);
    expect(screen.getByTestId(`ci-datamode-${dataBreak.impedimentId}`).textContent).toBe(DATA_MODE_LABEL.EMPTY);
    // 顶栏诚实位统计里 EMPTY 真的记了一条（不是只在卡片上藏着）。
    expect(screen.getByTestId("ci-honesty-counts")).toHaveTextContent(`${DATA_MODE_LABEL.EMPTY} 1`);
  });

  it("SYNTHETIC 明说是合成种子，不冒充实测", async () => {
    await mount();
    const tag = screen.getByTestId(`ci-datamode-${SYNTH_ONE.impedimentId}`);
    expect(tag).toHaveAttribute("data-mode", "SYNTHETIC");
    expect(tag).toHaveAttribute("data-degraded", "1");
    expect(screen.getByTestId(`ci-honesty-claim-${SYNTH_ONE.impedimentId}`)).toHaveTextContent("合成种子");
  });

  it("引擎标了 PARTIAL 却没给 caveat → 如实说「未给出削弱说明」，不替它编一个原因", () => {
    const h = honestyOf({ ...PARTIAL_ONE, dataMode: "PARTIAL" }, null);
    expect(h.detail).toContain("未给出削弱说明");
    expect(h.degraded).toBe(true);
  });

  it("本层自己写的文案里没有 Markdown 记号（纯文本渲染 → `**x**` 在页上就是两个星号）", async () => {
    // 由来：把页面文本 dump 出来看，`**部分**判定` 真的带着字面星号上屏。绿测试看不见这个，肉眼看得见。
    for (const s of [...Object.values(DATA_MODE_CLAIM), ...Object.values(DATA_MODE_LABEL)]) {
      expect(s, `文案里出现 Markdown 星号：${s}`).not.toMatch(/\*\*/);
    }
    const model = buildChainImpedimentModel(BASE);
    for (const n of model.notes) expect(n, `诚实边界文案里出现 Markdown 星号：${n}`).not.toMatch(/\*\*/);
    // ⚠ 引擎 `caveats[].note` 里的 `**未校验持续天数**` 是**引擎原文**，本层原样透传 ——
    //    前端替它改写才是本单禁止的事。故此处刻意不对 caveat 施加同一条规则。
    expect(C05_CAVEAT.note).toMatch(/\*\*/);
  });

  it("顶栏诚实位统计与逐条 dataMode 完全一致（统计口径不许自成一套）", async () => {
    await mount();
    const bar = screen.getByTestId("ci-honesty-counts");
    for (const mode of ["LIVE", "PARTIAL", "SYNTHETIC", "EMPTY"] as const) {
      const n = BASE.impediments.filter((i) => i.dataMode === mode).length;
      expect(bar).toHaveTextContent(`${DATA_MODE_LABEL[mode]} ${n}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 零结果 / 诚实缺席：不许显示假的空状态
// ═══════════════════════════════════════════════════════════════════════════════
describe("零结果与诚实缺席（0 条 ≠ 全链健康）", () => {
  it("引擎返回空数组 → 说「本次未检出」**并同时**说清有几条判据判不出来", async () => {
    const p = clone();
    p.impediments = [];
    p.counts = { total: 0, BOTTLENECK: 0, CONGESTION: 0, BREAK: 0 };
    net.payload = p;
    await mount();

    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"] as const) {
      expect(screen.getByTestId(`ci-empty-${kind}`)).toHaveTextContent("本次未检出");
    }
    const notes = screen.getByTestId("ci-notes");
    expect(notes).toHaveTextContent("未检出任何阻滞点");
    expect(notes).toHaveTextContent("这不等于「全链健康」");
    expect(notes).toHaveTextContent(`${p.unresolved.length} 条判据判不出来`);
  });

  it("某一类空、且该类有判不出来的判据 → 明说「0 条不等于没有」", async () => {
    const p = clone();
    p.impediments = p.impediments.filter((i) => i.kind !== "CONGESTION");
    p.counts.CONGESTION = 0;
    p.counts.total = p.impediments.length;
    net.payload = p;
    await mount();
    const empty = screen.getByTestId("ci-empty-CONGESTION");
    expect(empty).toHaveTextContent("判不出来");
    expect(empty).toHaveTextContent("不等于");
  });

  it("判不出来的判据逐条上屏，且 reason 是引擎原文（含「接了线没数据」的三分法定性）", async () => {
    await mount();
    for (const u of BASE.unresolved) {
      const row = screen.getByTestId(`ci-unresolved-${u.bindingId}`);
      expect(row).toHaveTextContent(u.reason.slice(0, 24));
      expect(row).toHaveTextContent("UNKNOWN");
    }
    expect(screen.getByTestId("ci-unresolved")).toHaveTextContent("接了线没数据");
  });

  it("时间断（LEADTIME）今天规则库无承载 → 作为诚实缺席显式列出，不是悄悄不提", async () => {
    await mount();
    const row = screen.getByTestId("ci-unresolved-UNBOUND.BREAK.LEADTIME");
    expect(row).toHaveTextContent("规则库");
    expect(row).toHaveTextContent("拒绝自造提前期阈值");
    // 且确实没有任何一条 LEADTIME 阻滞点被"补"出来。
    expect(document.querySelectorAll('[data-break-subtype="LEADTIME"]')).toHaveLength(0);
  });

  it("引擎 counts 与逐条明细对不上 → 显式报出来，不静默以明细为准", async () => {
    const p = clone();
    p.counts.total = p.impediments.length + 3;
    net.payload = p;
    await mount();
    expect(screen.getByTestId("ci-count-mismatch")).toHaveTextContent("自相矛盾");
  });

  it("范围未限定 → 明说「全域」，不显示成空白（空白会被读成「已限定为空」）", async () => {
    await mount();
    expect(screen.getByTestId("ci-scope")).toHaveTextContent("未限定（全域）");
    expect(screen.getByTestId("ci-notes")).toHaveTextContent("范围未限定");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 引擎接不通 / 载荷形状不合契约 —— 不拿示例数据顶上
// ═══════════════════════════════════════════════════════════════════════════════
describe("取不到数时的诚实（genuine-sim 纪律）", () => {
  it("引擎报错 → 显示错误码 + 后端 message，且屏上没有任何阻滞点卡片", async () => {
    net.fail = { error: { code: "FEATURE_NOT_FOUND", message: "not found", requestId: "req-9" } };
    await mount();
    const box = await screen.findByTestId("ci-engine-error");
    expect(box).toHaveTextContent("FEATURE_NOT_FOUND");
    expect(box).toHaveTextContent("req-9");
    expect(box).toHaveTextContent("不拿示例数据顶上");
    expect(screen.queryByTestId("ci-summary")).toBeNull();
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
  });

  it("载荷形状不合契约（数据断却自称 LIVE）→ 报错，不猜、不补字段", async () => {
    const p = clone() as unknown as { impediments: Record<string, unknown>[] };
    p.impediments[0] = {
      ...p.impediments[0],
      kind: "BREAK",
      breakSubtype: "DATA",
      dataMode: "LIVE", // 契约 superRefine：数据断 ⟺ EMPTY
    };
    net.payload = p;
    await mount();
    expect(await screen.findByTestId("ci-engine-error")).toBeInTheDocument();
    expect(screen.queryByTestId("ci-summary")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. fixture / mock 对齐后端单一来源 —— 手写漂移过不了门
// ═══════════════════════════════════════════════════════════════════════════════
describe("fixture 与 mock 对齐后端单一来源（不许悄悄漂移）", () => {
  // 引擎住在哪个文件不是事实（WO-C 修法）—— 用 caveat 模板片段全树定位宿主（搬家不红；模板没了才红）。
  const engineHomes = factHits(checkedTree("apps/datacore/src", "chain_impediments", 80), "含 SUSTAIN（持续判定），而 SolverContext 无时序访问");
  if (engineHomes.length !== 1) throw new Error(`[chain-impediment.seam] 引擎 caveat 模板全树命中 ${engineHomes.length} 处 —— 定位探针失效，先修定位器`);
  const engineSrc = readRepo(engineHomes[0]!);
  const mockSrc = readRepo("apps/frontend-shell/src/mocks/simSolvers.ts");

  it("fixture 里每个 bindingId 都在引擎的判据声明表里真实存在", () => {
    const ids = new Set<string>([
      ...BASE.thresholds.map((t) => t.bindingId),
      ...BASE.unresolved.filter((u) => !u.bindingId.startsWith("UNBOUND.")).map((u) => u.bindingId),
      ...BASE.caveats.map((c) => c.bindingId),
    ]);
    expect(ids.size).toBeGreaterThan(3);
    const missing = [...ids].filter((id) => !engineSrc.includes(`bindingId: "${id}"`));
    expect(missing, `这些 bindingId 引擎里没有（fixture 已与后端漂移）：${missing.join(", ")}`).toEqual([]);
  });

  it("fixture 的 PARTIAL caveat 文案与引擎的 caveat 模板同源（模板改了 fixture 必须跟）", () => {
    // 引擎模板：`规则 ${b.ruleKey} 含 SUSTAIN（持续判定），而 SolverContext 无时序访问 —— `
    //           `本次只比对快照与规则红线 ${th.value}${b.unit}，**未校验持续天数**；结论 dataMode 标 PARTIAL`
    for (const frag of [
      "含 SUSTAIN（持续判定），而 SolverContext 无时序访问",
      "本次只比对快照与规则红线",
      "**未校验持续天数**；结论 dataMode 标 PARTIAL",
    ]) {
      expect(engineSrc, `引擎模板已变，fixture/mock 的 caveat 文案需同步：${frag}`).toContain(frag);
      expect(C05_CAVEAT.note).toContain(frag);
    }
  });

  it("fixture 的 UNBOUND.BREAK.LEADTIME 原因与引擎登记表逐字同源", () => {
    const row = BASE.unresolved.find((u) => u.bindingId === "UNBOUND.BREAK.LEADTIME")!;
    // ⚠ 2026-08-14：`C01–C33` → `C01–C34`（引擎 `apps/datacore/src/solvers/chain-impediment.ts:237`
    //   早已改口径，fixture/mock 没跟）。这条门本来就是为逮这种漂移设的，之所以三方都没红，
    //   是本文件顶部的定位器（`factHits(checkedTree("apps/datacore/src", …))`）被
    //   `test/factlock.ts stripComments` 的缺陷弄瞎了 —— 引擎文件里一条**行注释含 `/*`**
    //   开出假块注释吞掉 71 行、连探针一起吞 ⇒ 全树命中 0 处 ⇒ 整个 describe 收集期就抛，
    //   **本文件 0 个用例被执行**。门在、判据也对，就是从没跑到判据那一步。
    for (const frag of ["在规则库 C01–C34 中无任何承载阈值的规则（逐条核过）", "本引擎拒绝自造提前期阈值"]) {
      expect(engineSrc).toContain(frag);
      expect(row.reason).toContain(frag);
    }
  });

  it("每条阻滞点的 severity 与引擎公式复算一致（round(超阈幅度 / 分母 × 100)）", () => {
    // 分母 = |阈值|；阈值为 0 时引擎取 binding.magnitudePath（MaterialBalance.netDemandTon）。
    const magnitude: Record<string, number> = { "mbal-1": 23231, "mbal-3": 9975, "mbal-6": 4425 };
    for (const im of BASE.impediments) {
      const breach = Math.abs(im.evidence.metricValue - im.evidence.threshold);
      const denom = Math.abs(im.evidence.threshold) > 0 ? Math.abs(im.evidence.threshold) : magnitude[im.locus.objectId];
      expect(denom, `fixture 缺 ${im.locus.objectId} 的规模基准`).toBeGreaterThan(0);
      expect(im.severity, `${im.impedimentId} 的 severity 与引擎公式对不上`).toBe(
        Math.max(0, Math.min(100, Math.round((breach / denom!) * 100))),
      );
    }
    expect(factHits(checkedTree("apps/datacore/src", "chain_impediments", 80), /Math\.round\(\s*\(\s*breach\s*\/\s*denom\s*\)\s*\*\s*100\s*\)/), "引擎里找不到 severity 公式 round(breach/denom×100) ⇒ 口径改了，上面的复算对拍一起重审").not.toEqual([]);
  });

  it("mock 与 fixture 同口径：都没有 LIVE、C02/C09 都是 0 条、R-ARG-FIDELITY 都拒绝两维", async () => {
    const { mockChainImpediments } = await import("@/mocks/simSolvers");
    const out = ChainImpedimentPayloadSchema.parse(mockChainImpediments({ scope: {} }));
    expect(out.impediments.some((i) => i.dataMode === "LIVE")).toBe(false);
    expect(BASE.impediments.some((i) => i.dataMode === "LIVE")).toBe(false);
    expect(out.impediments.some((i) => i.evidence.ruleKey === "C02")).toBe(false);
    expect(out.impediments.some((i) => i.evidence.ruleKey === "C09")).toBe(false);
    expect(out.counts.total).toBe(BASE.counts.total);
    // 真后端对这两维显式 400（service.ts:3124），mock 同口径。
    expect(mockChainImpediments({ scope: { businessTypes: ["storage"] } })).toHaveProperty("__err");
    expect(mockSrc).toContain("R-ARG-FIDELITY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 与 F1 线路图不重复：本页不重画线路图、不改 F1 组件
// ═══════════════════════════════════════════════════════════════════════════════
describe("与 F1 全链线路图的边界（不重复劳动）", () => {
  /** 只看**代码**，注释里当然会提到 F1（分工说明本来就该写清楚）—— 咬的是有没有真依赖它。 */
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const viewSrc = stripComments(readRepo("apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx"));
  const deriveSrc = stripComments(readRepo("apps/frontend-shell/src/views/sim/chainImpediment.ts"));

  it("本页不引用 F1 的线路图组件 / 派生层（两个求解器、两个问题，不共用一套渲染）", () => {
    for (const src of [viewSrc, deriveSrc]) {
      expect(src).not.toContain("ChainLineMapView");
      expect(src).not.toContain("chainLineMap");
      expect(src).not.toContain("chain_loss_attribution");
      expect(src).not.toMatch(/from\s+["'][^"']*chainLineMap/);
    }
  });

  it("F1 的既有资产原样保留：chain-line-map 仍然可达且仍只调它自己的求解器", async () => {
    expect(getRenderer("chain-line-map")).toBeDefined();
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    const f1Homes = factHits(fe, /runSolver\(\s*CHAIN_LOSS_SOLVER_KEY/);
    expect(f1Homes, "F1 线路图不再调 chain_loss_attribution —— 它的数据源被摘了").not.toEqual([]);
    for (const home of f1Homes) {
      expect(readRepo(home), `${home} 里塞进了 chain_impediments —— 本单不许往 F1 取数路径里塞第二个求解器（会打破它的「只有一个数据源」门）`).not.toContain("chain_impediments");
    }
  });

  it("本页把「与线路图的分工」写在界面上，用户不会以为是同一张图的两种画法", async () => {
    await mount();
    expect(screen.getByTestId("ci-root")).toHaveTextContent("不重复展示");
  });

  it("两张 STAGE_LABEL 不许漂移（本页独立一份是为了不把 F1 派生层拖进本页 chunk）", async () => {
    const mine = (await import("@/views/sim/chainImpediment")).STAGE_LABEL;
    const f1 = (await import("@/views/sim/chainLineMap")).STAGE_LABEL;
    expect(mine).toEqual(f1);
    // 且两张都必须覆盖契约枚举的全部取值（少一段就会在界面上回显裸英文）。
    const { CHAIN_STAGES } = await import("@platform/contracts");
    expect(Object.keys(mine).sort()).toEqual([...CHAIN_STAGES].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. 三色系：dark / light / warm 全过 · 零硬编码颜色
// ═══════════════════════════════════════════════════════════════════════════════
describe("三色系 · dark / light / warm 全过", () => {
  const css = readRepo("apps/frontend-shell/src/views/sim/ChainImpedimentView.module.css");
  const tsx = readRepo("apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx");
  const ts = readRepo("apps/frontend-shell/src/views/sim/chainImpediment.ts");
  const tokens = readRepo("apps/frontend-shell/src/styles/tokens.css");
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("样式与组件里零硬编码颜色（hex / rgb / hsl）", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "样式里出现硬编码 hex").toEqual([]);
    expect(css.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], "样式里出现硬编码 rgb/hsl").toEqual([]);
    for (const [name, s] of [
      ["tsx", tsx],
      ["ts", ts],
    ] as const) {
      expect(s.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${name} 里出现硬编码 hex`).toEqual([]);
      expect(s.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${name} 里出现硬编码 rgb/hsl`).toEqual([]);
    }
  });

  it("用到的每个 CSS 变量都定义在 tokens.css 的 :root（否则某套皮下取不到值）", () => {
    const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const used = new Set([...cssNoComment.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    const missing = [...used].filter((t) => !rootTokens.has(t));
    expect(missing, `这些 token 不在 :root（只在某个 data-theme 分支里定义 → 其它主题下失效）：${missing.join(", ")}`).toEqual([]);
  });

  it("三套主题下诚实位徽标都渲染，且 data-mode 逐档不变（配色换皮，诚实位是数据）", async () => {
    for (const theme of [null, "light", "warm"] as const) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = await mount();
      expect(screen.getByTestId(`ci-datamode-${PARTIAL_ONE.impedimentId}`)).toHaveAttribute("data-mode", "PARTIAL");
      expect(screen.getByTestId(`ci-datamode-${SYNTH_ONE.impedimentId}`)).toHaveAttribute("data-mode", "SYNTHETIC");
      unmount();
    }
  });
});
