import { describe, expect, it, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ChainImpediment, SolutionCandidate } from "@platform/contracts";
import { solutionCandidateId } from "@platform/contracts";
import { mockChainImpediments } from "@/mocks/simSolvers";
import {
  CANDIDATE_ABSENCE_LABEL,
  CANDIDATE_EFFECT_LABEL,
  CANDIDATE_JOIN_LABEL,
  CANDIDATE_RUNG_LABEL,
  formatLeverValue,
} from "@/views/sim/chainImpediment";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-SANDBOX-CANDIDATES-FE · **阻滞点 → 候选对策**上屏 SEAM（推演沙盘主线的最后一跳）。
 *
 * ══ 这个文件咬的是什么 ═══════════════════════════════════════════════════════════
 * 后端 S3 枚举器（`impediment-options.ts`）与契约 §7 在本单之前**已经落地、已经接线、
 * 且有 7 例接缝门咬着**（`apps/datacore/test/impediment-options-seam.test.ts`）——
 * 而前端**零消费方**（实测 `grep 'SolutionCandidate|remedyKey|candidateStats'
 * apps/frontend-shell/src` = 0，金丝雀 `ChainImpediment` 同条件命中 ⇒ 工具是好的）。
 * 形态 = **前端这一端没接线**：后端算好了没人取。本文件就是那根线的门。
 *
 * ══ 头号纪律：走真实路由，不许只渲染面板组件 ═══════════════════════════════════
 * 每一条断言都从 URL 出发（`renderApp("/v/sim-sandbox")`）——
 * 真进 `App.tsx` 的 `SimSandboxGuard` → entitlement 闸 → `SandboxView` → `SandboxConsole`
 * → MSW → `mockChainImpediments`。
 * 只 `render(<SandboxConsole/>)` 就是本仓记过的**假绿第 9 形态**
 * （`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且绿，零生产调用方 ——
 * 测试咬的是**组件**不是**链路**）。那种写法证明不了"有任何东西能让你走到这一页"。
 *
 * ══ 「数字逐字节等于响应字段」怎么做到的 ═══════════════════════════════════════
 * 期望值**不写字面量**，一律从 `mockChainImpediments({})` 现取 ——
 * 它就是 MSW handler 里跑的那一个函数（`handlers.ts:2915` 逐字可查），且是纯函数（R6 确定性），
 * 故它的返回值**就是这次响应**。屏上格式化后的值旁边同时挂了原值
 * （`data-from` / `data-to` / `data-baseline` / `data-value`），断言拿它与响应字段做 `String()` 相等 ——
 * 格式化层一旦出错当场红，不会被"看起来差不多"盖过去。
 *
 * ══ 变异反证（每条都真红过一次，原文见交付说明）═══════════════════════════════
 *  ① 把 `CandidateBlock` 里 `im.candidates.map(...)` 那段摘掉（只留缺席分支）→ 正向用例 A/B/C 红。
 *  ② 把 `CandidateAbsenceBlock` 的 `return null` 提前（NONE 渲染成空白）→ 反向用例 D/E 红。
 *  ③ 把 `formatLeverValue` 的 ratio 分支改成无条件 `v*100` → 用例 B 红（97.2 会变成 9720%）。
 *  ④ 把三态缺席合并成一句「暂无方案」→ 用例 E/F 红。
 * ⚠ 变异必须**真的**变异：本仓栽过 `cadenceGates`→`cadenceGatesXX` 而 `toContain("cadenceGates")`
 *   照样通过（子串还在）＝ 等于没变异。故改名一律换**不含原子串**的名字，改行为一律语义反转。
 */

/** 本次响应（= MSW 真正会返回的那一份，纯函数 · 同输入同输出）。 */
function payload(): {
  impediments: ChainImpediment[];
  candidateStats: { impedimentId: string; anchors: number; probes: number; effective: number; emitted: number; gaps: string[] }[];
} {
  return mockChainImpediments({}) as unknown as ReturnType<typeof payload>;
}

/** 第一个**真有候选**的阻滞点（连同它的第一条候选）。 */
function firstWithCandidates(): { im: ChainImpediment; c: SolutionCandidate } {
  const im = payload().impediments.find((i) => (i.candidates ?? []).length > 0);
  if (!im) throw new Error("金丝雀不中：本次响应里没有任何带候选的阻滞点 —— 工具/数据源坏了，不是页面坏了");
  return { im, c: im.candidates![0]! };
}

/** 第一个**诚实缺席**（`candidates: []` + kind）的阻滞点。 */
function firstAbsent(): ChainImpediment {
  const im = payload().impediments.find((i) => (i.candidates ?? []).length === 0 && i.candidates !== undefined);
  if (!im) throw new Error("金丝雀不中：本次响应里没有任何空候选的阻滞点");
  return im;
}

/** 真路由进沙盘，等到候选区真的挂出来。 */
async function openSandbox(): Promise<void> {
  renderApp("/v/sim-sandbox");
  // `sc-imp-jump` 只在真 SandboxConsole 里出现；落 404 / 加载态 / 「暂不支持」兜底卡时一个都不会有。
  await screen.findByTestId("sc-imp-jump", {}, { timeout: 10_000 });
}

describe("WO-SANDBOX-CANDIDATES-FE · 阻滞点 → 候选对策上屏（真路由 · 真响应 · 逐字节）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 金丝雀 —— 先自证数据源与工具是好的（铁律 0.6：报否定结论前必须先跑已知必中的样例）
  // ══════════════════════════════════════════════════════════════════════════

  it("金丝雀 · 本次响应里真的**同时**有「带候选的点」与「诚实缺席的点」（否则下面全是空跑）", () => {
    const p = payload();
    const withC = p.impediments.filter((i) => (i.candidates ?? []).length > 0);
    const absent = p.impediments.filter((i) => i.candidates !== undefined && i.candidates.length === 0);
    expect(withC.length, "响应里一个带候选的阻滞点都没有 ⇒ 数据源坏了，不是页面坏了").toBeGreaterThan(0);
    expect(absent.length, "响应里一个诚实缺席的阻滞点都没有 ⇒ 反向用例会恒真").toBeGreaterThan(0);
    // 每个阻滞点都该有一行逐点账（引擎 impediment-options.ts:800/803 对每个点都 push）
    expect(p.candidateStats.length).toBe(p.impediments.length);
    // 空候选 ⟺ 必带机器可读定性（契约 superRefine；只给散文 = 让消费方读散文猜）
    for (const im of absent) {
      expect(im.noCandidateKind, `${im.impedimentId} 空候选却没有 noCandidateKind`).toBeDefined();
      expect(im.noCandidateReason, `${im.impedimentId} 空候选却没有 noCandidateReason`).toBeDefined();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 正向：候选真上屏，三样齐备，数字逐字节
  // ══════════════════════════════════════════════════════════════════════════

  it("A · 真路由 /v/sim-sandbox → 候选对策真出现在屏上（不是只渲染面板组件）", async () => {
    const { im, c } = firstWithCandidates();
    await openSandbox();

    // 候选区挂在它宿主阻滞点下面
    const block = await screen.findByTestId(`sc-cand-block-${im.impedimentId}`);
    expect(block.getAttribute("data-count")).toBe(String(im.candidates!.length));

    // 每一条候选都真的在屏上（不是只画了第一条）
    for (const cand of im.candidates!) {
      expect(
        screen.getByTestId(`sc-cand-${cand.candidateId}`),
        `候选 ${cand.candidateId} 没上屏`,
      ).toBeInTheDocument();
    }

    // 候选 id 能从**公开字段**反算出同一个（单源构造 · 引擎与前端共用 contracts 那一份）
    expect(
      solutionCandidateId({
        impedimentId: c.impedimentId,
        objectType: c.lever.objectType,
        leverObjectId: c.lever.objectId,
        prop: c.lever.prop,
        rungKind: c.rungKind,
        toValue: c.toValue,
      }),
      "拿候选公开字段重建的 id 与回包对不上 ⇒ id 拼法漂了（schema 只校验 min(1)，没人会红）",
    ).toBe(c.candidateId);
  });

  it("B · 三样齐备：拨哪个对象 / 从多少拨到多少 / 效果 —— 且数字**逐字节**等于响应字段", async () => {
    const { im, c } = firstWithCandidates();
    await openSandbox();
    const card = await screen.findByTestId(`sc-cand-${c.candidateId}`);

    // ── ① 拨哪个对象（业务名，不是内部 id）────────────────────────────────────
    const lever = within(card).getByTestId(`sc-cand-lever-${c.candidateId}`);
    expect(lever.textContent, "看不出拨的是哪个对象类型").toContain(c.lever.objectType);
    // 杠杆落点就是阻滞点落点时给业务名；否则回包只有业务 id，如实回显 id
    const expectName = c.lever.objectId === im.locus.objectId ? im.locus.label : c.lever.objectId;
    expect(lever.textContent, "看不出拨的是哪个对象").toContain(expectName);

    // ── ② 拨哪个属性 ──────────────────────────────────────────────────────────
    const prop = within(card).getByTestId(`sc-cand-prop-${c.candidateId}`);
    expect(prop.textContent, "看不出拨哪个属性（本体属性码）").toContain(`${c.lever.objectType}.${c.lever.prop}`);
    if (c.lever.factorName !== undefined) {
      expect(prop.textContent, "看不出拨的是哪个产能因子（业务口径名）").toContain(c.lever.factorName);
    }

    // ── ③ 从多少拨到多少 ──────────────────────────────────────────────────────
    // 字节级：原值落在 DOM 属性上，与响应字段 String() 相等
    expect(card.getAttribute("data-from"), "data-from 与响应 fromValue 不逐字节相等").toBe(String(c.fromValue));
    expect(card.getAttribute("data-to"), "data-to 与响应 toValue 不逐字节相等").toBe(String(c.toValue));
    // 可见层：按后端下发的 valueKind 格式化（前端不判断单位）
    expect(within(card).getByTestId(`sc-cand-from-${c.candidateId}`).textContent).toBe(
      formatLeverValue(c.fromValue, c.lever.valueKind, c.lever.unit),
    );
    expect(within(card).getByTestId(`sc-cand-to-${c.candidateId}`).textContent).toBe(
      formatLeverValue(c.toValue, c.lever.valueKind, c.lever.unit),
    );
    // 拨到原处不是方案（契约硬约束），屏上两个数必须真的不同
    expect(c.fromValue).not.toBe(c.toValue);

    // ── ④ 真试算的效果：逐维前后值，逐字节 ────────────────────────────────────
    const dims = within(card).getByTestId(`sc-cand-dims-${c.candidateId}`);
    for (const d of c.dims) {
      const row = within(dims).getByTestId(`sc-cand-dim-${c.candidateId}-${d.key}`);
      expect(row.getAttribute("data-baseline"), `${d.key} 基线与响应不逐字节相等`).toBe(
        d.baseline === null ? "" : String(d.baseline),
      );
      expect(row.getAttribute("data-value"), `${d.key} 施策后值与响应不逐字节相等`).toBe(
        d.value === null ? "" : String(d.value),
      );
      expect(row.textContent, `${d.key} 的维名没上屏`).toContain(d.label);
      if (d.value !== null && d.baseline !== null) {
        // 前后两个数在可见文本里都在（不是只画一个）
        expect(row.textContent).toContain(String(d.baseline));
        expect(row.textContent).toContain(String(d.value));
      }
    }
    // 至少一维真的动了（否则按定义就不是一个方案）
    expect(
      c.dims.some((d) => d.value !== null && d.baseline !== null && d.value !== d.baseline),
      "候选各维与基线逐维相同 ⇒ 它不是方案",
    ).toBe(true);

    // ── ⑤ 产能 p50 前后值（派单点名要的那个维）真的在屏上 ──────────────────────
    const cap = c.dims.find((d) => d.key === "capacityP50");
    expect(cap, "候选里没有产能 p50 维").toBeDefined();
    const capRow = within(dims).getByTestId(`sc-cand-dim-${c.candidateId}-capacityP50`);
    expect(capRow.getAttribute("data-baseline")).toBe(cap!.baseline === null ? "" : String(cap!.baseline));
    expect(capRow.getAttribute("data-value")).toBe(cap!.value === null ? "" : String(cap!.value));
  });

  it("C · 档位来源 / 作用方式 / join 溯源：短名在第一层，出处**原文**在浮层（零原生 title）", async () => {
    const user = userEvent.setup();
    const { c } = firstWithCandidates();
    await openSandbox();
    const card = await screen.findByTestId(`sc-cand-${c.candidateId}`);

    // 第一层：短名 + 机器可读的态（挂在 DOM 属性上，供门按态断言）
    expect(card.getAttribute("data-rung")).toBe(c.rungKind);
    expect(card.getAttribute("data-effect")).toBe(c.effectKind);
    expect(card.getAttribute("data-join")).toBe(c.join.kind);
    expect(within(card).getByTestId(`sc-cand-rung-${c.candidateId}`).textContent).toContain(
      CANDIDATE_RUNG_LABEL[c.rungKind].label,
    );
    expect(within(card).getByTestId(`sc-cand-effect-${c.candidateId}`).textContent).toContain(
      CANDIDATE_EFFECT_LABEL[c.effectKind].label,
    );

    // 第一层**不许**有长口径（R-UI-3：口径/公式属于「凭什么」，进浮层）
    expect(card.textContent, "档位出处原文出现在第一层 ⇒ 第一层过载（违反 CONVENTION §1）").not.toContain(c.rungSource);
    expect(card.textContent, "试算公式出现在第一层 ⇒ 违反 CONVENTION §1").not.toContain(c.provenance.formula);
    // 浮层默认不在 DOM（"不点就看见"的只有数值/状态/名字）
    expect(screen.queryByTestId(`info-body-cand-how-${c.candidateId}`)).toBeNull();

    // 悬停 → 出现，且四段出处**原文**齐备
    await user.hover(within(card).getByTestId(`info-cand-how-${c.candidateId}`));
    const pop = await screen.findByTestId(`info-body-cand-how-${c.candidateId}`);
    expect(pop.textContent, "档位来源原文（rungSource）没进浮层").toContain(c.rungSource);
    expect(pop.textContent, "join 路径原文没进浮层 —— 「凭什么把这根杠杆算作它的解法」看不见").toContain(c.join.path);
    expect(pop.textContent, "试算公式原文没进浮层").toContain(c.provenance.formula);
    expect(pop.textContent, "join 口径说明没进浮层").toContain(CANDIDATE_JOIN_LABEL[c.join.kind].why);
    // 「档位取自同侪真实取值 / 零步长常数」这句必须说得出来（否则 62.3 会被读成前端拍的）
    expect(pop.textContent).toContain("零步长常数");

    // 移开 → **立即消失**（原生 tooltip 滞留事故的对策）
    await user.unhover(within(card).getByTestId(`info-cand-how-${c.candidateId}`));
    await waitFor(() =>
      expect(
        screen.queryByTestId(`info-body-cand-how-${c.candidateId}`),
        "移开后浮层滞留 = 复刻 ChainLineMapView 那次遮挡事故",
      ).toBeNull(),
    );

    // ★ 硬判据：整个候选卡子树里不许有 `title` 属性 / `<title>` 元素充当浮层
    expect(card.querySelectorAll("[title]").length, "用 HTML title 当浮层 —— 规范 §2 明令禁止").toBe(0);
    expect(card.querySelectorAll("title").length, "用 SVG <title> 当浮层 —— 规范 §2 明令禁止").toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 反向：没有候选的点**不许是空白**
  // ══════════════════════════════════════════════════════════════════════════

  it("D · 反向 · 一个 NONE 的阻滞点：屏上出现「为什么没方案」的**原文**，不是空白", async () => {
    const im = firstAbsent();
    await openSandbox();

    const none = await screen.findByTestId(`sc-cand-none-${im.impedimentId}`);
    expect(none.getAttribute("data-absence")).toBe(im.noCandidateKind);

    // ① 缺席原因**原文**（引擎写的，前端一个字都不改写）
    expect(
      within(none).getByTestId(`sc-cand-none-reason-${im.impedimentId}`).textContent,
      "缺席原因不是引擎原文 ⇒ 前端改写了后端文案（口径必漂）",
    ).toBe(im.noCandidateReason);

    // ② 这条断言了什么（NONE 与 UNAVAILABLE 两句必须不同 —— 见用例 F）
    expect(within(none).getByTestId(`sc-cand-none-claim-${im.impedimentId}`).textContent).toBe(
      CANDIDATE_ABSENCE_LABEL[im.noCandidateKind!].claim,
    );

    // ③ 逐点账：探了几个锚点 / 试算几次 / 有效几个 / 下发几条 —— 逐字节等于响应
    const stat = payload().candidateStats.find((s) => s.impedimentId === im.impedimentId)!;
    const statEl = within(none).getByTestId(`sc-cand-stat-${im.impedimentId}`);
    expect(statEl.getAttribute("data-anchors")).toBe(String(stat.anchors));
    expect(statEl.getAttribute("data-probes")).toBe(String(stat.probes));
    expect(statEl.getAttribute("data-effective")).toBe(String(stat.effective));
    expect(statEl.getAttribute("data-emitted")).toBe(String(stat.emitted));
    expect(statEl.textContent, "逐点账没上屏 ⇒ 「为什么没方案」只剩一句空话").toContain(String(stat.anchors));

    // ④ gaps[] **原文**逐条（「缺哪根杠杆 / 缺哪类数据」的唯一可查处）
    expect(stat.gaps.length, "金丝雀：这个点的 gaps 是空的 ⇒ 下面的断言恒真").toBeGreaterThan(0);
    const gaps = within(none).getByTestId(`sc-cand-gaps-${im.impedimentId}`);
    for (const g of stat.gaps) {
      expect(gaps.textContent, `gap 原文没上屏：${g}`).toContain(g);
    }

    // ★ 头号判据：这一块**不是空白**
    expect(none.textContent!.trim().length, "「为什么没方案」渲染成了空白 —— 空白比错答更容易被当成没问题").toBeGreaterThan(
      40,
    );
  });

  it("E · 反向 · **每一个**空候选的阻滞点都有话说（一个都不许留空白）", async () => {
    const absent = payload().impediments.filter((i) => i.candidates !== undefined && i.candidates.length === 0);
    await openSandbox();
    for (const im of absent) {
      const none = screen.getByTestId(`sc-cand-none-${im.impedimentId}`);
      expect(none.textContent, `${im.impedimentId} 的缺席原因是空的`).toContain(im.noCandidateReason!);
      expect(
        within(none).getByTestId(`sc-cand-stat-${im.impedimentId}`),
        `${im.impedimentId} 没有逐点账`,
      ).toBeInTheDocument();
    }
    // 屏上「有候选」与「没候选」两类都真实存在（否则本文件在验一个恒真的世界）。
    // ⚠ 这里**不能**用 `getAllByTestId(/^sc-cand-none-/)`：那条正则把 `sc-cand-none-claim-*`
    //   与 `sc-cand-none-reason-*` 也吞进来，5 个块量成 15（本单实测被它红了一次）——
    //   典型的「我用 X 当作 Y 的证据，而 X 并不度量 Y」。缺席**块**的判据是它带 `data-absence`。
    const blocks = document.querySelectorAll('[data-testid^="sc-cand-none-"][data-absence]');
    expect(blocks.length, "缺席块数与响应里空候选的点数对不上").toBe(absent.length);
    const withC = payload().impediments.filter((i) => (i.candidates ?? []).length > 0);
    expect(document.querySelectorAll('[data-testid^="sc-cand-block-"][data-count]').length).toBe(
      absent.length + withC.length,
    );
  });

  it("F · 三态不许塌成一个：NONE / UNAVAILABLE / NOT_RUN 的**措辞与形态各不相同**", async () => {
    // 契约层：两个 kind 的断言文案必须不同（合并即是把"没算出来"冒充"算过了"）
    expect(CANDIDATE_ABSENCE_LABEL.NONE.claim).not.toBe(CANDIDATE_ABSENCE_LABEL.UNAVAILABLE.claim);
    expect(CANDIDATE_ABSENCE_LABEL.NONE.label).not.toBe(CANDIDATE_ABSENCE_LABEL.UNAVAILABLE.label);
    expect(CANDIDATE_ABSENCE_LABEL.NOT_RUN.claim).not.toBe(CANDIDATE_ABSENCE_LABEL.NONE.claim);

    await openSandbox();
    // 总账把三态**逐格**报出来（0 也显示：「本次一条 UNAVAILABLE 都没有」也是结论）
    const sum = screen.getByTestId("sc-cand-summary");
    for (const k of ["NONE", "UNAVAILABLE", "NOT_RUN"] as const) {
      expect(within(sum).getByTestId(`sc-cand-summary-${k}`).textContent).toContain(CANDIDATE_ABSENCE_LABEL[k].label);
    }
    // 基线：mock 与生产同构 —— 全是 NONE，一条 UNAVAILABLE 都没有
    expect(within(sum).getByTestId("sc-cand-summary-UNAVAILABLE").textContent).toContain("0");
  });

  it("G · `UNAVAILABLE`（算不了）走同一条真实路由驱动，且与 NONE **在屏上分得开**", async () => {
    // 覆盖回包：把第一个空候选点的定性从 NONE 翻成 UNAVAILABLE（语义反转，不是改个名字）。
    // 走的仍是真实路由 —— 只换数据源的回答，不换链路。
    const target = firstAbsent().impedimentId;
    server.use(
      http.post("*/solvers/:key/run", async ({ params, request }) => {
        if (params.key !== "chain_impediments") return passthroughMiss();
        const body = (await request.json()) as { args?: Record<string, unknown> };
        const data = mockChainImpediments(body?.args ?? {}) as unknown as {
          impediments: ChainImpediment[];
        };
        for (const im of data.impediments) {
          if (im.impedimentId === target) {
            im.noCandidateKind = "UNAVAILABLE";
            im.noCandidateReason =
              "枚举**未能算完**（算不了 ≠ 没有对策）：探针预算在本阻滞点处理中耗尽（上界 400）⇒ 后续档位没试算完";
          }
        }
        return HttpResponse.json({ data, snapshotVersion: "ov-12" });
      }),
    );

    await openSandbox();
    const none = await screen.findByTestId(`sc-cand-none-${target}`);
    expect(none.getAttribute("data-absence"), "定性没跟着回包走").toBe("UNAVAILABLE");
    expect(none.textContent, "UNAVAILABLE 显示成了 NONE 的措辞 ⇒ 「没算出来」被冒充成「算过了没有」").toContain(
      CANDIDATE_ABSENCE_LABEL.UNAVAILABLE.label,
    );
    expect(none.textContent).not.toContain(CANDIDATE_ABSENCE_LABEL.NONE.claim);
    // 总账跟着动：UNAVAILABLE 那一格不再是 0
    expect(within(screen.getByTestId("sc-cand-summary")).getByTestId("sc-cand-summary-UNAVAILABLE").textContent).toContain(
      "1",
    );
  });

  it("H · `NOT_RUN`（本次没跑枚举）是**第三态**：回包无 candidates 字段 ≠ 「查过了没有」", async () => {
    server.use(
      http.post("*/solvers/:key/run", async ({ params, request }) => {
        if (params.key !== "chain_impediments") return passthroughMiss();
        const body = (await request.json()) as { args?: Record<string, unknown> };
        const data = mockChainImpediments(body?.args ?? {}) as unknown as {
          impediments: ChainImpediment[];
          candidateStats?: unknown;
        };
        // 整块摘掉候选字段 = 「本次扫描没跑候选枚举」的真实形态（契约注释原话）
        for (const im of data.impediments) {
          delete (im as { candidates?: unknown }).candidates;
          delete (im as { noCandidateReason?: unknown }).noCandidateReason;
          delete (im as { noCandidateKind?: unknown }).noCandidateKind;
        }
        delete data.candidateStats;
        return HttpResponse.json({ data, snapshotVersion: "ov-12" });
      }),
    );

    await openSandbox();
    const id = payload().impediments[0]!.impedimentId;
    const none = await screen.findByTestId(`sc-cand-none-${id}`);
    expect(none.getAttribute("data-absence"), "没跑枚举被塌进了 NONE/UNAVAILABLE").toBe("NOT_RUN");
    expect(none.textContent).toContain(CANDIDATE_ABSENCE_LABEL.NOT_RUN.label);
    // 引擎没回带逐点账 ⇒ 如实说"说不出探了几个锚点"，**不编一个数**
    expect(
      within(none).getByTestId(`sc-cand-stat-missing-${id}`).textContent,
      "没有逐点账却编了一个数",
    ).toContain("不编一个数");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 零写死（R14）与文案纪律
  // ══════════════════════════════════════════════════════════════════════════

  it("I · R14 零写死：屏上每个候选数字都指得回响应字段；且候选区文案里没有 Markdown 记号", async () => {
    const { im } = firstWithCandidates();
    await openSandbox();
    const block = await screen.findByTestId(`sc-cand-block-${im.impedimentId}`);

    // 这些串是**纯文本渲染**的：`**x**` 在页面上就是两个字面星号（本仓实测确认过）。
    // 强调靠样式，不靠星号。⚠ 引擎原文里的星号是引擎的（前端不许改写），故只查本层自己写的常量。
    for (const t of [
      ...Object.values(CANDIDATE_ABSENCE_LABEL).flatMap((v) => [v.label, v.claim]),
      ...Object.values(CANDIDATE_JOIN_LABEL).flatMap((v) => [v.label, v.why]),
      ...Object.values(CANDIDATE_RUNG_LABEL).flatMap((v) => [v.label, v.why]),
      ...Object.values(CANDIDATE_EFFECT_LABEL).flatMap((v) => [v.label, v.why]),
    ]) {
      expect(t, `本层文案里出现 Markdown 星号：${t}`).not.toMatch(/\*\*/);
    }

    // 候选卡上每个 data-* 数字都能在响应里找到同一个字节串（零凭空数字）
    const respNums = new Set<string>();
    for (const c of im.candidates!) {
      respNums.add(String(c.fromValue));
      respNums.add(String(c.toValue));
      for (const d of c.dims) {
        if (d.baseline !== null) respNums.add(String(d.baseline));
        if (d.value !== null) respNums.add(String(d.value));
      }
    }
    for (const card of block.querySelectorAll("[data-from]")) {
      expect(respNums.has(card.getAttribute("data-from")!), "屏上出现一个响应里没有的 from 值").toBe(true);
      expect(respNums.has(card.getAttribute("data-to")!), "屏上出现一个响应里没有的 to 值").toBe(true);
    }
  });
});

/** MSW 未命中时的显式失败（比静默 passthrough 更早暴露"覆盖写错了 key"）。 */
function passthroughMiss(): Response {
  return HttpResponse.json({ error: { code: "TEST_HANDLER_MISS", message: "覆盖 handler 未命中预期 key" } }, { status: 500 });
}
