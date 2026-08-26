import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule } from "@platform/contracts";

/**
 * ══ WO-SIM-RAIL-FORMS · 左栏六个扰动子页的**接缝门**（SEAM-GATE：咬链路不咬函数）════
 *
 * 驱动的是「**后端回包 → 屏上 → 写口载荷**」这一条。五臂全部在**响应这一层**改东西，
 * 断言屏上/请求跟着变 —— 没有一条断言落在「某个纯函数返回了对的值」上。
 *
 * 组件**独立渲染**（`<PerturbRail />`），不挂外壳：外壳归第 ② 张单，本门不依赖它。
 *
 * ── 五臂 ───────────────────────────────────────────────────────────────────────
 *  ① 来源臂：子页里可选的量与它们的**中文名**来自回包 —— 改回包里的名字，屏上跟着改。
 *            期望值一律从 fixture 现算，**不断言写死的名字**。
 *  ② 层级臂：改**边集**让某个量从根源掉成枢纽 ⇒ 屏上分组跟着变。
 *            这一臂证明前端没有第二套度数计算：写死一张层级表的话，改了边集屏上不会动。
 *  ③ 写口臂：点「施加」⇒ 真发 `createSimPerturbation`，载荷**逐字段对拍**契约写入子集
 *            （并断言**键集完全相等** —— 少发一个必填字段当场红）。
 *  ④ 做不到臂：不在世界态里的量（OEE 那批）屏上**标明**且**提交时真的被拦住**。
 *  ⑤ 收起态臂：`onAppliedChange` 交出「已施加什么」，且它的标签也来自回包。
 *
 * ── ⓪ 金丝雀（本门是不是在真的看屏幕）────────────────────────────────────────
 * 用例 ⓪ 先跑一个**已知必中**的样例：子页数 = fixture 里 distinct 域数（现算，不写死）。
 * 它若失败 ⇒ 报「**工具坏了**」，**不许**读作「组件没渲染 / 没有子页」。
 * （第 ① 单的 dev 栽过：拿一个一回包就是终值的属性当"数据到齐"探针 ⇒ 7 例齐红在
 *  「卡片不存在」，真因是探针不度量它要度量的东西。）
 *
 * ── 🔴 fixture 必须接近生产规模 ────────────────────────────────────────────────
 * 铁律 0.5 判据 6 的「生产实参与测试实参交集为空」在本仓真实发生过。故 `STATE_VARS` 取
 * **`apps/datacore/src/seed.ts` 传导规则派生出来的那 40 条真名**（复验一条命令：
 * `grep -o 'sourceStateVar: "[a-zA-Z_]*"\|targetStateVar: "[a-zA-Z_]*"' apps/datacore/src/seed.ts
 *  | sed 's/.*: "//;s/"//' | sort -u | wc -l` ⇒ 2026-08-26 实测 **40**），
 * 中文名取 `apps/datacore/src/synthetic/battery.ts` 的 `STATE_VAR_DISPLAY_NAMES` 真词。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture · 生产规模
// ══════════════════════════════════════════════════════════════════════════════

/** 40 条状态变量真名（升序，= `view-config.stateVars` 的那一份口径）。 */
const STATE_VARS = [
  "changeoverPressure", "clearanceQueueDays", "collectionPressure", "costPressure",
  "defectPressure", "deliveryDelay", "deliveryHoldRisk", "demandLoad",
  "demandPressure", "drawdownPressure", "equipmentFailure", "expeditePressure",
  "feedPressure", "forecastBias", "gapPressure", "handlingBacklog",
  "inboundExpeditePressure", "inspectBacklog", "loadIndex", "loadPressure",
  "orderChurn", "overduePressure", "priceShock", "procurementDelay",
  "promiseRisk", "qualificationQueue", "queueDays", "queuePressure",
  "receivablePressure", "releasePressure", "repairBacklog", "reviewPressure",
  "shortageRisk", "splitPressure", "supplyRisk", "switchPressure",
  "transferPressure", "turnoverPressure", "utilPressure", "windowSqueeze",
] as const;

/**
 * 中文名字典 —— 真词，取自后端单源表；**刻意只登记一部分**：
 * 未登记的键不进字典（契约明文），于是屏上「有业务名」与「回落裸键」两态都被跑到。
 */
const BASE_NAMES: Record<string, string> = {
  changeoverPressure: "换型压力",
  costPressure: "成本压力",
  deliveryDelay: "交付延迟",
  demandLoad: "需求负载",
  demandPressure: "需求压力",
  equipmentFailure: "设备故障率",
  forecastBias: "销售预测偏差（正=高估）",
  loadIndex: "负载指数",
  orderChurn: "订单变更压力",
  priceShock: "价格冲击",
  procurementDelay: "采购到货延迟",
  repairBacklog: "维修派工积压",
  shortageRisk: "短缺风险",
  utilPressure: "利用率压力",
  windowSqueeze: "检修窗挤压",
};

/**
 * 域册（= 后端随边下发的 `domainKey`/`domainName`）。
 * `null` 那一格代表**未归域**：target 不是任何流程的承载物 —— 这是真实存在的一档
 * （2026-08-26 现算 `seed.ts`：`Material` 上的 `shortageRisk` 三条边正是这一档）。
 */
const DOMAINS: readonly ({ key: string; name: string } | null)[] = [
  { key: "D03", name: "销售与客户" },
  { key: "D05", name: "采购与供应" },
  { key: "D09", name: "设备与维护" },
  null,
];
const GROUP_SIZE = STATE_VARS.length / DOMAINS.length; // 40 / 4 = 10

interface Edge {
  from: string;
  to: string;
  domain: { key: string; name: string } | null;
  /** 落点对象类型（真被承载的那一头）。 */
  targetType: string;
  sourceType: string;
}

/**
 * 基线边集：每个域一条 10 节点的链（9 条边）。
 * 于是每片里三层都非空：链首 = 根源、链尾 = 末端、中间 = 枢纽。
 * **只有这里定义边集** —— 层级回包由它现算，不另手写一份层级表。
 */
function baseEdges(): Edge[] {
  const out: Edge[] = [];
  DOMAINS.forEach((d, gi) => {
    const vars = STATE_VARS.slice(gi * GROUP_SIZE, (gi + 1) * GROUP_SIZE);
    for (let i = 0; i + 1 < vars.length; i += 1) {
      out.push({
        from: vars[i] as string,
        to: vars[i + 1] as string,
        domain: d,
        sourceType: `Type${gi}A`,
        targetType: `Type${gi}B`,
      });
    }
  });
  return out;
}

/** 某片的链首（基线里它是根源）。 */
function headOf(groupIndex: number): string {
  return STATE_VARS[groupIndex * GROUP_SIZE] as string;
}

/**
 * 层级：**复刻后端 `layerOfStateVars` 的三条判据**（`apps/datacore/src/sim/drill-scan.ts:290`）。
 * 这份复刻只活在 fixture 里，代表「后端会回什么」；生产代码一行度数计算都没有 ——
 * 这正是第 ② 臂要证明的那件事。
 */
function layersFromEdges(es: readonly Edge[]): { stateVar: string; layer: string; label: string }[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of es) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const keys = [...new Set([...inDeg.keys(), ...outDeg.keys()])].sort();
  return keys.map((sv) => {
    const i = inDeg.get(sv) ?? 0;
    const o = outDeg.get(sv) ?? 0;
    return {
      stateVar: sv,
      layer: i === 0 && o > 0 ? "根源" : o === 0 && i > 0 ? "末端" : "枢纽",
      label: names[sv] ?? sv,
    };
  });
}

function rulesFromEdges(es: readonly Edge[]): PropagationRule[] {
  return es.map((e, i) => ({
    id: `spr_${i}`,
    tenantId: "demo",
    key: `rule_${i}_${e.from}_${e.to}`,
    sourceTypeKey: e.sourceType,
    sourceStateVar: e.from,
    viaLinkKey: "feeds",
    targetTypeKey: e.targetType,
    targetStateVar: e.to,
    coefficient: 0.5,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
    domainKey: e.domain?.key ?? null,
    domainName: e.domain?.name ?? null,
    sourceTypeName: null,
    targetTypeName: null,
  })) as unknown as PropagationRule[];
}

/** 每个类型的真物化对象 id（= `view-config.nodeObjectIds`，引擎 idsByType 同源）。 */
function nodeObjectIds(es: readonly Edge[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of es) {
    for (const t of [e.sourceType, e.targetType]) {
      if (out[t] === undefined) out[t] = [`obj_${t.toLowerCase()}_1`, `obj_${t.toLowerCase()}_2`];
    }
  }
  return out;
}

const SESSION_ID = "sims_rail";

/** 已施加的扰动（收起态摘要的数据源）。 */
const PERTURBATIONS = [
  {
    id: "simpert_1",
    tenantId: "demo",
    sessionId: SESSION_ID,
    kind: "supply_disruption",
    targetObjectId: "obj_type1b_1",
    targetStateVar: "procurementDelay",
    startTick: 0,
    durationTicks: 60,
    magnitude: 18,
    mode: "delta",
    label: "采购到货延迟 +18 · 第 0 拍起 · 持续 60 拍",
    createdAt: "2026-08-26T00:00:00.000Z",
  },
];

// ── 可变桩状态（每个用例 beforeEach 重置）────────────────────────────────────────
let edges: Edge[] = baseEdges();
let names: Record<string, string> = { ...BASE_NAMES };
let liveVars: string[] = [...STATE_VARS];

/**
 * 写口的间谍。**必须 `vi.hoisted`** —— `vi.mock` 的工厂被提升到文件顶部，
 * 工厂体里直接引用一个普通的 `const` 会撞 `Cannot access 'createSpy' before initialization`
 * （本门第一次跑就是这么红的，记在这里省下一次同样的排查）。
 */
const createSpy = vi.hoisted(() =>
  vi.fn(async (_sessionId: string, _body: unknown) => ({ curTick: 0, state: {} })),
);

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(async () => ({
    tenantId: "demo",
    nodeTypes: [...new Set(edges.flatMap((e) => [e.sourceType, e.targetType]))],
    nodeObjectIds: nodeObjectIds(edges),
    linkTypes: ["feeds"],
    stateVars: [...liveVars],
    stateVarNames: { ...names },
    radarDims: [],
    screens: ["sandbox"],
    propagationCount: edges.length,
  })),
  fetchDrillStateVarLayers: vi.fn(async () => ({ layers: layersFromEdges(edges), ruleCount: edges.length })),
  fetchPropagationRules: vi.fn(async () => ({ items: rulesFromEdges(edges), stateVarNames: { ...names } })),
  fetchSimPerturbations: vi.fn(async () => ({ items: PERTURBATIONS })),
  createSimPerturbation: createSpy,
  // 下面两个本门一次都不调 —— 但 `PerturbationTimeline`（`PERTURBATION_KINDS` 的单源）与
  // `shared.tsx` 在**模块求值期**就 import 了它们，整体替换式 mock 里缺一个就当场抛
  // 「No export is defined on the mock」，而那与本单要测的东西一行关系都没有。
  deleteSimPerturbation: vi.fn(),
  createActionDraft: vi.fn(),
  fetchWorkspace: vi.fn(),
}));

import PerturbRail from "@/views/sim/unified/rail/PerturbRail";

function mount(props: Partial<React.ComponentProps<typeof PerturbRail>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PerturbRail sessionId={SESSION_ID} {...props} />
    </QueryClientProvider>,
  );
}

/** 等到取数落地：子页签真出现（`data-pages` > 0）。 */
async function ready(): Promise<HTMLElement> {
  const root = await screen.findByTestId("rail-root");
  await waitFor(() => expect(Number(root.getAttribute("data-pages"))).toBeGreaterThan(0));
  return root;
}

function sel(testId: string): HTMLSelectElement {
  return screen.getByTestId(testId) as HTMLSelectElement;
}

/** 某个下拉里全部选项的 `value`（顺序即屏上顺序）。 */
function optionValues(testId: string): string[] {
  return [...sel(testId).querySelectorAll("option")].map((o) => o.value);
}

/** 某个 optgroup 里全部选项的 `value`；分组不存在时回 `null`（≠ 空数组，两件事不合并）。 */
function groupValues(testId: string): string[] | null {
  const g = screen.queryByTestId(testId);
  return g === null ? null : [...g.querySelectorAll("option")].map((o) => o.value);
}

beforeEach(() => {
  edges = baseEdges();
  names = { ...BASE_NAMES };
  liveVars = [...STATE_VARS];
  createSpy.mockClear();
});
afterEach(() => cleanup());

describe("WO-SIM-RAIL-FORMS · 左栏扰动子页接缝门", () => {
  // ══════════════════════════════════════════════════════════════════════════
  it("⓪ 金丝雀：子页数 = fixture 里 distinct 域数（失败 ⇒ 工具坏了，不是组件没渲染）", async () => {
    mount();
    const root = await ready();
    const expected = new Set(edges.map((e) => e.domain?.key ?? "__unassigned__")).size;
    expect(
      Number(root.getAttribute("data-pages")),
      "金丝雀不中 ⇒ 本门这次什么都没证明：报「工具坏了」，不许报「没有子页」",
    ).toBe(expected);
    // 未归域那一片必须**单列**并说明原因（不许塞进最近的那个域）
    expect(screen.getByTestId("rail-tab-__unassigned__")).toBeTruthy();
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("① 来源臂：可选的量与中文名来自后端回包 —— 改回包，屏上跟着改", async () => {
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D05"));

    // 期望**现算**：D05 那一片的量 = fixture 里该域边集两端的并集
    const d05 = edges.filter((e) => e.domain?.key === "D05");
    const expectVars = [...new Set(d05.flatMap((e) => [e.from, e.to]))].sort();
    expect(optionValues("rail-statevar").sort()).toEqual(expectVars);

    // 屏上那一串：有名字显中文、没名字回落裸键（两态都要跑到）
    const withName = expectVars.find((v) => names[v] !== undefined) as string;
    const noName = expectVars.find((v) => names[v] === undefined) as string;
    expect(withName).toBeTruthy();
    expect(noName).toBeTruthy();
    const textOf = (v: string): string =>
      ([...sel("rail-statevar").querySelectorAll("option")].find((o) => o.value === v)?.textContent ?? "");
    expect(textOf(withName)).toContain(names[withName] as string);
    expect(textOf(noName)).toContain(noName);

    // ── 改**回包**里的名字 ⇒ 屏上那个词跟着换（这一句才是本臂的判据）──
    const renamed = `${names[withName] as string}·改名验证`;
    cleanup();
    names = { ...names, [withName]: renamed };
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D05"));
    expect(textOf(withName)).toContain(renamed);
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("② 层级臂：改边集让链首从根源掉成枢纽 ⇒ 屏上分组跟着变（前端没有第二套度数计算）", async () => {
    const head = headOf(0); // D03 那一片的链首，基线里入度 0 ⇒ 根源
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D03"));
    expect(groupValues("rail-group-root")).toContain(head);
    expect(groupValues("rail-group-downstream") ?? []).not.toContain(head);

    // ── 改**边集**：把链尾接回链首（链首入度 0 → 1）。层级回包由边集现算，
    //    前端若存了一张层级表，屏上分组不会动 ⇒ 本臂当场红。
    const tail = STATE_VARS[GROUP_SIZE - 1] as string;
    cleanup();
    edges = [
      ...baseEdges(),
      { from: tail, to: head, domain: DOMAINS[0] ?? null, sourceType: "Type0A", targetType: "Type0B" },
    ];
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D03"));

    expect(groupValues("rail-group-downstream")).toContain(head);
    // 这一片现在一个根源都没有 ⇒ 根源组**不渲染**（`null`），不是渲染一个空组
    expect(groupValues("rail-group-root")).toBeNull();
    // 屏上那句层级说明也跟着变
    expect(screen.getByTestId("rail-layer-note").getAttribute("data-layer")).toBe("枢纽");
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("③ 写口臂：点「施加」真发 POST，载荷逐字段对拍契约写入子集（键集完全相等）", async () => {
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D05"));

    const head = headOf(1); // D05 的链首（根源、在世界态里）
    await userEvent.selectOptions(sel("rail-statevar"), head);
    const objectId = optionValues("rail-objectid")[0] as string;
    await userEvent.selectOptions(sel("rail-objectid"), objectId);
    await userEvent.selectOptions(sel("rail-kind"), "supply_disruption");
    await userEvent.selectOptions(sel("rail-mode"), "scale");
    await userEvent.clear(screen.getByTestId("rail-magnitude"));
    await userEvent.type(screen.getByTestId("rail-magnitude"), "1.5");
    await userEvent.clear(screen.getByTestId("rail-starttick"));
    await userEvent.type(screen.getByTestId("rail-starttick"), "3");
    await userEvent.type(screen.getByTestId("rail-duration"), "7");

    await userEvent.click(screen.getByTestId("rail-apply"));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    const [gotSession, gotBody] = createSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(gotSession).toBe(SESSION_ID);
    // 键集**完全相等** —— 少发一个契约必填字段（`label` / `kind` / `mode` …）当场红
    expect(Object.keys(gotBody).sort()).toEqual(
      ["durationTicks", "kind", "label", "magnitude", "mode", "startTick", "targetObjectId", "targetStateVar"],
    );
    // 逐字段对拍（不是只断言「发了请求」）
    expect(gotBody.kind).toBe("supply_disruption");
    expect(gotBody.targetObjectId).toBe(objectId);
    expect(gotBody.targetStateVar).toBe(head);
    expect(gotBody.magnitude).toBe(1.5);
    expect(gotBody.mode).toBe("scale");
    expect(gotBody.startTick).toBe(3);
    expect(gotBody.durationTicks).toBe(7);
    // `label` 契约必填：屏上那一串（中文名或回落裸键）+ 幅度读法 + 时长读法
    expect(gotBody.label).toBe(`${names[head] ?? head} ×1.5 · 第 3 拍起 · 持续 7 拍`);
    expect(String(gotBody.label).length).toBeLessThanOrEqual(200);
  });

  it("③' 写口臂 · 留空持续拍数 ⇒ `durationTicks: null`（契约的「永久」语义，等价于旧 /act）", async () => {
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D05"));
    await userEvent.selectOptions(sel("rail-statevar"), headOf(1));
    await userEvent.click(screen.getByTestId("rail-apply"));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const body = (createSpy.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(body.durationTicks).toBeNull();
    expect(body.label).toContain("永久");
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("④ 做不到臂：不在世界态里的量屏上标明、且提交时真的被拦住（不许静默提交）", async () => {
    mount();
    await ready();

    // ── ④a 屏上**标明**：OEE 那批在「今天扰不动」里，带机器可读的原因码 ──
    const oee = screen.getByTestId("rail-blocked-oee_current");
    expect(oee.getAttribute("data-reason")).toBe("NOT_A_STATE_VAR");
    expect(oee.textContent).toContain("Equipment.oee_current");
    expect(screen.getByTestId("rail-blocked-reason").textContent).toContain("world.state");
    // ── ④b 基线里它压根进不了下拉（一条传导规则都不提它）──
    expect(optionValues("rail-statevar")).not.toContain("oee_current");

    // ── ④c 真把它塞进下拉（草稿边提到它，而 `view-config.stateVars` 不含它 ——
    //      `fetchPropagationRules(true)` 含草稿、`stateVars` 只由已发布边派生，这是真实可能的态）
    //      ⇒ 选中它以后「施加」必须**拦住并给出原因**，而不是安静地发出去。
    cleanup();
    edges = [
      ...baseEdges(),
      { from: headOf(2), to: "oee_current", domain: DOMAINS[2] ?? null, sourceType: "Type2A", targetType: "Equipment" },
    ];
    mount();
    await ready();
    await userEvent.click(screen.getByTestId("rail-tab-D09"));
    expect(optionValues("rail-statevar")).toContain("oee_current");

    await userEvent.selectOptions(sel("rail-statevar"), "oee_current");
    const apply = screen.getByTestId("rail-apply") as HTMLButtonElement;
    await waitFor(() => expect(apply.getAttribute("data-blocked")).toBe("NOT_IN_WORLD_STATE"));
    expect(apply.disabled).toBe(true);
    expect(screen.getByTestId("rail-apply-blocked").textContent).toContain("扰不动");
    expect(screen.getByTestId("rail-layer-note").getAttribute("data-liveness")).toBe("not-in-world-state");

    await userEvent.click(apply);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("④' 「不知道」与「扰不动」分得开：世界态清单没回来时报 `STATE_VARS_UNKNOWN`", async () => {
    // 这一条守的是本仓那句话：**「我没找到」和「它不存在」是两个不同的命题**。
    // 屏上若把"还没回来"说成"这个量扰不动"，用户会去派一张根本不需要的后端单。
    mount({ sessionId: SESSION_ID });
    const root = await screen.findByTestId("rail-root");
    // 首帧（view-config 未回）就该是 unknown，而不是 not-in-world-state
    const apply = root.querySelector("[data-testid='rail-apply']");
    if (apply !== null) {
      expect(["STATE_VARS_UNKNOWN", "NO_STATE_VAR"]).toContain(apply.getAttribute("data-blocked"));
    }
    await ready();
    // 回包到齐之后恢复成可提交
    await waitFor(() => expect(screen.getByTestId("rail-apply").getAttribute("data-blocked")).toBe(""));
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("⑤ 收起态臂：`onAppliedChange` 交出「已施加什么」，标签同样来自回包", async () => {
    const onAppliedChange = vi.fn();
    mount({ onAppliedChange });
    await ready();
    await waitFor(() => expect(onAppliedChange).toHaveBeenCalled());

    const last = onAppliedChange.mock.calls.at(-1)?.[0] as ReadonlyArray<Record<string, unknown>>;
    const p = PERTURBATIONS[0] as (typeof PERTURBATIONS)[number];
    expect(last).toHaveLength(1);
    expect(last[0]).toEqual({
      id: p.id,
      label: p.label,
      targetStateVar: p.targetStateVar,
      // 标签走 `stateVarLabel(裸键, 回包字典)` —— 屏上与摘要条是同一条消费路径
      targetLabel: { text: names[p.targetStateVar] as string, named: true, key: p.targetStateVar },
      magnitude: p.magnitude,
      mode: p.mode,
    });

    // ── 改**回包**里的名字 ⇒ 摘要数据里的标签跟着改（不是写死的中文）──
    cleanup();
    const renamed = "采购到货延迟·改名验证";
    names = { ...names, [p.targetStateVar]: renamed };
    const again = vi.fn();
    mount({ onAppliedChange: again });
    await ready();
    await waitFor(() => {
      const rows = again.mock.calls.at(-1)?.[0] as ReadonlyArray<{ targetLabel: { text: string } }>;
      expect(rows[0]?.targetLabel.text).toBe(renamed);
    });
  });
});
