import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { CHAIN_NODE_IDS } from "@platform/contracts";
import { getRenderer, resolveViewKey } from "@/views/registry";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";
import { loginAs, renderWithClient } from "./utils";

/**
 * WO-SANDBOX-G1 · 收口总门 · **前端半**（数据半 × 引擎半那两条在
 * `apps/datacore/test/sandbox-g1-seam.test.ts`；跨包不能同文件 —— `contracts-only-shared`
 * 禁止前端 import datacore 源码，且两包 vitest 环境一个 jsdom 一个 node。
 * 两文件由 `bash scripts/gate-sandbox-g1.sh` 串成一条门并显式捕获退出码）。
 *
 * ── 本门咬什么（与四道单视图可达门的分工）────────────────────────────────────
 * `physical-topology-reachable` / `node-inspector-reachable` / `transit-flow-reachable`
 * 与 `chain-line-map.seam` SEAM① 各自证**自己那一张**从 registry 取得到并渲染得出来。
 * 它们证不了的是**这四张作为一个交付整体**的两件事，也正是本门新增的：
 *
 *  ① **花名册**：本系列承诺的四张视图，一张都不许留在暗处。四道单门是四个独立文件，
 *     删掉其中一个文件（或某张视图被后续重构从 registry 摘掉而它的门一起被删），
 *     在系列层面**没有任何东西会红**。本门把四条键钉成一张表，逐条走
 *     `resolveViewKey → getRenderer → 真渲染`（用户点进来走的就是这条路）。
 *  ② **同进程共存**：四张图在**同一个测试进程里依次渲染**。各自起进程时，
 *     模块级单例冲突 / 重复 testid / 全局定时器互踩这类"合并才现形"的问题看不见 ——
 *     而这正是 G1 存在的理由（本仓 2026-08-07 一天撞三次合并态接缝）。
 *  ③ **节点 id 单源**：四张图上出现的链路节点 id 必须 ⊆ 契约 `CHAIN_NODE_IDS`。
 *     前端手抄一份词表 = D1×E1 那次事故的前端版（数据半、引擎半、前端半三边对不上）。
 *
 * ── 变异反证（每条都要能红）──────────────────────────────────────────────────
 *  · 注释掉 `views/registry.ts` 任一 `registerRenderer("<key>", …)` → 本门第一例点名那张红。
 *  · 把某张图的节点 id 改成不在册的自由串 → 第三例红。
 *
 * ── 诚实边界 ────────────────────────────────────────────────────────────────
 *  · 本门**不**喂 fixture 数据去凑一张好看的图：喂 fixture 就把"页面能不能真取到数"绕开了。
 *    取到空就断言空（各视图自己的诚实缺席块由各自的单门咬）。
 *  · 本门**不**断言颜色/三色系（`A7` 由各单门与 `boundary-singlesource:check` 守）。
 */

/** 本系列承诺的四张视图 —— 花名册。`key` 是用户走的那条路上的字符串键。 */
const SANDBOX_VIEWS = [
  { wo: "F1", key: "chain-line-map", name: "全链线路图", rootTestId: "clm-root" },
  { wo: "F2", key: "transit-flow", name: "在途 / 在制", rootTestId: "transit-flow-root" },
  { wo: "F3", key: "physical-topology", name: "物理拓扑", rootTestId: "phys-topo-canvas" },
  { wo: "F4", key: "node-inspector", name: "节点检视", rootTestId: "node-inspector-root" },
] as const;

const mkView = (v: (typeof SANDBOX_VIEWS)[number]): ViewConfigVM =>
  ViewConfigVMSchema.parse({ viewKey: v.key, name: v.name, renderer: v.key });

/** 走用户那条路：`resolveViewKey`（场景短键归一）→ `getRenderer`（registry 字符串键）→ 真渲染。 */
function renderByKey(v: (typeof SANDBOX_VIEWS)[number]) {
  loginAs("planner"); // 有的视图自取真值（/a/v1/objects 未登录直接 401）
  const canonical = resolveViewKey(v.key);
  expect(canonical, `resolveViewKey('${v.key}') 归一失败`).toBeTruthy();
  const View = getRenderer(canonical);
  expect(
    View,
    `【${v.wo}】registry 里没有 '${v.key}' —— 组件再绿、单门再多，也没有任何路由渲染得到它` +
      `（G-SKILL-REFGRAPH-DEAD-EXTRACTOR：实现有、测试有、全绿、零生产调用方）`,
  ).toBeDefined();
  const Lazy = View!;
  return renderWithClient(
    <Suspense fallback={<div data-testid="g1-loading" />}>
      <Lazy view={mkView(v)} />
    </Suspense>,
  );
}

describe("WO-SANDBOX-G1 · 前端半：四张沙盘视图**全部**从 registry 字符串键真渲染", () => {
  it("花名册逐条走通：四张一张不少，且每张的画布真出现在 DOM 里", async () => {
    const missing: string[] = [];
    for (const v of SANDBOX_VIEWS) {
      const { unmount } = renderByKey(v);
      try {
        await screen.findByTestId(v.rootTestId, {}, { timeout: 8000 });
      } catch {
        missing.push(`${v.wo}/${v.key}（期待 data-testid=${v.rootTestId}）`);
      }
      unmount();
    }
    expect(missing, `下列沙盘视图从 registry 键出发渲染不出来：\n  · ${missing.join("\n  · ")}`).toEqual([]);
  });

  it("同一进程内四张依次渲染：不互相污染（模块级单例 / 重复 testid / 孤儿定时器这类合并才现形的问题）", async () => {
    // 第一轮：全部渲染并卸载
    for (const v of SANDBOX_VIEWS) {
      const { unmount } = renderByKey(v);
      await screen.findByTestId(v.rootTestId, {}, { timeout: 8000 });
      unmount();
    }
    // 第二轮：再来一遍。若某张图在模块级留了状态/定时器，第二轮会出现重复节点或渲染不出来。
    for (const v of SANDBOX_VIEWS) {
      const { unmount } = renderByKey(v);
      const hits = await screen.findAllByTestId(v.rootTestId, {}, { timeout: 8000 });
      expect(hits.length, `${v.wo}/${v.key} 第二轮渲染出 ${hits.length} 个根节点 —— 上一轮没卸干净`).toBe(1);
      unmount();
      await waitFor(() => expect(screen.queryByTestId(v.rootTestId)).toBeNull());
    }
  });

  it("节点 id 单源：四张图上出现的链路节点 id **全部**在契约 CHAIN_NODE_IDS 在册（前端不许手抄词表）", async () => {
    const known = new Set<string>(CHAIN_NODE_IDS);
    // 链路节点 id 的形状：`<stage>.<name>`，stage 取自契约在册 id 的前缀集合（不手抄）。
    const stages = new Set(CHAIN_NODE_IDS.map((id) => id.split(".")[0]!));
    const shaped = new RegExp(`^(?:${[...stages].join("|")})\\.[a-z0-9_]+$`);
    const offenders: string[] = [];
    for (const v of SANDBOX_VIEWS) {
      const { container, unmount } = renderByKey(v);
      await screen.findByTestId(v.rootTestId, {}, { timeout: 8000 });
      // 从渲染结果里捞所有"长得像链路节点 id"的串（属性值 + 文本），逐个查册。
      const seen = new Set<string>();
      for (const el of Array.from(container.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) if (shaped.test(attr.value)) seen.add(attr.value);
      }
      for (const tok of (container.textContent ?? "").split(/[\s，,;；|（）()[\]]+/)) if (shaped.test(tok)) seen.add(tok);
      for (const id of seen) if (!known.has(id)) offenders.push(`${v.wo}/${v.key}: ${id}`);
      unmount();
    }
    expect(offenders, `下列节点 id 不在 CHAIN_NODE_REGISTRY 在册（前端自造方言 = 三边对不上）：${offenders.join(", ")}`).toEqual(
      [],
    );
  });
});
