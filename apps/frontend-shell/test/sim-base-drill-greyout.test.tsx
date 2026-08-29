import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  BASE_DRILL_BLOCKED_REASON,
  CAPACITY_FACTOR_BINDINGS,
  NETWORK_SCOPE_KEY,
  OBJECT_TYPE_BASE_DRILL,
  baseScopeOptions,
  canDrillByBase,
} from "@platform/contracts";
import { renderWithClient } from "./utils";
import { PerturbTree } from "@/views/sim/console/PerturbTree";
import { SandboxAttr } from "@/views/sim/console/SandboxAttr";

/**
 * WO-SIM-BASEDRILL-GREYOUT · 「按基地下钻」在落点类型没有基地维度时置灰。
 *
 * ── 这个文件在测什么（以及**不**测什么）────────────────────────────────────
 * 测的是「**按落点类型正确区分**」，不是「置灰的 DOM 渲染出来了」。
 * 判据来源是契约 `canDrillByBase(objectType)` —— 本文件与被测组件**都不写死类型名**，
 * 所以：
 *   · 组件改成「谁都不置灰」⇒ §2/§3 红；
 *   · 组件改成「谁都置灰」  ⇒ §1 红；
 *   · 契约表改错一行        ⇒ §1 与 §2 中对应那一条红（两侧同源但方向相反，改一边盖不住）。
 * 这三条是交单时逐条跑过的变异反证靶子。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────────────
 * `disabled` 之后浏览器是否真的**画成灰色**由 UA 默认样式决定，jsdom 不做渲染，
 * 本文件断言的是**语义**（`disabled` + `aria-disabled` 属性），不是像素。
 * 屏幕阅读器与键盘导航吃的正是这两个属性，所以语义这一层才是功能本身。
 */

afterEach(cleanup);

/** 选中某个因子（点它那一行）。 */
function pickFactor(num: number): void {
  fireEvent.click(screen.getByTestId(`sandbox-home-factor-${num}`));
}

const scopeSelect = () => screen.getByTestId("sandbox-home-scope") as HTMLSelectElement;
const baseOptions = () =>
  baseScopeOptions()
    .filter((s) => s.kind === "base")
    .map((s) => screen.getByTestId(`sandbox-home-scope-opt-${s.key}`) as HTMLOptionElement);
const networkOption = () =>
  screen.getByTestId(`sandbox-home-scope-opt-${NETWORK_SCOPE_KEY}`) as HTMLOptionElement;

describe("WO-SIM-BASEDRILL-GREYOUT · 无基地维度的因子不许假装能按基地下钻", () => {
  // ── 金丝雀：先证明尺子是活的 ────────────────────────────────────────────
  // 若册里根本没有「可下钻」或「不可下钻」的因子，下面的用例会**空跑成绿**。
  it("§0 金丝雀：册里两类因子都存在，且选项/因子行真的上了屏", () => {
    const drillable = CAPACITY_FACTOR_BINDINGS.filter((f) => canDrillByBase(f.objectType));
    const blocked = CAPACITY_FACTOR_BINDINGS.filter((f) => !canDrillByBase(f.objectType));
    expect(drillable.length, "册里一个可下钻因子都没有 ⇒ §1 会空跑成绿").toBeGreaterThan(0);
    expect(blocked.length, "册里一个不可下钻因子都没有 ⇒ §2/§3 会空跑成绿").toBeGreaterThan(0);

    renderWithClient(<PerturbTree />);
    expect(baseOptions().length, "基地选项没上屏 ⇒ 后面断言的是空集合").toBeGreaterThan(0);
    expect(baseOptions().length).toBe(baseScopeOptions().filter((s) => s.kind === "base").length);
    expect(networkOption()).toBeInTheDocument();
    // 因子行也必须真的可点，否则 pickFactor 是空操作
    expect(screen.getAllByTestId(/^sandbox-home-factor-\d+$/).length).toBe(CAPACITY_FACTOR_BINDINGS.length);
  });

  // ── §1 有基地维度的因子：一切照旧，一个像素不变 ─────────────────────────
  it("§1 落点类型有基地维度 ⇒ 基地选项照旧可选、不给原因、不置灰", () => {
    renderWithClient(<PerturbTree />);
    const drillable = CAPACITY_FACTOR_BINDINGS.filter((f) => canDrillByBase(f.objectType));

    for (const f of drillable) {
      pickFactor(f.num);
      expect(scopeSelect().getAttribute("data-base-drill"), `因子 ${f.mark} ${f.factorName} 被误置灰`).toBe("on");
      for (const opt of baseOptions()) {
        expect(opt.disabled, `因子 ${f.mark} ${f.factorName}：基地选项 ${opt.textContent} 不该置灰`).toBe(false);
        expect(opt.getAttribute("aria-disabled")).toBeNull();
      }
      expect(
        screen.queryByTestId("sandbox-home-scope-note"),
        `因子 ${f.mark} ${f.factorName} 能按基地下钻，不该给「不能」的原因`,
      ).toBeNull();
    }
  });

  // ── §2 无基地维度的因子：置灰 + 给原因，但**不隐藏** ────────────────────
  it("§2 落点类型无基地维度 ⇒ 基地选项置灰但仍在（不许隐藏），全网保持可选", () => {
    renderWithClient(<PerturbTree />);
    const blocked = CAPACITY_FACTOR_BINDINGS.filter((f) => !canDrillByBase(f.objectType));

    for (const f of blocked) {
      pickFactor(f.num);
      expect(scopeSelect().getAttribute("data-base-drill"), `因子 ${f.mark} ${f.factorName} 该置灰却没置`).toBe(
        "blocked",
      );

      const opts = baseOptions();
      expect(opts.length, "基地选项被隐藏了 —— 判据要的是置灰，隐藏=假装没这功能").toBe(
        baseScopeOptions().filter((s) => s.kind === "base").length,
      );
      for (const opt of opts) {
        expect(opt.disabled, `因子 ${f.mark} ${f.factorName}：基地选项 ${opt.textContent} 该置灰`).toBe(true);
        expect(opt.getAttribute("aria-disabled")).toBe("true");
        expect(opt.isConnected, "选项必须仍在 DOM 里（置灰≠移除）").toBe(true);
      }

      // 全网永远可选，否则下拉里一个合法选项都不剩
      expect(networkOption().disabled, "「全网」被一起置灰 ⇒ 用户被堵死在没有合法选项的下拉里").toBe(false);
      // 选中值必须回落到全网，不能停在一个选不回来的 disabled 项上
      expect(scopeSelect().value).toBe(NETWORK_SCOPE_KEY);
    }
  });

  // ── §3 原因要说人话 ─────────────────────────────────────────────────────
  it("§3 给出的原因说人话，不出现内部符号名", () => {
    renderWithClient(<PerturbTree />);
    const blocked = CAPACITY_FACTOR_BINDINGS.find((f) => !canDrillByBase(f.objectType))!;
    pickFactor(blocked.num);

    const note = screen.getByTestId("sandbox-home-scope-note");
    expect(note.textContent).toBe(BASE_DRILL_BLOCKED_REASON);
    expect(note.textContent?.length ?? 0, "原因不能是空串").toBeGreaterThan(0);

    // 用户不认识这些；出现即等于没解释
    const forbidden = ["baseId", "objectType", "prop", "null", "undefined", ...Object.keys(OBJECT_TYPE_BASE_DRILL)];
    for (const sym of forbidden) {
      expect(note.textContent ?? "", `原因里出现了内部符号名 ${sym}`).not.toContain(sym);
    }
    // tooltip 也带同一句（鼠标悬停在整个下拉上时也能读到）
    expect(scopeSelect().getAttribute("title")).toBe(BASE_DRILL_BLOCKED_REASON);
  });

  // ── §4 判据是数据驱动的，不是 if 链 ─────────────────────────────────────
  // 这是本文件最强的一条：逐个因子把「屏上的置灰态」与「契约的判据」对齐。
  // 组件里若写死类型名而契约表改了，这条会红；反之亦然。
  it("§4 逐因子：屏上置灰态 === 契约 canDrillByBase(落点类型)", () => {
    renderWithClient(<PerturbTree />);
    const seen: string[] = [];

    for (const f of CAPACITY_FACTOR_BINDINGS) {
      pickFactor(f.num);
      const blockedOnScreen = scopeSelect().getAttribute("data-base-drill") === "blocked";
      const blockedByContract = !canDrillByBase(f.objectType);
      expect(
        blockedOnScreen,
        `因子 ${f.mark} ${f.factorName}（落点 ${f.objectType}）：屏上置灰=${blockedOnScreen}，契约说该置灰=${blockedByContract}`,
      ).toBe(blockedByContract);
      seen.push(`${f.num}:${blockedOnScreen ? "blocked" : "on"}`);
    }

    // 反「全绿也全过」：两种态都必须真的出现过
    expect(seen.some((s) => s.endsWith("blocked")), "20 个因子没有一个置灰 ⇒ 断言在空转").toBe(true);
    expect(seen.some((s) => s.endsWith("on")), "20 个因子全被置灰 ⇒ 断言在空转").toBe(true);
  });

  // ── §5 选中的基地在切到不可下钻因子后要收回，切回来不该崩 ────────────────
  it("§5 已选某基地后切到不可下钻因子 ⇒ 值回落全网；切回可下钻因子 ⇒ 基地重新可选", () => {
    renderWithClient(<PerturbTree />);
    const drillable = CAPACITY_FACTOR_BINDINGS.find((f) => canDrillByBase(f.objectType))!;
    const blocked = CAPACITY_FACTOR_BINDINGS.find((f) => !canDrillByBase(f.objectType))!;
    const someBase = baseScopeOptions().find((s) => s.kind === "base")!;

    pickFactor(drillable.num);
    fireEvent.change(scopeSelect(), { target: { value: someBase.key } });
    expect(scopeSelect().value).toBe(someBase.key);

    pickFactor(blocked.num);
    expect(scopeSelect().value, "停在一个 disabled 的基地上 ⇒ 用户再也选不回来").toBe(NETWORK_SCOPE_KEY);

    pickFactor(drillable.num);
    for (const opt of baseOptions()) expect(opt.disabled).toBe(false);
    expect(screen.queryByTestId("sandbox-home-scope-note")).toBeNull();
  });

  // ── §6 契约层：登记覆盖度（漏登记一个落点类型即红）───────────────────────
  it("§6 册里每个落点对象类型都在下钻能力表里登记过", () => {
    const types = [...new Set(CAPACITY_FACTOR_BINDINGS.map((f) => f.objectType))];
    expect(types.length, "落点类型集合为空 ⇒ 这条在空转").toBeGreaterThan(0);
    for (const t of types) {
      expect(
        Object.prototype.hasOwnProperty.call(OBJECT_TYPE_BASE_DRILL, t),
        `落点类型 ${t} 没在 OBJECT_TYPE_BASE_DRILL 里登记 ⇒ 会静默按「不可下钻」处理`,
      ).toBe(true);
    }
  });

  // ── §7 两张页共用同一份选项集（防副本漂移）──────────────────────────────
  it("§7 两处范围下拉同源：选项文案与顺序逐条相同", () => {
    const { unmount } = renderWithClient(<PerturbTree />);
    const home = [...scopeSelect().querySelectorAll("option")].map((o) => o.textContent);
    unmount();

    renderWithClient(<SandboxAttr />);
    const attr = [...(screen.getByTestId("sandbox-attr-scope") as HTMLSelectElement).querySelectorAll("option")].map(
      (o) => o.textContent,
    );

    expect(home.length, "选项集为空 ⇒ 这条在空转").toBeGreaterThan(1);
    expect(attr).toEqual(home);
    expect(home).toEqual(baseScopeOptions().map((s) => s.label));
  });
});
