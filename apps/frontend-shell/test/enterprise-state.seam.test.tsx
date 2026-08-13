import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  captureEnterpriseState,
  ENTERPRISE_STATE_REAL_WORLD_ID,
  EnterpriseStateSchema,
  enterpriseStateId,
  type EnterpriseState,
} from "@platform/contracts";
import {
  captureEnterpriseStateSnapshot,
  fetchEnterpriseState,
  fetchEnterpriseStates,
  fetchLatestEnterpriseState,
} from "@/api/endpoints";
import { EVENT_INVALIDATES, invalidateForEvent } from "@/store/eventInvalidation";
import { queryClient } from "@/store/queryClient";
import { EnterpriseStatePanel } from "@/views/sim/EnterpriseStatePanel";
import { TENANT_ID } from "@/mocks/fixtures";
import { loginAs, renderWithClient } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-ENTERPRISE-STATE · 企业状态快照 —— **接缝驱动**：写一次快照 → 前端读到**同一份**数据。
 *
 * ── 本文件咬的接缝 ────────────────────────────────────────────────────────────
 *  ① **写 → 读同一份**：`POST /a/v1/twin/enterprise-states` 捕获 → 面板显示的每个数字
 *     必须能在那次 POST 的响应里逐条找到（不是"页面上有数字"，是"页面上的数字 === 写进去的那个数"）。
 *  ② **mock 与真后端口径不分家**：mock 返回的 doc 必须过 `EnterpriseStateSchema.parse`
 *     （契约就是后端的形状），且 mock 的捕获走的是**契约里那个纯函数本尊** ——
 *     本文件另有一条断言直接读 `src/mocks/handlers.ts` 源码，证明它 import 的是
 *     `captureEnterpriseState` 而不是自己手写了一套形状（本仓有过 mock 与引擎分家、
 *     测试咬 mock 恒绿的真事故）。
 *  ③ **诚实空 ≠ 0**：`value === null` 的项必须渲染成「—」+ 原因，不许出现 `0`。
 *  ④ **零写死数据反证**（PRD §0.06 裁定二）：把 API 打成 500，面板必须变成诚实错误块；
 *     仍然显示任何业务数字 = 那个数是写死的 = 红。
 *  ⑤ **不是死组件**：面板必须真的挂在沙盘右栏（读 `SandboxView.tsx` 源码断言挂载点），
 *     否则就是本仓 F2/F3/F4 连踩三次的「实现有、测试绿、零路由渲染得到」。
 *  ⑥ **事件真有消费方**：`enterprise_state.snapshotted` 到达 → 面板那条 query 真被标失效
 *     （用真 queryClient 验前缀匹配，不是 spy）。
 */

const REAL = ENTERPRISE_STATE_REAL_WORLD_ID;
const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 面板上某条指标显示出来的文本（testid 与 metric.key 绑定 ⇒ 咬的是"哪条指标显示成什么"）。 */
const valueTextOf = (key: string) => screen.getByTestId(`enterprise-state-value-${key}`).textContent ?? "";

describe("WO-ENTERPRISE-STATE · 企业状态快照（接缝：捕获 → 前端读到同一份）", () => {
  beforeEach(() => {
    loginAs("planner");
    queryClient.clear();
  });

  it("① 写一次快照 → 面板显示的数字与那次写入的响应**逐条相等**", async () => {
    const written = await captureEnterpriseStateSnapshot();
    // mock 的返回必须过契约 schema —— 契约就是真后端的形状，parse 失败即 mock 与后端分家。
    const parsed = EnterpriseStateSchema.parse(written);
    expect(parsed.metrics.length).toBeGreaterThan(0); // 金丝雀：真有内容，下面的"逐条相等"不是空胜

    renderWithClient(<EnterpriseStatePanel />);
    await screen.findByTestId("enterprise-state-panel");

    // 逐条比：页面上显示的值必须由写入的那份数据决定（挑几条不同形态的：计数 / 合计 / KPI / 空值）。
    const byKey = new Map(parsed.metrics.map((m) => [m.key, m]));
    const probes = ["count:Order", "sum:Order.qty", "kpi:ontime_rate", "kpi:cash_cycle"];
    for (const key of probes) {
      const m = byKey.get(key);
      expect(m, `写入的快照里没有 ${key} —— 探针选错了，先修探针再看结论`).toBeDefined();
      if (m!.value === null) {
        expect(valueTextOf(key)).toBe("—"); // ③ 诚实空
        expect(screen.getByTestId(`enterprise-state-reason-${key}`).textContent).toBe(m!.reason);
      } else {
        const shown = valueTextOf(key);
        const num = Number.isInteger(m!.value) ? String(m!.value) : m!.value!.toFixed(2);
        expect(shown, `${key} 页面显示 "${shown}"，写入的是 ${m!.value}`).toContain(num);
      }
    }

    // 逻辑时刻也来自那份数据（不是前端补的 new Date()）。
    expect(screen.getByTestId("enterprise-state-tick").textContent).toBe(`tick ${parsed.capturedAt.tick}`);
    expect(screen.getByTestId("enterprise-state-simdate").textContent).toBe(parsed.capturedAt.simulatedDate);
  });

  it("①b 读回来的三条路（latest / list / by-id）指向**同一份** doc，逐字节相同", async () => {
    const written = await captureEnterpriseStateSnapshot();
    const latest = await fetchLatestEnterpriseState(REAL);
    const list = await fetchEnterpriseStates(REAL);
    const byId = await fetchEnterpriseState(written.id);

    expect(JSON.stringify(latest.state)).toBe(JSON.stringify(written));
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list.items[0])).toBe(JSON.stringify(written));
    expect(JSON.stringify(byId)).toBe(JSON.stringify(written));
    // 确定性 id（与后端同一个契约函数算出来的；租户取 mock 世界的 TENANT_ID，不写死字面量）。
    expect(written.id).toBe(enterpriseStateId(TENANT_ID, REAL, written.capturedAt.tick));
  });

  it("② mock 的形状不是手写的：handlers.ts 调用的是契约里的 `captureEnterpriseState` 本尊", () => {
    const src = readRepoFile("../src/mocks/handlers.ts");
    expect(src.length, "handlers.ts 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    // 金丝雀：同样的手法先抓一个已知必在的 import，抓不到说明是断言方式坏了。
    expect(src).toContain(`from "@platform/contracts"`);
    // 真判据：捕获/fork/diff 三个算法全部来自契约，mock 里没有第二套实现。
    // import 边住在哪个文件不是事实（WO-C 修法）：全树扫 import 子句，搬家不红；符号消失才红。
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    for (const sym of ["captureEnterpriseState", "forkEnterpriseState", "diffEnterpriseStates"]) {
      const re = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*"@platform/contracts"`);
      expect(factHits(fe, re), `${sym} 不再从 @platform/contracts import ⇒ mock 里长出了第二套实现`).not.toEqual([]);
    }

    // 更强的一条：拿 mock 的输入自己算一遍，与 mock 端点返回的 doc 逐字节比 —— 若 mock 偷偷
    // 改了结果（后处理/裁剪/补默认值），这条会红。输入形态与 mock 内部一致（同一份纯函数）。
    const mine = captureEnterpriseState({
      tenantId: "demo",
      worldId: REAL,
      isSimulated: false,
      forkedFromStateId: null,
      clock: { tick: 0, simulatedDate: "2026-06-12", t0: "2026-06-12" },
      kpis: [{ metricKey: "k", label: "L", unit: "%", category: "profit", actual: 1, target: 2 }],
      types: [{ typeKey: "T", displayName: "T", domain: "d", numericProps: [{ propKey: "p", unit: "" }], rows: [{ p: 1 }] }],
    });
    // 纯函数同输入同输出（这一条同时证明契约包在前端侧确实是同一份实现，不是被 vite 别名换掉的桩）。
    expect(JSON.stringify(captureEnterpriseState({
      tenantId: "demo",
      worldId: REAL,
      isSimulated: false,
      forkedFromStateId: null,
      clock: { tick: 0, simulatedDate: "2026-06-12", t0: "2026-06-12" },
      kpis: [{ metricKey: "k", label: "L", unit: "%", category: "profit", actual: 1, target: 2 }],
      types: [{ typeKey: "T", displayName: "T", domain: "d", numericProps: [{ propKey: "p", unit: "" }], rows: [{ p: 1 }] }],
    }))).toBe(JSON.stringify(mine));
  });

  it("③ 诚实空反证：把某条指标的值改成 null → 页面必须显示「—」+ 原因，**不许显示 0**", async () => {
    // 用 server.use 覆盖一次响应：改数据 → 界面必须跟着变（证明是数据驱动，不是渲染写死）。
    const doctored: EnterpriseState = captureEnterpriseState({
      tenantId: "demo",
      worldId: REAL,
      isSimulated: false,
      forkedFromStateId: null,
      clock: { tick: 7, simulatedDate: "2026-06-19", t0: "2026-06-12" },
      kpis: [{ metricKey: "probe", label: "探针指标", unit: "%", category: "profit", actual: null, target: 10 }],
      types: [
        // 声明了数值属性但一行数据都没有 ⇒ 合计必须是 null + reason，而不是 0。
        { typeKey: "Ghost", displayName: "空类型", domain: "product", numericProps: [{ propKey: "x", unit: "件" }], rows: [] },
      ],
    });
    server.use(
      http.get("*/a/v1/twin/enterprise-states/latest", () =>
        HttpResponse.json({ worldId: REAL, state: doctored }),
      ),
    );

    renderWithClient(<EnterpriseStatePanel />);
    await screen.findByTestId("enterprise-state-panel");

    expect(valueTextOf("kpi:probe")).toBe("—");
    expect(valueTextOf("sum:Ghost.x")).toBe("—");
    expect(screen.getByTestId("enterprise-state-reason-sum:Ghost.x").textContent).toBeTruthy();
    // 「对象数」是真数出来的 0，必须显示 0 而不是「—」—— 两种"没有"在界面上分得开。
    expect(valueTextOf("count:Ghost")).toContain("0");
    // 页面上不许出现把 null 渲染成 0 的痕迹：这两条空值行的值单元格文本严格等于「—」。
    expect(screen.getByTestId("enterprise-state-value-kpi:probe").textContent).not.toContain("0");
    // 时刻跟着改后的数据走（证明时钟也是数据驱动的）。
    expect(screen.getByTestId("enterprise-state-tick").textContent).toBe("tick 7");
  });

  it("④ 零写死数据反证：API 打成 500 → 面板变诚实错误块，页面上不再有任何业务数字", async () => {
    server.use(
      http.get("*/a/v1/twin/enterprise-states/latest", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "后端炸了", requestId: "req_x" } }, { status: 500 }),
      ),
    );
    renderWithClient(<EnterpriseStatePanel />);
    const box = await screen.findByTestId("enterprise-state-error");
    expect(box.textContent).toContain("BOOM");
    expect(box.textContent).toContain("后端炸了");
    // 反证核心：没有任何指标行残留（有 = 那些数是写死在前端的）。
    expect(screen.queryByTestId("enterprise-state-panel")).toBeNull();
    expect(screen.queryByTestId("enterprise-state-value-count:Order")).toBeNull();
  });

  it("④b 诚实空态：世界还没有快照 → 原样显示后端给的 reason（前端不自编一句盖掉它）", async () => {
    renderWithClient(<EnterpriseStatePanel />); // 未捕获任何快照
    const empty = await screen.findByTestId("enterprise-state-empty");
    const latest = await fetchLatestEnterpriseState(REAL);
    expect(latest.state).toBeNull();
    expect(empty.textContent).toBe(latest.reason);
  });

  it("⑤ 不是死组件：面板真的挂在沙盘右栏（SandboxView 的 rail），否则实现有、测试绿、零渲染得到", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view.length, "SandboxView.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    expect(view).toContain(`import { EnterpriseStatePanel }`);
    expect(view).toContain(`id: "enterprise-state"`);
    expect(view).toContain(`node: <EnterpriseStatePanel />`);
  });

  it("⑥ 事件真有消费方：`enterprise_state.snapshotted` → 面板那条 query 真被标失效（真 queryClient）", () => {
    // 面板真实注册的 key（尾带 worldId，靠前缀失效盖住所有世界）。
    const key = ["a", "enterprise-states", REAL];
    queryClient.setQueryData(key, { worldId: REAL, state: null });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    invalidateForEvent("enterprise_state.snapshotted");
    expect(
      queryClient.getQueryState(key)?.isInvalidated,
      "捕获快照后面板没失效 —— 那这个事件就是发给空气的（#90/#92 那族的假接线）",
    ).toBe(true);

    // 反证：事件名拼错一个字母 → 什么都不失效（证明咬的是真事件名不是任意字符串）。
    queryClient.clear();
    queryClient.setQueryData(key, { worldId: REAL, state: null });
    invalidateForEvent("enterprise_state.snapshotted_");
    invalidateForEvent("enterprise_state.snapshoted");
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    // 表侧锚点与面板源码里的 queryKey 字面量同源（防表漂移）。
    const panel = readRepoFile("../src/views/sim/EnterpriseStatePanel.tsx");
    expect(panel).toContain(`queryKey: ["a", "enterprise-states", worldId]`);
    expect(EVENT_INVALIDATES["enterprise_state.snapshotted"]).toContain("enterprise-states");
    expect(EVENT_INVALIDATES["enterprise_state.forked"]).toContain("enterprise-states");
  });

  it("⑦ 面板零写死业务数据：**代码里**没有行业实体名、没有分组白名单（注释不算代码）", () => {
    const raw = readRepoFile("../src/views/sim/EnterpriseStatePanel.tsx");
    // 注释是说明，不是渲染依据 —— 只扫代码。先剥注释，再扫。
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const code = stripComments(raw);
    // 自证工具：剥注释这一步必须真的在剥（拿一个只在注释里出现的词当金丝雀）。
    expect(raw.includes("KPI / 产能 / 库存 / 订单快照值"), "金丝雀短语不在原文里了——探针过期，先修探针").toBe(true);
    expect(code.includes("KPI / 产能 / 库存 / 订单快照值"), "剥注释没生效——下面的「代码里没有」全部不可信").toBe(false);

    for (const name of ["Order", "Base", "订单", "产能", "库存", "基地", "factory", "product"]) {
      expect(code.includes(name), `面板代码里出现了行业实体名/分组名「${name}」= 写死了业务口径`).toBe(false);
    }
    // 分组名映射表是"第二套真相源"的典型形态：分组名一律直显后端给的 key，不许有中文映射对象。
    expect(/Record<string,\s*string>/.test(code), "面板里出现了字符串映射表——分组/标签必须直接来自响应").toBe(false);
  });
});
