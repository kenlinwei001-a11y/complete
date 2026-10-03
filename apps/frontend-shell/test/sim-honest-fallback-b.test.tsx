import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { loginAs, renderWithClient } from "./utils";
import type { ImpactChange } from "@platform/contracts";
import {
  CONE_EMPTY_CELL,
  CONE_EMPTY_REASON,
  ImpactCone,
  PLACEHOLDER_CONE,
  projectImpactCone,
  useImpactCone,
} from "@/views/sim/console/ImpactCone";
import {
  SandboxDetail,
  detailPlaceholderNote,
  type NodeDetailProvenance,
} from "@/views/sim/console/SandboxDetail";
import { SandboxOpt } from "@/views/sim/console/SandboxOpt";

/**
 * ══ WO-SIM-HONEST-FALLBACK-B · 「屏上看得出这是占位」的接缝门 ══════════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y（本单开工前实测）──────────────────────────
 *
 * **X**：第一批 A 收拾的是归因台与策略卡。剩下这三页（影响半径扇区 / 传导识别页 /
 * 方案寻优页）里，占位与真数据的分界**只写进 `data-source` / `data-prov` 属性**，
 * 三份源码的文件头都白纸黑字写着同一句理由：
 * 「provenance 走属性而不是屏上文字：本页验收线是像素级 1:1，
 *   往版面里塞一行「占位」会当场破坏它；属性对测试可见、对像素不可见。」
 * 后半句是真的，前半句的代价是：**属性用户看不见**。于是屏上画着
 * `18:12`（影响半径）· `39°`（张角）· `P4211…P4214`（传导标记）· `400/300/200/100`（刻度）·
 * 14 行传导识别表 · 9 个时间刻度 · 一整套帕累托方案与雷达 —— 全部抄自设计稿，
 * 而用户无从分辨它是不是这次推演算出来的。这正是本仓点名的「静默错答」。
 *
 * **Y**：仓主 2026-08-09 裁定二（`scripts/check-debattery.mjs` 探测器 B 的报错文案原话）：
 * > 数据必须来自一次真实 API 调用。真没有的数据返回诚实空 + reason，不许兜底编一个。
 * 本单按派单给的三态表逐条落：
 *   · **压根没有数据源**（半径/张角/刻度/标记）⇒ 落**诚实空态**：印 `—` + 一句人话；
 *   · **规格占位**（传导识别页与寻优页那几张设计稿表）⇒ 保留数值，
 *     但**屏上加显式占位标记**（横幅），因为把它们全清成 `—` 得到的是空白页，
 *     而派单原话：「诚实空态 ≠ 空白页；用户看到的必须是『这里暂无数据/这是示例』」。
 *
 * ── 这道门咬的是**屏上**，不是属性 ──────────────────────────────────────────
 * 断言一律落在 `textContent`（用户读得到的地方）。**本单要消灭的那个态里
 * `data-source` 一直是对的** —— 拿它当判据，改造前后都绿，等于没测。
 * 同一条纪律见第一批 A 的 `sim-honest-fallback.test.tsx` 头注。
 *
 * ── 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）────────────────────────────
 * 用例 ⓪ 先证明探针本身是好的：已知必中的选择器要中、已知必不中的要落空，
 * 且三条文案**互不相同**（相同就等于三态从源头分不开，后面每一条都在空转）。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 桩
// ══════════════════════════════════════════════════════════════════════════

const IMPACT_PATH = "*/a/v1/simulation/impact-analysis";

/** 只答 `affectedProcesses` 这一维 —— 那正是扇区图唯一有真出处的一列。 */
const IMPACT_WITH_PROCESSES = {
  affectedProcesses: {
    available: true as const,
    items: [{ name: "接缝桩·甲工序" }, { name: "接缝桩·乙工序" }],
  },
};

/** 改造前屏上那几个**编出来的**读数。它们一个都不许再出现。 */
const FABRICATED = ["18:12", "39°", "P4211", "P4212", "P4213", "P4214", "400", "300", "200", "100"];

/** 扇区图的"真数据"臂需要一个会自己发请求的宿主（`useImpactCone` 是 hook，`it()` 里不能直接调）。 */
const SEAM_CHANGE: ImpactChange = {
  objectType: "Base",
  objectId: "obj_base_changzhou",
  prop: "capacity",
} as ImpactChange;

function ImpactConeLive(): JSX.Element {
  const { model, source } = useImpactCone({ worldId: "w_seam", change: SEAM_CHANGE });
  return <ImpactCone model={model} source={source} />;
}

beforeEach(() => {
  // 不登录 ⇒ 401 ⇒ apiClient 触发全局跳登录，jsdom 报一串 "Not implemented: navigation"。
  loginAs("planner");
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 影响半径扇区 —— 「压根没有数据源」那一态
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-HONEST-FALLBACK-B · 屏上看得出这是占位（三条页各一条臂）", () => {
  it("⓪ 探针先自证：已知必中的要中、已知必不中的要落空，且三条文案互不相同", () => {
    renderWithClient(<ImpactCone model={PLACEHOLDER_CONE} source="placeholder" />);

    // 已知必中：扇区图一定渲染（空态也渲染，只是内容不同）。
    expect(screen.getByTestId("sandbox-detail-cone")).not.toBeNull();
    // 已知必不中：这个 testid 全仓没有 ⇒ 探针必须落空（证明它不是"什么都返回一个元素"）。
    expect(document.querySelector('[data-testid="sandbox-detail-cone-no-such-thing"]')).toBeNull();

    // 三条屏上文案两两不同 —— 这是后面每条臂能分得开的前提。
    const notes = [
      CONE_EMPTY_REASON,
      detailPlaceholderNote(allPlaceholder()),
      detailPlaceholderNote(cardAndFlowLive()),
    ];
    expect(new Set(notes).size, "屏上文案有重复 ⇒ 几种态从源头就分不开").toBe(notes.length);
    // 一条内部符号名都不许出现在屏上文案里（用户不认识，写了等于没解释）。
    for (const n of notes) {
      expect(n).not.toBeNull();
      expect(n as string).not.toMatch(/sessionId|nodeId|placeholder|endpoint|provenance/i);
    }
  });

  it("① 端点没有这几个量 ⇒ 屏上是 `—` + 一句人话，且**编出来的那几个数一个都不在**", () => {
    renderWithClient(<ImpactCone model={PLACEHOLDER_CONE} source="placeholder" />);
    const cone = screen.getByTestId("sandbox-detail-cone");
    const text = cone.textContent ?? "";

    // (a) 原因写在**用户读得到**的地方，不是 data-*。
    expect(screen.getByTestId("sandbox-detail-cone-note").textContent).toBe(CONE_EMPTY_REASON);
    // (b) 半径那一格印 `—`，不是 `0`——「没有数」和「数是 0」是两个相反的结论。
    expect(PLACEHOLDER_CONE.radiusLabel).toBe(CONE_EMPTY_CELL);
    expect(PLACEHOLDER_CONE.angleLabel).toBe(CONE_EMPTY_CELL);
    // (c) 版面没塌：刻度与标记的**槽位**还在（否则这就是"删空"而不是"诚实空"）。
    expect(PLACEHOLDER_CONE.ticks.length, "刻度槽位被删空 ⇒ 版面塌了").toBeGreaterThan(0);
    expect(PLACEHOLDER_CONE.markers.length, "标记槽位被删空 ⇒ 版面塌了").toBeGreaterThan(0);
    for (const t of PLACEHOLDER_CONE.ticks) expect(t).toBe(CONE_EMPTY_CELL);
    for (const m of PLACEHOLDER_CONE.markers) expect(m.label).toBe(CONE_EMPTY_CELL);
    // (d) 编出来的那几个读数一个都不许再上屏。
    for (const f of FABRICATED) expect(text, `屏上仍印着编出来的 ${f}`).not.toContain(f);
    // (e) 没有任何一个标记被指成"热点"——不知道就别指一个出来。
    expect(PLACEHOLDER_CONE.hotMarkerIndex).toBeLessThan(0);
  });

  it("② 端点答了 ⇒ 三条冲击换成回包里的名字，而那句人话**照旧留着**（只接了一半就得说一半）", async () => {
    server.use(http.post(IMPACT_PATH, () => HttpResponse.json(IMPACT_WITH_PROCESSES)));
    renderWithClient(<ImpactConeLive />);

    await waitFor(() =>
      expect(screen.getByTestId("sandbox-detail-cone").getAttribute("data-source")).toBe("impact-analysis"),
    );
    const text = screen.getByTestId("sandbox-detail-cone").textContent ?? "";
    // 逐值对拍：屏上出现的就是回包里那两个名字。
    for (const it0 of IMPACT_WITH_PROCESSES.affectedProcesses.items) expect(text).toContain(it0.name);
    // **关键的一条**：换真的只有冲击这一列，半径/张角仍无源 ⇒ 那句人话不许消失。
    expect(screen.getByTestId("sandbox-detail-cone-note").textContent).toBe(CONE_EMPTY_REASON);
    // 且仍然一个编出来的读数都没有。
    for (const f of FABRICATED) expect(text, `真数据态下屏上仍印着编出来的 ${f}`).not.toContain(f);
  });

  it("③ 投影函数：端点这一维缺席 / 为空 ⇒ 回空态模型（不许把「没答」画成「0 条」）", () => {
    expect(projectImpactCone(undefined)).toEqual(PLACEHOLDER_CONE);
    expect(projectImpactCone({ affectedProcesses: { available: false } } as never)).toEqual(PLACEHOLDER_CONE);
    expect(projectImpactCone({ affectedProcesses: { available: true, items: [] } } as never)).toEqual(
      PLACEHOLDER_CONE,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 传导识别页 —— 「规格占位（已标注）」那一态
// ══════════════════════════════════════════════════════════════════════════

/** 全格皆占位（宿主一个参数都没给时的真实态）。 */
function allPlaceholder(): NodeDetailProvenance {
  return {
    card: "placeholder",
    flow: "placeholder",
    flowTime: "placeholder",
    conduction: "placeholder",
    chrome: "placeholder",
  };
}

/** 端点答了卡与流转明细，其余仍无源（`projectNodeDetail` 的真实产物形状）。 */
function cardAndFlowLive(): NodeDetailProvenance {
  return { ...allPlaceholder(), card: "endpoint", flow: "endpoint" };
}

describe("WO-SIM-HONEST-FALLBACK-B · 传导识别页的页级占位横幅", () => {
  it("④ 宿主不给参数 ⇒ 屏上有一条**用户读得到**的横幅说「这一页的数不是本次推演算出来的」", () => {
    renderWithClient(<SandboxDetail />);
    const banner = screen.getByTestId("sandbox-detail-placeholder");
    expect(banner.textContent ?? "").toContain("示例");
    // 断言落在屏上文字，不落在 data-source —— 后者改造前就是对的，拿它当判据等于没测。
    expect(banner.textContent).toBe(detailPlaceholderNote(allPlaceholder()));
  });

  it("⑤ 「全是示例」与「一半是示例」必须是**两句不同的话**（混成一句 = 又回到本单要消灭的态）", () => {
    const all = detailPlaceholderNote(allPlaceholder());
    const partial = detailPlaceholderNote(cardAndFlowLive());
    expect(all).not.toBeNull();
    expect(partial).not.toBeNull();
    expect(all).not.toBe(partial);
    // 反向：真到了「哪一格都不是占位」那天，这句话必须自己消失（不许变成常驻噪声）。
    expect(
      detailPlaceholderNote({
        card: "endpoint",
        flow: "endpoint",
        flowTime: "endpoint",
        conduction: "endpoint",
        chrome: "endpoint",
      } as unknown as NodeDetailProvenance),
    ).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 方案寻优页 —— 同一态、另一页
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-HONEST-FALLBACK-B · 方案寻优页的占位横幅", () => {
  it("⑥ 宿主不给寻优请求 ⇒ 顶栏印「示例数据」，且它**只在占位态**出现", () => {
    renderWithClient(<SandboxOpt />);
    const badge = screen.getByTestId("sandbox-opt-placeholder");
    expect(badge.textContent ?? "").toContain("示例");
    // 金丝雀：这一页确实处于占位态（否则上面那条在"根本没渲染横幅"的情形下也会红，方向就反了）。
    expect(screen.getByTestId("sandbox-opt").getAttribute("data-source")).toBe("placeholder");
  });
});

