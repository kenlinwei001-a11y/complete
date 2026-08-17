import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX, GROUP_CONSOLIDATION_EXEMPT } from "@/pages/ShellLayout";
import {
  SANDBOX_ATTRIBUTE_TABS,
  SANDBOX_ATTRIBUTE_TAB_SPEC,
  SANDBOX_MODES,
} from "@/views/sim/sandboxModes";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SANDBOX-NAV-CONSOLIDATE · 「归因与风险」组的收编 —— SEAM 门。
 *
 * ══ 仓主原话 ══════════════════════════════════════════════════════════════════
 * **「为何导航栏还有这2个，我之前不是要求你调整吗？」**（指侧栏「归因与风险」组下
 * 「流程等待态」与「采购四段腿分解」两条。）
 *
 * ══ 根因（不是漏配）══════════════════════════════════════════════════════════
 * 该组原设计是「沙盘一开，整组消失」——`cleanroom-attr` / `disruption-radius` 都带
 * `consolidatedWhen: "sim.sandbox"`，两项全隐藏 ⇒ 空组自动隐藏。
 * 后来三张单**各往组里加了一项、每一项都不带** `consolidatedWhen`，理由都是
 * 「沙盘五模式里没有它，带了页面就不可达」——**每条豁免单独看都成立**，
 * 合起来把整组的收编承诺掏空了。形态（铁律 0.6 句式）：
 *   **「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据，而前者并不度量后者。」**
 *
 * ══ 本文件咬的四件事（缺一即退）══════════════════════════════════════════════
 *
 * **① 导航侧**：沙盘开 ⇒ 「归因与风险」组**不出现在侧栏**；沙盘关 ⇒ 组在且五项都在。
 *    只咬前者 = 把「删项了事」判成成功；只咬后者 = 根本没验仓主问的那件事。
 *
 * **② 可达侧（头号判据）**：沙盘开着时，从沙盘**真点进去**能到达那三页的内容。
 *    ⚠ 断言落在**内容出现**（该页特有的 testid），**不是**「按钮存在」也**不是**「路由注册了」。
 *    这正是本仓「绿测试 ≠ 能用」的老坑：入口在、点了什么都没有。
 *    ①②**必须同时成立**才算交付 —— 缺 ② 的 ① 就是页面彻底不可达。
 *
 * **③ 暗发键守卫不许丢**：`process.runtime`（defaultOn:false）关着 ⇒ 沙盘里**不出现**
 *    `process-stuck` 那一档（不是禁用按钮 —— 禁用同样泄露功能存在性）。
 *    收编若把 R3 绕过去，等于用一次 IA 整理把暗发键作废。
 *
 * **④ 既有裁决不许被推翻**：`process-wait`（模板层）与 `process-stuck`（实例层）
 *    **不合并**。收编之后它们仍是**两个**入口 —— 沙盘里的两个档，各自渲染各自那一页。
 *
 * R6 确定性：无时钟、无随机；网络全走 MSW 既有 handlers（不另造一套数据）。
 */

/** 真路由进沙盘（懒加载 + 两个链路求解器，故给足超时；与 sandbox-process-mode.seam 同款）。 */
async function enterSandbox(): Promise<void> {
  renderApp("/v/sim-sandbox");
  await waitFor(() => expect(screen.getByTestId("sandbox-view")).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(screen.getByTestId("sandbox-console")).toBeTruthy(), { timeout: 20000 });
}

/** 切到「归因」模式并等档条落地。 */
async function openAttributeMode(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByTestId("sandbox-mode-attribute"));
  return await screen.findByTestId("sandbox-attr-tabs", undefined, { timeout: 20000 });
}

beforeEach(() => {
  loginAs("planner"); // mock 里 planner 持 admin 角色
});
afterEach(() => {
  cleanup();
  delete db.tenantOverrides["sim.sandbox"];
  delete db.tenantOverrides["process.runtime"];
});

// ══════════════════════════════════════════════════════════════════════════════
// §0 金丝雀 —— 报否定结论前先自证前提（铁律 0.6）
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SANDBOX-NAV-CONSOLIDATE · §0 金丝雀（不中就报「前提不成立」，不许报「代码干净」）", () => {
  it("0.1 · 「归因与风险」组真的存在、真有五项，且**五项全部**带 consolidatedWhen", () => {
    const group = NAV_GROUPS.find((g) => g.title === "归因与风险");
    expect(group, "组都没有了 ⇒ 下面每条断言都在空集合上跑，恒真恒绿").toBeTruthy();
    expect(group!.items.length, "组里少于 5 项 ⇒ 本单收编的那三项没进来，断言面不对").toBeGreaterThanOrEqual(5);
    const naked = group!.items.filter((it) => it.kind !== "admin" && it.consolidatedWhen !== "sim.sandbox");
    expect(
      naked.map((it) => it.key),
      "这些项没带 consolidatedWhen ⇒ 沙盘开着时组不会自动隐藏，仓主问的那件事没解决",
    ).toEqual([]);
  });

  it("0.2 · 三页真的登记进了「归因」模式的档表，且档表与收编表**不许各写一半**", () => {
    // 顺序即表达（从粗到细：链路损失 → 流程模板 → 流程实例 → 采购责任方），改了会红
    expect([...SANDBOX_ATTRIBUTE_TABS]).toEqual(["cleanroom", "process-wait", "process-stuck", "procurement-legs"]);
    // 「归因」仍然是五模式之一，本单没有新增模式（决策链顺序一个字没动）
    expect([...SANDBOX_MODES]).toEqual(["now", "attribute", "tryone", "optimize", "radius"]);
    // 档表的 originView ⊆ 收编表的键：档里指着一页、收编表里却没有它 = 没人声明过到达路径
    for (const t of SANDBOX_ATTRIBUTE_TABS) {
      const key = SANDBOX_ATTRIBUTE_TAB_SPEC[t].originView;
      expect(
        CONSOLIDATED_INTO_SANDBOX[key],
        `档「${SANDBOX_ATTRIBUTE_TAB_SPEC[t].label}」指向 ${key}，但它不在 CONSOLIDATED_INTO_SANDBOX 里 ——` +
          `两张表各写一半，正是本仓 #99/#110 的病根`,
      ).toBeTruthy();
      expect(CONSOLIDATED_INTO_SANDBOX[key]!.where, `${key} 的 where 没写出它在「归因」模式里`).toContain("归因");
    }
  });

  it("0.3 · 组豁免表非空且键都指向真实的「组::项」（陈旧豁免会悄悄放过下一个真缺口）", () => {
    const pairs = new Set(
      NAV_GROUPS.flatMap((g) => g.items.map((it) => `${g.title}::${it.key}`)),
    );
    expect(Object.keys(GROUP_CONSOLIDATION_EXEMPT).length, "豁免表为空 ⇒ 下面的对账恒真").toBeGreaterThan(0);
    for (const [k, why] of Object.entries(GROUP_CONSOLIDATION_EXEMPT)) {
      expect(pairs.has(k), `豁免键 "${k}" 在 NAV_GROUPS 里找不到对应的组::项 —— 陈旧豁免`).toBe(true);
      expect(why.trim().length, `豁免 "${k}" 的理由不足 10 字（"待定"不是理由）`).toBeGreaterThanOrEqual(10);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §A 导航侧 —— 沙盘开则整组消失，沙盘关则整组回来
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SANDBOX-NAV-CONSOLIDATE · §A 导航侧（仓主问的就是这一屏）", () => {
  it("A1 · 沙盘开（默认）⇒ 「归因与风险」组**整组不出现在侧栏**（空组自动隐藏）", async () => {
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    // 金丝雀：沙盘确实开着（沙盘不在 ⇒ 本条在"沙盘关"的世界里跑，结论恰好相反）
    expect(hrefs, "沙盘入口不在侧栏 ⇒ 收编的前提不成立，本条是空转").toContain("/v/sim-sandbox");
    // 金丝雀：别的组还在（整个导航塌了的话，下面的 queryBy 也是 null，恒真）
    expect(within(nav).getByTestId("nav-group-规划与平衡")).toBeInTheDocument();

    expect(
      within(nav).queryByTestId("nav-group-归因与风险"),
      "沙盘开着，「归因与风险」组仍在侧栏 —— 这正是仓主指的那两条（组的收编承诺被掏空）",
    ).toBeNull();

    // 五个成员逐条都不许在（组消失了但成员漂到别处 = 换了个地方重复入口）
    for (const key of ["process-wait", "procurement-legs", "process-stuck", "cleanroom-attr", "disruption-radius"]) {
      expect(hrefs, `/v/${key} 已收编进沙盘，却仍在侧栏 —— 重复入口`).not.toContain(`/v/${key}`);
    }
    // ⚠ 最容易漏的一条：只从分组里拿掉而不滤 leftover ⇒ 原地掉进「其它」兜底桶
    //   （G-NAV-FALLBACK-BUCKET 本体，比单列还糟：单列至少找得到）
    const other = within(nav).queryByTestId("nav-group-其它");
    if (other) {
      const strays = Array.from(other.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      for (const key of ["process-wait", "procurement-legs", "process-stuck"]) {
        expect(strays, `/v/${key} 掉进「其它」兜底桶 —— 可达但用户找不到`).not.toContain(`/v/${key}`);
      }
    }
  });

  it("A2 · 沙盘关 ⇒ 组回来，且**五项一条不少**（收编 ≠ 删除·别把关着时也删了）", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    db.tenantOverrides["process.runtime"] = true; // 暗发页开通，才凑得齐五项（否则它本就不该在）
    renderApp("/v/dash");
    const nav = await screen.findByTestId("nav-business");
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    // 金丝雀：override 真生效（沙盘入口消失）
    expect(hrefs, "sim.sandbox 关着，沙盘入口仍在 ⇒ override 没生效，本条是空转").not.toContain("/v/sim-sandbox");
    const group = within(nav).getByTestId("nav-group-归因与风险");
    for (const key of ["process-wait", "procurement-legs", "process-stuck", "cleanroom-attr", "disruption-radius"]) {
      const links = Array.from(group.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      expect(
        links,
        `沙盘关着，/v/${key} 却不在「归因与风险」组里 —— 这一页从 IA 里蒸发了（收编做成了删除）`,
      ).toContain(`/v/${key}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §B 可达侧（头号判据）—— 从沙盘真点进去，断言**内容出现**
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SANDBOX-NAV-CONSOLIDATE · §B 可达侧（断言落在内容，不是按钮）", () => {
  it("B0 · 进沙盘 → 切「归因」⇒ 默认档是净室归因，档条上三页的档都在（暗发页除外）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    expect(bar.getAttribute("data-active"), "默认档变了 ⇒ 收编之前那一页的行为没保持向后兼容").toBe("cleanroom");
    // 三个新档里，两个不受暗发键控制的必须在；process-stuck 默认不在（见 §C）
    expect(within(bar).getByTestId("sandbox-attr-tab-process-wait")).toBeInTheDocument();
    expect(within(bar).getByTestId("sandbox-attr-tab-procurement-legs")).toBeInTheDocument();
  });

  it("B1 · 点「流程等待态」档 ⇒ **那一页的内容真出现**（pw-root + pw-summary，不是一个空壳）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    // 金丝雀：点之前它不在屏上（否则"点进去才出来"这件事没被证明）
    expect(screen.queryByTestId("pw-root"), "还没点档，流程等待态就已经在屏上 ⇒ 本条不证明点击驱动了什么").toBeNull();

    await user.click(within(bar).getByTestId("sandbox-attr-tab-process-wait"));
    // ⚠ 断言落在**该页特有的内容**：pw-summary 只在数据回来、模型建好之后才渲染 ——
    //   拿 `sandbox-attr-view-process-wait`（我自己造的壳）当判据就是「入口在、点了什么都没有」那个老坑。
    expect(await screen.findByTestId("pw-summary", undefined, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.getByTestId("pw-root")).toBeInTheDocument();
    // 四态分组是这一页的主体（第五档「业务流程」没有它 —— 那一档只复用了检视面板）
    expect(screen.getByTestId("pw-dist")).toBeInTheDocument();
  });

  it("B2 · 点「采购四段腿」档 ⇒ **那一页的内容真出现**（procurement-legs-root）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    expect(screen.queryByTestId("procurement-legs-root")).toBeNull();

    await user.click(within(bar).getByTestId("sandbox-attr-tab-procurement-legs"));
    const root = await screen.findByTestId("procurement-legs-root", undefined, { timeout: 20000 });
    expect(root).toBeInTheDocument();
    // 标题来自 workspace 下发的 ViewConfig（`view.title`）——证明这一档吃的是**同一份配置**，
    // 不是我在沙盘里现编了一个 view 对象塞进去。
    expect(root.textContent, "档里渲染的不是那一页（标题对不上）").toContain("采购四段腿分解");
  });

  it("B3 · 暗发页开通后点「流程卡点」档 ⇒ **那一页的内容真出现**（stuck-step 逐条卡片）", async () => {
    db.tenantOverrides["process.runtime"] = true;
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    expect(screen.queryByTestId("stuck-step")).toBeNull();

    await user.click(within(bar).getByTestId("sandbox-attr-tab-process-stuck"));
    // ⚠ `findAllByTestId`：mock 下发多条卡单 ⇒ 多张卡片。用单数 `findByTestId` 会因
    //   "Found multiple elements" 而红 —— 那是**测试写错了**，不是页面坏了（实测踩到，记账在此）。
    const steps = await screen.findAllByTestId("stuck-step", undefined, { timeout: 8000 });
    expect(steps.length, "卡单一张都没渲染 ⇒ 这一档是空壳").toBeGreaterThan(0);
    // 实例层的现场值（等待态计数条）—— 模板层那一页没有这个 testid，两者不可能被搞混
    expect(screen.getByTestId("tally-WAITING_APPROVAL")).toBeInTheDocument();
  });

  it("B4 · 既有裁决不许被推翻：模板层与实例层是**两个档**，切换时另一页的内容不在 DOM 里", async () => {
    db.tenantOverrides["process.runtime"] = true;
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    // 两个档并存 = 两个入口（合成一个入口就等于把 waitStateOrigin 那条诚实位在 IA 层抹掉）
    expect(within(bar).getByTestId("sandbox-attr-tab-process-wait")).toBeInTheDocument();
    expect(within(bar).getByTestId("sandbox-attr-tab-process-stuck")).toBeInTheDocument();

    await user.click(within(bar).getByTestId("sandbox-attr-tab-process-wait"));
    await screen.findByTestId("pw-summary", undefined, { timeout: 8000 });
    expect(screen.queryAllByTestId("stuck-step"), "模板层档里出现了实例层的内容 ⇒ 两层被揉在一起了").toEqual([]);

    await user.click(within(bar).getByTestId("sandbox-attr-tab-process-stuck"));
    await screen.findAllByTestId("stuck-step", undefined, { timeout: 8000 });
    // 判据是**不在 DOM**（不是 hidden）——「叠一屏再盖住」不算换档，与模式切换同一条硬约束
    expect(screen.queryByTestId("pw-summary"), "切到实例层后模板层的内容仍在 DOM 里 ⇒ 是叠加不是换档").toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §C 暗发键守卫 —— 收编不许把 R3 绕过去
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SANDBOX-NAV-CONSOLIDATE · §C 暗发键守卫（process.runtime 默认关）", () => {
  it("C1 · `process.runtime` 关（默认）⇒ 沙盘「归因」里**不出现**流程卡点那一档", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    // 金丝雀：另外两个档在 ⇒ 档条本身是好的，"没有卡点档"不是"整条档条没渲染"
    expect(within(bar).getByTestId("sandbox-attr-tab-process-wait")).toBeInTheDocument();
    expect(within(bar).getByTestId("sandbox-attr-tab-procurement-legs")).toBeInTheDocument();

    expect(
      within(bar).queryByTestId("sandbox-attr-tab-process-stuck"),
      "暗发键关着，沙盘里却点得进流程卡点 ⇒ 一次 IA 整理把暗发键作废了（R3「功能关闭 = 不存在」）",
    ).toBeNull();
    // 不许用"禁用按钮"充数：禁用同样泄露了功能存在性（用户看得见这里有个东西没开通）
    const disabled = Array.from(bar.querySelectorAll("button")).filter((b) => b.hasAttribute("disabled"));
    expect(disabled.map((b) => b.getAttribute("data-testid")), "档条里出现了禁用按钮 —— 禁用 ≠ 不存在").toEqual([]);
    // 内容侧也不许漏（按钮没了但组件还在渲染 = 另一种绕过）
    expect(screen.queryByTestId("stuck-step")).toBeNull();
  });

  it("C2 · 开通之后那一档才出现（证明 C1 的 null 是「关着」造成的，不是这个档根本没做）", async () => {
    db.tenantOverrides["process.runtime"] = true;
    const user = userEvent.setup();
    await enterSandbox();
    const bar = await openAttributeMode(user);
    expect(
      within(bar).getByTestId("sandbox-attr-tab-process-stuck"),
      "开通了仍然没有这一档 ⇒ C1 那条否定断言是恒真的哑门",
    ).toBeInTheDocument();
  });
});
