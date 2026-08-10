import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderWithClient as render } from "./utils";
import { CapacityDerivationDag, CAP_TYPE_SCALE } from "@/views/capacity/CapacityDerivationDag";
import { ONTO_LAYERS } from "@/views/capacity/factorOntology";
import zh from "@/locales/zh";

/**
 * WO-CAPACITY-CARD-LAYOUT · 「可用产能派生诊断（自下而上 6 层）」行式 → 卡片式。
 *
 * 判据来自 `docs/CONVENTION-ui-information-layering.md` §5（复审判据），逐条落成断言：
 *   §5.3 → R-UI-3：公式不在第一层，`?` 浮层里才有（**两向都测**：不在 / 展开后在）
 *   §5.3 → R-UI-2：三级字号，最大一级只给「本页要回答的那个数」= 第 6 层 产能缺口
 *   §5.5 → 结构：不看文字能看出递进吗 —— 连接线 / 梯级条 / data-step / aria 四个承载物
 *   §5.4 → 诚实位：降层了吗？第一层还有记号吗？（删掉即退，无条件）
 *   §1   → 第二层：逐项明细不点不出
 *   §2.3 → 浮层规格：移开即消失 · 键盘可达 · **零原生 tooltip**（title 属性 / <title> 元素）
 *   §4   → 三套主题（暗 / 冷蓝 light / 亮橙 warm）：零硬编码色值 ⇒ 自动跟随
 *
 * 反证纪律：本文件的每条断言都在实现上做过变异反证（把公式搬回第一层 / 拆掉递进承载物），
 * 变异后对应用例必红 —— 见工单报告里的两向输出。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(TEST_DIR, "..", "src", "views", "capacity");
const readSrc = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const LAYERS = [1, 2, 3, 4, 5, 6] as const;
/** 第一层（不点不悬停就看得见的那一屏）= 卡片链本体。 */
const firstLayer = () => screen.getByTestId("cap-dag-nodes");
const face = (n: number) => screen.getByTestId(`cap-dag-node-toggle-${n}`);
const px = (el: Element) => parseFloat(getComputedStyle(el as HTMLElement).fontSize);

async function mountDag() {
  loginAs("planner");
  const utils = render(<CapacityDerivationDag baseId="常州" />);
  await waitFor(() => expect(screen.getByTestId("cap-dag-nodes")).toBeInTheDocument());
  return utils;
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("WO-CAPACITY-CARD-LAYOUT · 6 层派生诊断卡片化（规范 §5 逐条）", () => {
  it("① R-UI-3 两向：公式**不在**第一层；`?` 浮层展开后**在**（口径是解释，不是结论）", async () => {
    const user = userEvent.setup();
    await mountDag();

    // ── 向一：第一层零公式。判据取 `factorOntology.ONTO_LAYERS[].role` **单一来源**，
    //          不在测试里抄一份公式字符串（抄了就会与本体表漂开、改了本体测试照绿）。
    const layerText = firstLayer().textContent ?? "";
    for (const L of ONTO_LAYERS) {
      expect(layerText).not.toContain(L.role);
    }
    // 工单点名的三段（人眼判据 —— 与上面的单源判据互为金丝雀：这三段确实是 role 的内容）
    expect(ONTO_LAYERS.map((l) => l.role).join("｜")).toContain("节拍 × OEE");
    expect(ONTO_LAYERS.map((l) => l.role).join("｜")).toContain("min(瓶颈工序)");
    expect(ONTO_LAYERS.map((l) => l.role).join("｜")).toContain("∩ 物料齐套");
    for (const frag of ["节拍 × OEE", "min(瓶颈工序)", "∩ 物料齐套"]) {
      expect(layerText).not.toContain(frag);
    }

    // ── 向二：悬停第 1 层的 `?` → 浮层里有该层公式全文。
    await user.hover(screen.getByTestId("info-wrap-cap-dag-formula-1"));
    const body1 = await screen.findByTestId("info-body-cap-dag-formula-1");
    expect(body1.textContent ?? "").toContain(ONTO_LAYERS[0]!.role); // 节拍 × OEE × 通道 × 班次 → 单机日产出
    // 浮层同时承载"凭什么"：溯源字段 + 口径 + 上下游（结论性数字仍在第一层，不藏浮层里）。
    expect(body1.textContent ?? "").toContain("bottleneck_matrix.设备OEE");

    // 六层逐个都能在浮层里读到自己的公式（不是只做了第 1 张卡）。
    await user.unhover(screen.getByTestId("info-wrap-cap-dag-formula-1"));
    for (const n of LAYERS) {
      await user.hover(screen.getByTestId(`info-wrap-cap-dag-formula-${n}`));
      const body = await screen.findByTestId(`info-body-cap-dag-formula-${n}`);
      expect(body.textContent ?? "").toContain(ONTO_LAYERS[n - 1]!.role);
      await user.unhover(screen.getByTestId(`info-wrap-cap-dag-formula-${n}`));
    }
  });

  it("② R-UI-2 字号层级：6 张卡主数值逐个可取；**第 6 层（本页要回答的那个数）字号严格大于其余五层**", async () => {
    await mountDag();

    // 6 个主数值逐个 getByTestId 取得到，且都不是空壳。
    for (const n of LAYERS) {
      const v = screen.getByTestId(`cap-dag-anchor-${n}`);
      expect((v.textContent ?? "").trim().length).toBeGreaterThan(0);
    }

    // computed style 实测（inline font-size ⇒ jsdom 真算得出，不是只看 class 名）。
    const hero = screen.getByTestId("cap-dag-anchor-6");
    const heroPx = px(hero);
    expect(heroPx).toBe(CAP_TYPE_SCALE.hero);
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(px(screen.getByTestId(`cap-dag-anchor-${n}`))).toBeLessThan(heroPx);
    }
    // 显式 size 标记（第二把尺子：computed style 若被环境吃掉，这把仍咬得住）。
    expect(hero.getAttribute("data-size")).toBe("hero");
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect(screen.getByTestId(`cap-dag-anchor-${n}`).getAttribute("data-size")).toBe("std");
    }
    // 「最大的那一级只给一个数」——全卡链里 hero 尺寸有且仅有一个。
    expect(firstLayer().querySelectorAll('[data-size="hero"]').length).toBe(1);
    // 三级字号：主数值 > 标签，且总级数 ≤ 3（hero / value / label）。
    expect(CAP_TYPE_SCALE.value).toBeGreaterThan(CAP_TYPE_SCALE.label);
    expect(new Set(Object.values(CAP_TYPE_SCALE)).size).toBe(3);

    // 状态是**颜色 + 形状 + 文字**三通道，不靠颜色单通道（灰度/色觉障碍下仍可辨）。
    // 颜色只上在形状上（浅色主题下 --ok/--c-forecast 当 10.5px 正文色对比不足），状态词走中性高对比色。
    for (const n of LAYERS) {
      const st = screen.getByTestId(`cap-dag-status-${n}`);
      expect(st.getAttribute("data-status")).toBeTruthy();
      expect((st.textContent ?? "").trim().length).toBeGreaterThan(0); // 文字通道
      const glyph = st.querySelector("[aria-hidden]");
      expect(glyph?.textContent ?? "").toMatch(/^[●▲◆○]$/); // 形状通道
      expect(glyph?.getAttribute("style") ?? "").toContain("var(--"); // 颜色通道（token·非硬编码）
      // 状态词本身不着语义色 —— 它靠 `.status` 的 --muted，浅色主题下才读得清。
      expect(st.getAttribute("style") ?? "").not.toContain("color");
    }
  });

  it("③ 规范 §3 递进：连接线 / 梯级条 / data-step / aria —— 四个承载物都在（不只是视觉）", async () => {
    await mountDag();

    // 承载物① 连接箭头：6 张卡之间恰好 5 条，且方向由 testid 写死（n-1 → n）。
    for (const n of [2, 3, 4, 5, 6] as const) {
      expect(screen.getByTestId(`cap-dag-link-${n - 1}-${n}`)).toBeInTheDocument();
    }
    expect(firstLayer().querySelectorAll('[data-testid^="cap-dag-link-"]').length).toBe(5);
    // 起点前面不该有箭头（有就是把链画成了环）。
    expect(screen.queryByTestId("cap-dag-link-0-1")).toBeNull();

    // 承载物② 梯级条：第 n 张卡点亮 n 格（阶梯累积 ⇒ 换行后仍带着"第几级"）。
    for (const n of LAYERS) {
      const rungs = screen.getByTestId(`cap-dag-rungs-${n}`);
      expect(rungs.querySelectorAll('[data-on="1"]').length).toBe(n);
      expect(rungs.querySelectorAll('[data-cur="1"]').length).toBe(1);
    }

    // 承载物③ data-step / 上下游：谁推出谁，机器可读。
    for (const n of LAYERS) {
      const node = screen.getByTestId(`cap-dag-node-${n}`);
      expect(node.getAttribute("data-step")).toBe(String(n));
      expect(node.getAttribute("data-derives-from")).toBe(n === 1 ? "" : String(n - 1));
      expect(node.getAttribute("data-derives-to")).toBe(n === 6 ? "" : String(n + 1));
    }

    // 承载物④ aria：读屏不看版式也读得出方向 + 链两端的"起点/终点"。
    expect(face(3).getAttribute("aria-label") ?? "").toContain(zh.capDag.fromStep(2, ONTO_LAYERS[1]!.name));
    expect(face(1).getAttribute("aria-label") ?? "").toContain(zh.capDag.fromNone);
    expect(firstLayer().getAttribute("aria-label") ?? "").toContain("自下而上");
  });

  it("④ 诚实位：正文降到浮层但**一字未删**，第一层留下可见记号（静默降层 = 删除）", async () => {
    const user = userEvent.setup();
    await mountDag();

    // 第一层：记号在（不点也知道"这里有话要说"）。
    const mark = screen.getByTestId("cap-dag-honesty-mark");
    expect(mark).toBeInTheDocument();
    expect((mark.textContent ?? "").trim().length).toBeGreaterThan(0);

    // 第一层：正文**不常驻**（降层的意义）。
    expect(document.body.textContent ?? "").not.toContain("R13 每值可溯");

    // 浮层：整句原文仍在 DOM 里。
    await user.hover(screen.getByTestId("info-wrap-cap-dag-honesty"));
    const body = await screen.findByTestId("info-body-cap-dag-honesty");
    expect(body.textContent ?? "").toContain(zh.capDag.honesty);

    // 且这句就是被搬走的那句（防"降层顺手删/改口径"）——三处硬信息逐个咬。
    for (const frag of [
      "本体 §3·不改链路，仅可视化",
      "base_capacity_outlook.available/gap",
      "bottleneck_matrix",
      "R13 每值可溯",
      "factorOntology",
    ]) {
      expect(body.textContent ?? "").toContain(frag);
    }
  });

  it("⑤ 浮层规格（R-UI-3）：移开即消失 · 键盘可达（focus/Esc）· **整棵子树零原生 tooltip**", async () => {
    const user = userEvent.setup();
    const { container } = await mountDag();

    const wrap = screen.getByTestId("info-wrap-cap-dag-formula-3");
    // 悬停出 → 移开**立即消失**（open=false ⇒ 不渲染，不是 hidden）。
    await user.hover(wrap);
    expect(await screen.findByTestId("info-body-cap-dag-formula-3")).toBeInTheDocument();
    await user.unhover(wrap);
    await waitFor(() => expect(screen.queryByTestId("info-body-cap-dag-formula-3")).toBeNull());

    // 键盘可达：focus 展开 → Esc 关闭。
    const trigger = screen.getByTestId("info-cap-dag-formula-3");
    await act(async () => trigger.focus());
    expect(await screen.findByTestId("info-body-cap-dag-formula-3")).toBeInTheDocument();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("info-body-cap-dag-formula-3")).toBeNull());

    // **点击必须真能打开**（共用组件作者点名的坑：`onClick` 若做取反，会被先到的 `focus`
    // 抵消 ⇒「hover 能看见、点却打不开」，而 hover 路径全绿、极难看出来）。
    // 我是这个组件的消费方，这条回归就守在消费侧。
    await user.click(screen.getByTestId("info-cap-dag-formula-4"));
    expect(await screen.findByTestId("info-body-cap-dag-formula-4")).toBeInTheDocument();
    // 浮层表面走全局 `.popover-surface`（欠账 #104 专做、三套主题都验过遮蔽性），不自写 background。
    expect(screen.getByTestId("info-body-cap-dag-formula-4").className).toContain("popover-surface");

    // 禁止原生 tooltip：`title` 属性与 `<title>` 元素在本面板里必须一个都没有
    // （2026-08-10 环形图实测事故：OS 绘制、恒在最上层、移开滞留）。
    await user.click(face(2)); // 连第二层明细一起扫（原来那里有 6 个 title 徽标）
    await screen.findByTestId("cap-dag-detail-2");
    expect(container.querySelectorAll("[title]").length).toBe(0);
    expect(container.querySelectorAll("title").length).toBe(0);
    // 金丝雀：同一把尺子扫一个**已知必中**的样例 → 必须命中，否则是尺子坏了不是代码干净。
    const canary = document.createElement("div");
    canary.innerHTML = '<span title="我是原生 tooltip">x</span>';
    expect(canary.querySelectorAll("[title]").length).toBe(1);
  });

  it("⑥ 第一层只回答「怎么样」：逐项明细**不点不出**，点开才是第二层", async () => {
    const user = userEvent.setup();
    await mountDag();

    // 初始：无任何层展开（原实现默认展开第 5 层 ⇒ 不点也看得见驱动因素/溯源字段）。
    for (const n of LAYERS) expect(screen.queryByTestId(`cap-dag-detail-${n}`)).toBeNull();
    expect(screen.getByTestId("cap-dag-detail-hint")).toBeInTheDocument();
    // 第一层不含"溯源字段"这类诊断信息。
    expect(firstLayer().textContent ?? "").not.toContain("溯源字段");

    // 一次点击 → 第二层出（明细含驱动因素 + 溯源字段）。
    await user.click(face(5));
    const d5 = await screen.findByTestId("cap-dag-detail-5");
    expect(d5.textContent ?? "").toContain("base_capacity_outlook.available");
    expect(within(d5).getAllByText(/[①-⑳]/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("cap-dag-detail-hint")).toBeNull();
    expect(face(5).getAttribute("aria-pressed")).toBe("true");

    // 互斥：换一张卡 → 只剩新那张的明细（第二层始终只有一份，不叠成一片）。
    await user.click(face(1));
    expect(await screen.findByTestId("cap-dag-detail-1")).toBeInTheDocument();
    expect(screen.queryByTestId("cap-dag-detail-5")).toBeNull();
    // 再点一次同一张 → 收起，回到"第一层只有结论"的初态。
    await user.click(face(1));
    await waitFor(() => expect(screen.queryByTestId("cap-dag-detail-1")).toBeNull());
    expect(screen.getByTestId("cap-dag-detail-hint")).toBeInTheDocument();
  });

  it("⑦ 深浅两套主题：零硬编码色值（全部走 token）+ data-theme=light 下 6 卡照常渲染", async () => {
    // 三套主题（暗默认 / 冷蓝 light / 亮橙 warm）共用同一组 token，
    // 因此「组件与其 CSS module 里一个字面色值都没有」= 三套主题自动跟随的**机械保证**。
    const COLOR_LITERAL = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|\brgba?\s*\(|\bhsla?\s*\(/g;
    // 金丝雀先跑（铁律 0.6：扫描类结论一律先自证工具）——同一个正则，不另抄一份。
    const CANARY = "color: #E0626C; background: rgba(0,0,0,.5); border: 1px solid hsl(200 50% 50%)";
    expect(CANARY.match(COLOR_LITERAL)).toHaveLength(3);

    for (const f of ["CapacityDerivationDag.tsx", "CapacityDerivationDag.module.css"]) {
      expect(readSrc(f).match(COLOR_LITERAL) ?? []).toEqual([]);
    }
    // 反向证据：这些文件里**确实**大量用了 token（不是"因为没写颜色所以没命中"）。
    expect((readSrc("CapacityDerivationDag.module.css").match(/var\(--/g) ?? []).length).toBeGreaterThan(20);

    // 浅色主题（仓主在用的那套）下真渲染一遍：6 卡齐、hero 仍最大、锚点颜色仍是 token 引用。
    document.documentElement.setAttribute("data-theme", "light");
    await mountDag();
    for (const n of LAYERS) expect(screen.getByTestId(`cap-dag-node-${n}`)).toBeInTheDocument();
    expect(px(screen.getByTestId("cap-dag-anchor-6"))).toBe(CAP_TYPE_SCALE.hero);
    for (const n of LAYERS) {
      expect(screen.getByTestId(`cap-dag-anchor-${n}`).getAttribute("style") ?? "").toContain("var(--");
    }
    cleanup();

    // 暗色（默认·无 data-theme）同样跑一遍 —— 两套都自测，不是只看一套。
    document.documentElement.removeAttribute("data-theme");
    await mountDag();
    for (const n of LAYERS) expect(screen.getByTestId(`cap-dag-node-${n}`)).toBeInTheDocument();
    expect(px(screen.getByTestId("cap-dag-anchor-6"))).toBe(CAP_TYPE_SCALE.hero);
  });
});
