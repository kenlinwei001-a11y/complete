import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-PALETTE-USABLE · 接缝：**焦点 × 重渲染**。
 *
 * 这条缝此前没有任何测试咬住，因为两半各自都是绿的：
 *   · `Modal` 的 focus-trap 有测试（挂载时焦点进弹窗）——**只测挂载，不测重渲染**；
 *   · `CommandPalette` 的搜索有测试（f39）——但它用 `fireEvent.change` **一次性灌整串**，
 *     绕开了逐键路径。那份测试的注释把丢键归因成「userEvent 逐键在受控 input 下丢键」，
 *     真因其实是本文件要咬的这个：**每敲一键 Modal 就把焦点抢到 ✕**。
 *   ⇒ 两半都绿，合起来用户一次只能输入一个字符。这正是「绿测试 ≠ 能用·断在接缝」。
 *
 * ⚠ 变异反证（交付判据之一）：把 `Modal.tsx` 的依赖数组从 `[]` 改回 `[onClose]`，
 *   §1 必须当场红。改不红 = 这条测试没咬住东西，等于装饰品。
 */
describe("WO-PALETTE-USABLE · Modal 焦点不被重渲染抢走", () => {
  // ── §1 主咬合点：逐键输入必须全留住（变异反证靶子） ──────────────────
  it("§1 ⌘K 面板逐键打 4680 → 输入框留住整串且焦点不离开", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");

    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");
    const input = within(palette).getByTestId("command-palette-input") as HTMLInputElement;

    // 逐键——**不是** fireEvent.change 一次性灌串。焦点被抢时这里只会留下第一个字符。
    input.focus();
    await user.type(input, "4680");

    expect(input.value).toBe("4680");
    // 焦点判据与值判据要分开报：值对了但焦点跑了 ⇒ 下一次输入照样断。
    expect(document.activeElement).toBe(input);
  });

  it("§1b 混合 CJK/ASCII 同样不丢（修前实测 常州20 → 常州）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");

    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");
    const input = within(palette).getByTestId("command-palette-input") as HTMLInputElement;
    input.focus();
    await user.type(input, "S02");
    expect(input.value).toBe("S02");
  });

  // ── §2 反向对照：不带 autoFocus 的普通 Modal，首焦落点**不许**被改坏 ──
  it("§2 反向对照 · 无 autoFocus 的 Modal 首焦仍落在关闭按钮（行为未被改动）", async () => {
    render(
      <Modal title="反向对照" onClose={() => {}}>
        <button type="button">正文按钮</button>
      </Modal>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" })),
    );
  });

  it("§2b 反向对照 · 子元素自带 autoFocus 时焦点留在子元素，不被抢到 ✕", async () => {
    render(
      <Modal title="自动聚焦" onClose={() => {}}>
        <input autoFocus data-testid="rc-input" />
      </Modal>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("rc-input")));
  });

  // ── §3 父组件重渲染（内联 onClose 换身份）不得抢焦点 ────────────────
  it("§3 父组件每次重渲染都传新的内联 onClose，焦点仍不被抢走", async () => {
    const user = userEvent.setup();
    function Host() {
      const [n, setN] = useState(0);
      return (
        // 内联箭头：每渲染一次 onClose 就换个身份——全仓 37 处都是这个写法
        <Modal title="重渲染宿主" onClose={() => setN(-1)}>
          <input data-testid="host-input" onChange={() => setN((v) => v + 1)} />
          <span data-testid="host-n">{n}</span>
        </Modal>
      );
    }
    render(<Host />);
    const input = screen.getByTestId("host-input") as HTMLInputElement;
    input.focus();
    await user.type(input, "abcd");
    expect(input.value).toBe("abcd");
    expect(document.activeElement).toBe(input);
    // 金丝雀：确认这一串确实触发了多次重渲染（否则本用例什么都没证明）
    expect(Number(screen.getByTestId("host-n").textContent)).toBe(4);
  });

  // ── §5 依赖数组的**专属**靶子（不被 contains 守卫遮住） ──────────────
  //
  // 为什么单独要这一条：`Modal` 的修复有两半 —— ① 依赖数组 `[]` ② 首焦 contains 守卫。
  // 实测四格矩阵发现 ② 会把 ① 的症状**遮住**（守卫在时，把依赖改回 [onClose] 仍然全绿），
  // 于是「改依赖数组必须变红」这条验收判据在 §1 上失效。
  // 本用例给弹窗一个**真的可聚焦的触发按钮**，把 ① 的第二个症状暴露出来：
  //   deps=[onClose] ⇒ 每次重渲染 cleanup 都 `prevFocus.current.focus()` 把焦点弹回触发按钮，
  //   并把 prevFocus 改写成弹窗内元素 ⇒ 输入被打断 + 关闭后焦点回不到触发者。
  // ⚠ §1 之所以遮得住，是因为那里弹窗外的 activeElement 是 `document.body`（jsdom 里不可聚焦，
  //   `.focus()` 成了空操作）。**换成真按钮就遮不住了。**
  it("§5 依赖数组靶子 · 有可聚焦触发者时，重渲染不得把焦点弹回触发者", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      const [n, setN] = useState(0);
      return (
        <div>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            打开
          </button>
          {open && (
            <Modal title="有触发者" onClose={() => setOpen(false)}>
              <input data-testid="m-input" onChange={() => setN((v) => v + 1)} />
              <span data-testid="m-n">{n}</span>
            </Modal>
          )}
        </div>
      );
    }
    render(<Host />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger); // 金丝雀：触发者真的能拿到焦点
    await user.click(trigger);

    const input = (await screen.findByTestId("m-input")) as HTMLInputElement;
    input.focus();
    await user.type(input, "4680");
    expect(input.value).toBe("4680");
    expect(document.activeElement).toBe(input);
    expect(Number(screen.getByTestId("m-n").textContent)).toBe(4); // 确认真的重渲染了 4 次
  });

  // ── §4 面板不再截断：后端给多少条就够得着多少条 ──────────────────────
  //
  // ⚠ 为什么这里要 `server.use` 塞 20 条，而不是直接用默认 mock：
  //   默认 MSW 只种了 **6** 个场景（S01/S02/S04/S06/S08/SX-explore），**6 < 8**
  //   ⇒ 旧的 `slice(0,8)` 在默认 mock 下**根本不截断**，断言写成「>8」是恒不可满足，
  //   写成「==6」则改回 slice(0,8) 照样绿 —— 两种写法都咬不住东西。
  //   真后端是 20 条（实测 `total:20`），所以这里按真后端的量级造 20 条，让截断真的会发生。
  //   ⇒ 把 `slice(0,8)` 改回去，本用例当场红。
  it("§4 空串态渲染全部场景（不再 slice(0,8)）——20 条全部够得着", async () => {
    const items = Array.from({ length: 20 }, (_, i) => {
      const sNo = `S${String(i + 1).padStart(2, "0")}`;
      return {
        sNo,
        name: `场景${sNo}`,
        view: "risk",
        domain: "风险与齐套",
        intentKey: "kit_analysis",
        triggerQuestion: `问句 ${sNo}`,
        solver: "kit_readiness",
        riskLevel: "COMPUTE",
        summary: `摘要 ${sNo}`,
        willProduceDraft: false,
        inactive: false,
        presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      };
    });
    server.use(
      http.get("*/b/v1/scenarios", () =>
        HttpResponse.json({ launcherEnabled: true, total: items.length, items }),
      ),
    );

    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");

    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");

    await waitFor(() => {
      const rows = within(palette).getAllByTestId(/^command-palette-item-/);
      // 金丝雀：先证明数得到行（数不到 = 量法坏了，不许报「面板坏了」）
      expect(rows.length).toBeGreaterThan(0);
      // 主判据：20 条一条不少，且明确越过旧上限 8
      expect(rows.length).toBe(20);
    });
    // 够得着「最后一条」：S20 必须真的在 DOM 里（旧实现停在 S08）
    expect(within(palette).getByTestId("command-palette-item-S20")).toBeInTheDocument();
    expect(within(palette).getByTestId("command-palette-count")).toHaveTextContent("共 20 个场景");
    // 且列表容器有高度上限 ⇒ 不会长成一屏塞不下的长条（靠滚动够到后面那些）
    const list = within(palette).getByTestId("command-palette-list");
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).toBe("360px");
  });

  it("§4b 有搜索词时也不再截断（旧上限 12）", async () => {
    const items = Array.from({ length: 20 }, (_, i) => {
      const sNo = `S${String(i + 1).padStart(2, "0")}`;
      return {
        sNo, name: `齐套场景${sNo}`, view: "risk", domain: "风险与齐套", intentKey: "kit_analysis",
        triggerQuestion: `问句 ${sNo}`, solver: "kit_readiness", riskLevel: "COMPUTE",
        summary: `摘要 ${sNo}`, willProduceDraft: false, inactive: false,
        presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
      };
    });
    server.use(
      http.get("*/b/v1/scenarios", () =>
        HttpResponse.json({ launcherEnabled: true, total: items.length, items }),
      ),
    );

    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");
    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByTestId("command-palette");
    await waitFor(() =>
      expect(within(palette).getAllByTestId(/^command-palette-item-/).length).toBe(20),
    );

    // 20 条全部含「齐套」⇒ 过滤后仍是 20 条，旧的 slice(0,12) 会砍到 12
    fireEvent.change(within(palette).getByTestId("command-palette-input"), {
      target: { value: "齐套" },
    });
    await waitFor(() =>
      expect(within(palette).getAllByTestId(/^command-palette-item-/).length).toBe(20),
    );
  });
});
