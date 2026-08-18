import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InspectorNodePanel } from "@/views/sim/InspectorNodePanel";
import { CHAIN_LOSS_SOLVER_KEY } from "@/views/sim/chainLineMap";
import { NodeSemanticPayloadSchema, buildNodeLiveView, buildPlaceholderInspectorInput } from "@/views/sim/inspectorModel";

/**
 * WO-R13-ONTOCHAIN-PANEL · 节点检视面板的「本体链」接线门。
 *
 * ── 咬点 ─────────────────────────────────────────────────────────────────
 *  ① ④ 下钻证据行：点「本体链」开关 ⇒ `ontologyChain-drill-<stepId>` 出现，
 *     且 **每段一条独立断言**（对象段 / 边段 / 规则段分开咬），内容逐字符对拍
 *     fixture 载荷原文（drillType.drillId.drillField / derivationEdge / conversion / solverKey）。
 *     —— 变异反证要做到「面板在、规则不在」时**只红规则断言**，三段互不连坐。
 *  ② 再点一次 ⇒ 收起（链块消失）。
 *  ③ ① 瀑布行：响应不带桶级对象/边 ⇒ 对象段与边段必须诚实渲染「后端未下发」
 *     （data-present="0"）+ gaps 明说缺口与口径；规则段至少带真实求解器 key。
 *  ④ ③ KPI 行：同为聚合读数，对象/边缺载诚实标注，规则段带 solverKey。
 *
 * ── 数据纪律 ──────────────────────────────────────────────────────────────
 *  live 载荷 = 真服务抓下来的 fixture（chain-loss-live-evidence.json，26 条 evidence），
 *  不是手写数据；断言基准一律取 fixture 原文，不抄字面量进断言（防"面板抄测试"式假绿）。
 */

// 仓根 = 自**本测试文件**向上第一个含 pnpm-workspace.yaml 的目录（不用 process.cwd()，隔离 worktree 防假绿）。
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[wo-r13-ontochain-inspector.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** 原始 JSON（不经 schema）：逐字符对拍的基准必须是载荷原文。 */
const RAW = JSON.parse(readRepo("apps/frontend-shell/test/fixtures/chain-loss-live-evidence.json")) as {
  nodes: { nodeId: string; label: string; stage: "ORDER" }[];
  evidence: {
    stepId: string;
    nodeId: string;
    label: string;
    days: number;
    drillType: string;
    drillId: string;
    drillField: string;
    drillValue: number;
    drillUnit: string;
    conversion: string;
    derivationEdge: string;
    solverKey: string;
  }[];
  anchor: { so: string };
};
const PAYLOAD = (() => {
  const rest: Record<string, unknown> = { ...RAW };
  delete rest.__fixture_provenance;
  return rest;
})();
const PARSED = NodeSemanticPayloadSchema.parse(PAYLOAD);

/** 挑一条**真带派生边**的证据行当咬点（空串边的行咬不到边段的 present=1）。 */
const TARGET = RAW.evidence.find((e) => e.derivationEdge !== "")!;
const TARGET_NODE = RAW.nodes.find((n) => n.nodeId === TARGET.nodeId)!;

const mountPanel = () =>
  render(
    <InspectorNodePanel
      input={buildPlaceholderInspectorInput({ nodeId: TARGET_NODE.nodeId, label: TARGET_NODE.label, stage: TARGET_NODE.stage })}
      live={buildNodeLiveView(TARGET_NODE.nodeId, PARSED)}
      liveState={{ status: "ready" }}
    />,
  );

afterEach(() => cleanup());

// ═══════════════════════════════════════════════════════════════════════════════
// 0. fixture 自证：这份载荷真有东西可咬（空数据上假绿的防线）
// ═══════════════════════════════════════════════════════════════════════════════
describe("§0 · fixture 自证", () => {
  it("目标证据行真实存在：带派生边、带换算式、带 solverKey", () => {
    expect(RAW.evidence.length).toBeGreaterThan(20);
    expect(TARGET, "fixture 里没有一条带派生边的证据 ⇒ 本门咬不到边段").toBeTruthy();
    expect(TARGET.conversion.length).toBeGreaterThan(0);
    expect(TARGET.solverKey).toBe(CHAIN_LOSS_SOLVER_KEY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ④ 下钻证据行 · 本体链三段逐段独立断言（变异反证：只缺哪段就只红哪段）
// ═══════════════════════════════════════════════════════════════════════════════
describe("§1 · ④ 下钻证据行：本体链展开 ⇒ 对象→边→规则三段对拍载荷原文", () => {
  it("点开关 ⇒ ontologyChain-drill-<stepId> 出现，三段各自咬 fixture 原文；再点收起", async () => {
    const user = userEvent.setup();
    mountPanel();
    const t = `ontologyChain-drill-${TARGET.stepId}`;

    // 收起态：链块不在
    expect(screen.queryByTestId(t)).toBeNull();

    await user.click(screen.getByTestId(`insp-drill-chain-btn-${TARGET.stepId}`));
    expect(screen.getByTestId(t)).toBeInTheDocument();

    // ── 对象段（独立断言）：drillType.drillId.drillField + 真值 + 单位 ──
    const obj = screen.getByTestId(`${t}-object`);
    expect(obj, "对象段缺失或标成未下发").toHaveAttribute("data-present", "1");
    expect(obj.textContent).toContain(`${TARGET.drillType}.${TARGET.drillId}.${TARGET.drillField}`);
    expect(screen.getByTestId(`${t}-object-value`).textContent).toContain(String(TARGET.drillValue));
    expect(screen.getByTestId(`${t}-object-value`).textContent).toContain(TARGET.drillUnit);

    // ── 边段（独立断言）：derivationEdge 原样透出 ──
    const edge = screen.getByTestId(`${t}-edge`);
    expect(edge, "边段缺失或标成未下发").toHaveAttribute("data-present", "1");
    expect(edge.textContent).toContain(TARGET.derivationEdge);

    // ── 规则段（独立断言）：conversion 原文 + solverKey ──
    // 「面板在、规则不在」的变异只会红这一块，不连坐对象/边。
    const rule = screen.getByTestId(`${t}-rule`);
    expect(rule, "规则段缺失或标成未下发").toHaveAttribute("data-present", "1");
    expect(screen.getByTestId(`${t}-rule-formula`).textContent).toBe(TARGET.conversion);
    expect(screen.getByTestId(`${t}-rule-solver`).textContent).toContain(TARGET.solverKey);

    // 再点一次 ⇒ 收起
    await user.click(screen.getByTestId(`insp-drill-chain-btn-${TARGET.stepId}`));
    expect(screen.queryByTestId(t)).toBeNull();
  });

  it("开关只动自己这一行：别的证据行不跟着展开", async () => {
    const user = userEvent.setup();
    mountPanel();
    const other = RAW.evidence.find((e) => e.nodeId === TARGET.nodeId && e.stepId !== TARGET.stepId);
    await user.click(screen.getByTestId(`insp-drill-chain-btn-${TARGET.stepId}`));
    expect(screen.getByTestId(`ontologyChain-drill-${TARGET.stepId}`)).toBeInTheDocument();
    if (other) expect(screen.queryByTestId(`ontologyChain-drill-${other.stepId}`)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ① 瀑布行 · 桶级对象/边响应里没有 ⇒ 诚实缺载 + gaps 明说，规则段带真 solverKey
// ═══════════════════════════════════════════════════════════════════════════════
describe("§2 · ① 瀑布行：桶级对象/边诚实标注「后端未下发」，不许编", () => {
  it("点开关 ⇒ 对象/边 data-present=0 + gaps 写明聚合口径与占位基线；规则段带 solverKey；再点收起", async () => {
    const user = userEvent.setup();
    mountPanel();
    const t = "ontologyChain-wf-queue"; // queue 桶在占位输入里恒有值

    expect(screen.queryByTestId(t)).toBeNull();
    await user.click(screen.getByTestId("insp-wf-chain-btn-queue"));
    expect(screen.getByTestId(t)).toBeInTheDocument();

    // 对象段：响应不带桶级对象 ⇒ 诚实缺载（不许拿桶名冒充对象）
    const obj = screen.getByTestId(`${t}-object`);
    expect(obj).toHaveAttribute("data-present", "0");
    expect(obj).toHaveTextContent("后端未下发");

    // 边段：同样诚实缺载
    const edge = screen.getByTestId(`${t}-edge`);
    expect(edge).toHaveAttribute("data-present", "0");
    expect(edge).toHaveTextContent("后端未下发");

    // 规则段：至少带真实求解器 key（不编公式）
    const rule = screen.getByTestId(`${t}-rule`);
    expect(rule).toHaveAttribute("data-present", "1");
    expect(rule.textContent).toContain(CHAIN_LOSS_SOLVER_KEY);

    // gaps：必须把"为什么缺"与"本桶口径"说在屏上
    const gaps = screen.getByTestId(`${t}-gaps`);
    expect(gaps).toHaveTextContent("聚合");
    expect(gaps).toHaveTextContent("下钻证据");
    expect(gaps).toHaveTextContent("占位"); // 占位基线口径（b.provenance = PLACEHOLDER）

    await user.click(screen.getByTestId("insp-wf-chain-btn-queue"));
    expect(screen.queryByTestId(t)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ③ KPI 行 · 聚合读数同样诚实：对象/边缺载 + gaps，规则段带 solverKey
// ═══════════════════════════════════════════════════════════════════════════════
describe("§3 · ③ 节点级流指标行：聚合读数的本体链诚实缺载", () => {
  it("点开关 ⇒ 对象/边 data-present=0 + gaps 明说；规则段带 solverKey", async () => {
    const user = userEvent.setup();
    mountPanel();
    const t = "ontologyChain-kpi-leadTime";

    await user.click(screen.getByTestId("insp-kpi-chain-btn-leadTime"));
    expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(screen.getByTestId(`${t}-object`)).toHaveAttribute("data-present", "0");
    expect(screen.getByTestId(`${t}-object`)).toHaveTextContent("后端未下发");
    expect(screen.getByTestId(`${t}-edge`)).toHaveAttribute("data-present", "0");
    expect(screen.getByTestId(`${t}-edge`)).toHaveTextContent("后端未下发");
    expect(screen.getByTestId(`${t}-rule`)).toHaveAttribute("data-present", "1");
    expect(screen.getByTestId(`${t}-rule`).textContent).toContain(CHAIN_LOSS_SOLVER_KEY);
    expect(screen.getByTestId(`${t}-gaps`)).toHaveTextContent("聚合");

    await user.click(screen.getByTestId("insp-kpi-chain-btn-leadTime"));
    expect(screen.queryByTestId(t)).toBeNull();
  });
});
