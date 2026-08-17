import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { fetchPropagationRules } from "@/api/endpoints";
import {
  buildDomainSlices,
  buildEdgeRows,
  resolveActiveSlice,
  UNASSIGNED_DOMAIN_LABEL,
  UNASSIGNED_SLICE_ID,
} from "@/views/sim/edgeActiveModel";

/**
 * ══ WO-DISRUPTION-CARDS · 扰动因素按业务域分类卡片 ══════════════════════════════════
 *
 * 仓主原话：「**按照卡片，建立不同扰动因素的分类展示**」。
 * 病灶：推演页把传导边**一次全倒在屏上**（demo 租户实测 35 条），无分类、无栅格、字号过小。
 *
 * ── 本门咬的四条（各堵一种假绿）──────────────────────────────────────────────────
 *  ① **分组正确性**：屏上某域 chip 上的条数 == 数据里该域的规则数。
 *     ⚠ **两边都从数据现算，一个数字都不写死** —— 这条专咬「前端手抄一份规则→域映射表」那个病
 *     （本体 §8 `G-GATE-ROSTER-HANDCOPIED`：手抄名单里没有的对象**永远绿、永远漏**）。
 *     期望值取自 `GET /a/v1/sim/propagation-rules` 的**真响应**，不是本文件里的常量。
 *  ② **切片有效**：点 chip A 只出 A 的行，B 的行不出现。
 *     ⚠ 判据同时落在**可见性**与 DOM 存在性上：本仓已有 dev 在这条上栽过 ——
 *     `<details>` 折叠时子节点**照样在 DOM 里**，只判 DOM 存在性的测试会永远绿。
 *     本实现用条件渲染（不是折叠），所以两条判据都该成立；两条都断，实现哪天改成折叠也拦得住。
 *  ③ **拨动仍生效**：分类之后关掉一条边，**结果的数真的变了** ——
 *     ⚠ 断的是差值表里那个数，**不是**「勾选框的 checked 变了」（后者只证明 React 受控组件没坏）。
 *  ④ **变异反证**：把域字段拆掉 ⇒ ① 必须红在「条数对不上」，不是红在「组件不见了」。
 *
 * 走的是真链路：`renderApp("/v/project-sim")` → 真 router → 真 renderer → 真 MSW URL 拦截。
 * 不 mock `@/api/endpoints`（mock 掉它就把病灶那一跳一起 mock 掉了）。
 */

/** 面板挂在 `project-sim` 页上的 testid 前缀（与 `EdgeActivePanel` 的 `pageKey` 一致）。 */
const PAGE = "project-sim";
const tid = (s: string) => `edge-active-${PAGE}-${s}`;

/** 从**真响应**现算「每个域几条边」——这是 ① 的期望值来源，绝不写死。 */
async function domainCountsFromData(): Promise<Map<string, number>> {
  const { items } = await fetchPropagationRules(true);
  const m = new Map<string, number>();
  for (const r of items) {
    const k = r.domainKey ?? UNASSIGNED_SLICE_ID;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

describe("WO-DISRUPTION-CARDS · 扰动因素按域分片的卡片", () => {
  // ── 金丝雀：先自证「数据里真有多个域」──────────────────────────────────────────
  // 不跑它就没资格把下面的"切片有效"读成结论：若 fixture 里所有边都在同一个域，
  // 一片装下全部 ⇒ ② 恒绿而什么都没证明（铁律 0.6：金丝雀证明工具没瞎，也证明扫描面选对了）。
  it("金丝雀：fixture 真的横跨 ≥2 个域且含未归域（否则下面的切片判据恒绿）", async () => {
    loginAs("planner");
    const counts = await domainCountsFromData();
    expect(counts.size).toBeGreaterThanOrEqual(2);
    // 未归域在真后端里是**真实存在**的一态（demo 实测 35 条里 3 条），mock 必须也造得出来，
    // 否则那条分片的渲染路径一次都没被测试走过。
    expect(counts.has(UNASSIGNED_SLICE_ID)).toBe(true);
    // 反面：不许某一片装下全部（那等于没切）。
    expect(Math.max(...counts.values())).toBeLessThan([...counts.values()].reduce((a, b) => a + b, 0));
  });

  // ── ① 分组正确性：chip 上的条数 == 数据里该域的规则数（两边都现算）──────────────────
  it("🔴 分组：每个 chip 的条数 == 数据里该域的边数；chip 集合 == 数据里的域集合（零写死）", async () => {
    loginAs("planner");
    renderApp(`/v/${PAGE}`);
    const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 5000 });
    const expected = await domainCountsFromData();

    const bar = within(panel).getByTestId(tid("domains"));
    const chips = within(bar).getAllByRole("tab");

    // 域**集合**相等（不是数量相等）：数量相等会被"多一个域 + 少一个域"互相抵消掉。
    const onScreen = chips.map((c) => c.getAttribute("data-testid")!.replace(tid("domain-"), "")).sort();
    expect(onScreen).toEqual([...expected.keys()].sort());

    // 逐片条数相等。屏上的数取 chip 自己渲染的文本节点，不是 `data-count`——
    // 断在 `data-count` 上等于断"我传给自己的那个值"，用户看到的那个数没被验过。
    for (const chip of chips) {
      const key = chip.getAttribute("data-testid")!.replace(tid("domain-"), "");
      expect(`${key}:${chip.textContent?.replace(/\D+/g, "")}`).toBe(`${key}:${expected.get(key)}`);
    }
  });

  // ── ② 切片有效：点一个 chip 只出那一片的行（可见性 + DOM 双判据）───────────────────
  it("🔴 切片：点某个域的 chip ⇒ 只出该域的行；别的域的行既不可见、也不在 DOM 里", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp(`/v/${PAGE}`);
    const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 5000 });
    const { items } = await fetchPropagationRules(true);

    const bar = within(panel).getByTestId(tid("domains"));
    const chips = within(bar).getAllByRole("tab");
    // 至少两片才谈得上"切"；金丝雀已保证，这里再挡一次（下界断言，防 fixture 塌掉后静默变绿）。
    expect(chips.length).toBeGreaterThanOrEqual(2);

    for (const chip of chips) {
      const sliceId = chip.getAttribute("data-testid")!.replace(tid("domain-"), "");
      await user.click(chip);

      const mine = items.filter((r) => (r.domainKey ?? UNASSIGNED_SLICE_ID) === sliceId).map((r) => r.key);
      const others = items.filter((r) => (r.domainKey ?? UNASSIGNED_SLICE_ID) !== sliceId).map((r) => r.key);
      expect(mine.length).toBeGreaterThan(0); // 空片说明上面那个 sliceId 抽错了，不是"这片就是空的"

      for (const k of mine) {
        const row = within(panel).getByTestId(tid(`edge-${k}`));
        // 判据 ①：在 DOM 里。判据 ②：**真的可见**（`<details>` 折叠时 ① 成立而 ② 不成立）。
        expect(row).toBeVisible();
        expect(row.getAttribute("data-domain")).toBe(sliceId);
      }
      for (const k of others) {
        // 条件渲染 ⇒ 不在 DOM 里。若哪天改成折叠实现，这条会红 —— 那正是它该做的：
        // 逼实现方把"看不见"做实，而不是把行留在 DOM 里假装切过片。
        expect(within(panel).queryByTestId(tid(`edge-${k}`))).toBeNull();
      }
    }
  });

  // ── ③ 拨动仍生效：分类之后关掉一条边，**结果的数**变了 ────────────────────────────
  it("🔴 拨动：切片之后关掉一条边 ⇒ 差值表出现带方向与量级的数（断的是数，不是勾选框）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp(`/v/${PAGE}`);
    const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 5000 });
    const { items } = await fetchPropagationRules(true);

    /**
     * 挑哪条边不是随便挑的 —— 必须挑一条在 MSW 世界里**真的会触发**的边。
     *
     * ⚠ 初稿写的是 `items.find(r => r.domainKey !== null)`（"随便挑一条有域的"），实测当场红：
     * 挑中的 `seed_line_to_base` 源态在 mock 世界里恒为 0 ⇒ 关掉它差值为空，
     * 后端诚实回 NO_EFFECT。**那不是本条要验的东西**：本条验的是"分类之后拨动仍生效"，
     * 拿一条本来就不动的边去验，红了也只说明我挑错了边，绿了更什么都不说明。
     * `mock_a_to_b` 是 fixture 里唯一源态非零那条（`TypeA#0.s1 = 60`，见 handlers.ts 的世界态桩），
     * 与 `edge-active.seam.test.tsx` 的 `EDGE_A` 是同一条 —— 取的是**fixture 身份**，不是业务名册。
     */
    const target = items.find((r) => r.key === "mock_a_to_b");
    expect(target).toBeDefined();
    // 它必须**有域**（顺带证明"归了域的边照样能拨"，不是只有未归域那片可用）。
    // 域值从响应现算，不写死 —— fixture 改域时这里跟着走，不会变成假绿。
    expect(target!.domainKey).not.toBeNull();
    const sliceId = target!.domainKey as string;

    await user.click(within(panel).getByTestId(tid(`domain-${sliceId}`)));
    // 差值表在拨之前**不该存在**（否则下面"出现了"就不是这次拨动的功劳）。
    expect(within(panel).queryByTestId(tid("diff"))).toBeNull();

    await user.click(within(panel).getByTestId(tid(`toggle-${target!.key}`)));

    const diff = await within(panel).findByTestId(tid("diff"), {}, { timeout: 5000 });
    // 🔴 判据落在**数**上：至少一格带方向记号 + 一个非零量级。
    // 断"勾选框 checked 变了"只证明受控组件没坏，证明不了"关掉这条边真的改变了推演结果"。
    const bodyText = diff.textContent ?? "";
    expect(/[↑↓]/.test(bodyText)).toBe(true);
    expect(/[+−]\d/.test(bodyText)).toBe(true);

    // 结论句必须是"有变化"那一支，不是两种"没变"的诚实缺席之一。
    expect(within(panel).getByTestId(tid("verdict")).textContent).toContain("发生变化");
    // 关掉的边**没有从这一片里消失**，只是降级（§3.3：消失了用户就不知道自己关了什么）。
    const row = within(panel).getByTestId(tid(`edge-${target!.key}`));
    expect(row.getAttribute("data-active")).toBe("false");
    expect(within(panel).getByTestId(tid(`off-${target!.key}`)).textContent).toContain("已关闭");
  });

  // ── ④ 变异反证：拆掉域字段 ⇒ 分组必须红在「条数对不上」───────────────────────────
  it("变异反证：抹掉 domainKey ⇒ 分片塌成一片「未归域」，与真数据的分片对不上（不是组件不见了）", async () => {
    loginAs("planner");
    const { items } = await fetchPropagationRules(true);

    const real = buildDomainSlices(buildEdgeRows(items, []));
    // 变异：模拟"域字段被拆掉 / 新增规则没归域"。
    const mutated = buildDomainSlices(buildEdgeRows(items.map((r) => ({ ...r, domainKey: null, domainName: null })), []));

    // 🔴 红的形态必须是**分片对不上**，而不是"组件渲染不出来"：
    //    变异后组件照样能渲染（一片、全部行都在），但分片结构与真数据完全不同。
    expect(mutated.length).toBe(1);
    expect(mutated[0]!.sliceId).toBe(UNASSIGNED_SLICE_ID);
    expect(mutated[0]!.name).toBe(UNASSIGNED_DOMAIN_LABEL);
    expect(mutated[0]!.count).toBe(items.length); // 行一条没少 —— 少了才是"组件坏了"
    expect(mutated.map((s) => `${s.sliceId}:${s.count}`)).not.toEqual(real.map((s) => `${s.sliceId}:${s.count}`));

    // 最小变异：只改**一条**边的域，分片结构照样要变（证明 ① 不是"大面积错才看得见"的粗判据）。
    const one = buildDomainSlices(
      buildEdgeRows(items.map((r, i) => (i === 0 ? { ...r, domainKey: "D99", domainName: "不存在的域" } : r)), []),
    );
    expect(one.map((s) => `${s.sliceId}:${s.count}`)).not.toEqual(real.map((s) => `${s.sliceId}:${s.count}`));
  });

  // ── ⑤ 纯模型：切片全序 · count 恒等于 rows.length · 选中态受控回落 ─────────────────
  it("纯模型：buildDomainSlices 按域 key 全序、未归域垫底、count 恒等于 rows.length；resolveActiveSlice 受控回落", () => {
    const mk = (key: string, domainKey: string | null, domainName: string | null) => ({
      id: `id_${key}`, tenantId: "demo", key, sourceTypeKey: "T", sourceStateVar: "s", viaLinkKey: "l",
      targetTypeKey: "U", targetStateVar: "t", coefficient: 1, delayTicks: 0,
      combine: "sum" as const, decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null,
      status: "PUBLISHED" as const, domainKey, domainName,
      // 类型人话名是**读时投影**（后端 join 本体）；纯模型用例不验它，给 null ⇒ 行主标题回落显裸键。
      sourceTypeName: null as string | null, targetTypeName: null as string | null,
    });
    const rows = buildEdgeRows([mk("c", null, null), mk("b", "D02", "乙"), mk("a", "D01", "甲"), mk("d", "D01", "甲")], []);
    const slices = buildDomainSlices(rows);

    // 全序：域 key 升序，未归域**恒垫底**（它不是一个业务域，混进字母序会让人以为它与域平级）。
    expect(slices.map((s) => s.sliceId)).toEqual(["D01", "D02", UNASSIGNED_SLICE_ID]);
    // count 与 rows.length 不许分家 —— 分家就会出现"chip 写 2 条、点开只有 1 行"。
    for (const s of slices) expect(`${s.sliceId}:${s.count}`).toBe(`${s.sliceId}:${s.rows.length}`);
    expect(slices.map((s) => s.count)).toEqual([2, 1, 1]);
    // 一条边都不许在切片过程中丢掉（本单最怕的形态：边从分类里凭空消失）。
    expect(slices.flatMap((s) => s.rows.map((r) => r.key)).sort()).toEqual(["a", "b", "c", "d"]);
    // 缺域名时显 key 原文，**不编一个中文名**（诚实缺席）。
    expect(buildDomainSlices(buildEdgeRows([mk("x", "D07", null)], []))[0]!.name).toBe("D07");

    // 受控回落：没选过 ⇒ 第一片；选中的还在 ⇒ 保持；选中的没了 ⇒ 回落第一片（不是"什么都不显示"）。
    expect(resolveActiveSlice(slices, null)).toBe("D01");
    expect(resolveActiveSlice(slices, "D02")).toBe("D02");
    expect(resolveActiveSlice(slices, "D404")).toBe("D01");
    expect(resolveActiveSlice([], "D01")).toBeNull();
  });

  // ── ⑥ 一行两级：人话名在上、系统键在下（业务名与系统键**都给**，不用二选一）──────────
  it("🔴 两级标签：行主标题是对象类型的业务名，第二行是系统键；类型名取自本体 displayName（查不到显裸键）", async () => {
    loginAs("planner");
    renderApp(`/v/${PAGE}`);
    const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 5000 });
    const { items } = await fetchPropagationRules(true);

    // 取一条 source/target 在本体 mock 里**有** displayName 的边（`Line`→`Base`）。
    const named = items.find((r) => r.sourceTypeKey === "Line" && r.targetTypeKey === "Base");
    expect(named).toBeDefined();
    await screen.findByTestId(tid(`domain-${named!.domainKey}`));
    await userEvent.setup().click(within(panel).getByTestId(tid(`domain-${named!.domainKey}`)));

    const row = within(panel).getByTestId(tid(`edge-${named!.key}`));
    // 第二级：系统键那一行**逐字**含 `源类型.状态变量` / 链路 / `目标类型.状态变量`。
    const keys = within(row).getByTestId(tid(`keys-${named!.key}`));
    expect(keys.textContent).toContain(`${named!.sourceTypeKey}.${named!.sourceStateVar}`);
    expect(keys.textContent).toContain(named!.viaLinkKey);
    expect(keys.textContent).toContain(`${named!.targetTypeKey}.${named!.targetStateVar}`);

    // 第一级：业务名。取自本体 `displayName`（`Line`→产线 / `Base`→生产基地），
    // **不是前端内联的中文名映射**（R14 零业务常数）—— 故这里断的是"屏上出现了本体给的那个名字"。
    const main = row.querySelector("label");
    expect(main).not.toBeNull();
    const mainText = main!.textContent ?? "";
    expect(mainText).toContain("产线");
    expect(mainText).toContain("生产基地");

    // 未在本体里登记的类型（mock 里 `TypeA`/`TypeB` 没有 displayName 条目）⇒ **显裸键**，
    // 不渲染空白、也不编一个名字。这条是"诚实回落"的落点。
    const unnamed = items.find((r) => r.sourceTypeKey === "TypeA");
    expect(unnamed).toBeDefined();
    const otherSlice = unnamed!.domainKey ?? UNASSIGNED_SLICE_ID;
    await userEvent.setup().click(within(panel).getByTestId(tid(`domain-${otherSlice}`)));
    const rawRow = within(panel).getByTestId(tid(`edge-${unnamed!.key}`));
    expect(rawRow.querySelector("label")?.textContent).toContain("TypeA");
  });
});
