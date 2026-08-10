import { Suspense, createElement } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  PROCESS_TASK_WAIT_STATES,
  PROCESS_TASK_WAIT_STATE_META,
  type ProcessStuckResponse,
} from "@platform/contracts";

/**
 * WO-PROCESS-INSTANCE · 流程卡点面板 SEAM。
 *
 * ── 头号判据 ──────────────────────────────────────────────────────────────
 * 需求 §4.5 那句「**为什么这个流程现在卡住了**」在界面上**真的有答案**，且答案是
 * **数据驱动**的：改后端载荷 → 界面必须跟着变。断言指名道姓到那四个字段
 * （卡在哪一步 / 为什么 / 等谁 / 等多久），不是「渲染了一个组件」。
 *
 * ── SEAM 的咬点：咬链路，不咬组件 ────────────────────────────────────────
 * 一律经 `getRenderer("process-stuck")` 取 lazy renderer 再渲染。
 * 直接 `import` 组件只能证明「函数能跑」，证明不了「接线了」——
 * 本仓 F2/F3/F4 连踩三次 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`
 * （实现有、测试有、全绿、**零路由渲染得到**）。
 *
 * ── 第二条纪律：诚实缺席 ─────────────────────────────────────────────────
 * 缺 `waitedMs` / `ownerDisplayName` / `definitionName` 时，界面**不得**出现
 * 「未知 / - / N/A / 0」这类占位符。缺席只是没说，占位符是说了一句假的。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

// ── 网络桩：唯一数据源是 A 侧 /a/v1/process-instances/stuck ──────────────────
const net = vi.hoisted(() => ({
  payload: null as ProcessStuckResponse | null,
  fail: null as unknown,
  calls: 0,
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    fetchStuckProcesses: vi.fn(async () => {
      net.calls += 1;
      if (net.fail !== null) throw net.fail;
      return net.payload;
    }),
  };
});

const DAY = 86_400_000;

/** 一条卡在审批上的实例（满字段）。 */
function approvalRow(over: Record<string, unknown> = {}) {
  return {
    instanceId: "pinst_demo_P17_ord_1",
    definitionKey: "P17",
    definitionName: "销售订单评审接单",
    subjectRef: { typeKey: "Order", objectId: "ord_1" },
    taskId: "ptask_1",
    taskName: "信用超额审批",
    taskSeq: 1,
    waitState: "WAITING_APPROVAL",
    waitRef: "adraft_credit_1",
    ownerFunctionKey: "finance",
    ownerDisplayName: "财务",
    waitingSince: "2026-03-01T00:00:00.000Z",
    waitedMs: 3 * DAY,
    ...over,
  };
}

function tally(rows: { waitState: string }[]) {
  return Object.fromEntries(PROCESS_TASK_WAIT_STATES.map((s) => [s, rows.filter((r) => r.waitState === s).length]));
}

function payloadOf(rows: Record<string, unknown>[]): ProcessStuckResponse {
  return {
    evaluatedAt: "2026-03-04T00:00:00.000Z",
    stuck: rows,
    byWaitState: tally(rows as { waitState: string }[]),
  } as ProcessStuckResponse;
}

/** 经 registry 取 renderer 渲染 —— 这一步就是「接线了没有」的证据。 */
async function renderViaRegistry() {
  const { getRenderer } = await import("@/views/registry");
  const Renderer = getRenderer("process-stuck");
  expect(Renderer, "registry 里没有 process-stuck ⇒ 组件零生产调用方（F2/F3/F4 同款坑）").toBeTruthy();
  render(
    createElement(
      Suspense,
      { fallback: null },
      createElement(Renderer as never, { view: { key: "process-stuck" } as never }),
    ),
  );
}

beforeEach(() => {
  net.payload = null;
  net.fail = null;
  net.calls = 0;
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// ① 接线（缺这条 = 实现有测试绿但没人渲染得到）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 接线", () => {
  it("registry 注册了 process-stuck，且渲染时**真的**打了那个端点", async () => {
    net.payload = payloadOf([approvalRow()]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(net.calls, "渲染必须真去取数，不许用内置示例数据顶上").toBe(1);
  });

  it("endpoints 打的是 A 侧 /a/v1/process-instances/stuck（路径写死在源码里，防漂）", () => {
    const src = readFileSync(join(SRC, "api", "endpoints.ts"), "utf8");
    // 金丝雀：抽取器必须先命中一个已知存在的字串，否则报「工具坏了」而不是「路径不对」。
    expect(src.includes("fetchStuckProcesses"), "金丝雀：endpoints.ts 里连函数名都找不到 ⇒ 读错文件了").toBe(true);
    expect(src.includes("/a/v1/process-instances/stuck")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ② 四问都有答案，且**数据驱动**（改载荷 → 界面跟着变）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 「为什么卡住」四问", () => {
  it("卡在哪一步 / 为什么 / 等谁 / 等多久 —— 四个字段逐条渲染出来", async () => {
    net.payload = payloadOf([approvalRow()]);
    await renderViaRegistry();

    // ① 卡在哪一步
    await waitFor(() => expect(screen.getByTestId("stuck-step").textContent).toContain("信用超额审批"));
    expect(screen.getByTestId("stuck-step").textContent).toContain("第 1 步");
    // ② 为什么 —— 人话来自契约单一来源，且带具体审批单号
    expect(screen.getByTestId("stuck-why").textContent).toContain(
      PROCESS_TASK_WAIT_STATE_META.WAITING_APPROVAL.blocker,
    );
    expect(screen.getByTestId("stuck-waitref").textContent).toBe("adraft_credit_1");
    expect(screen.getByTestId("stuck-badge").textContent).toBe(
      PROCESS_TASK_WAIT_STATE_META.WAITING_APPROVAL.displayName,
    );
    // ③ 等谁
    expect(screen.getByTestId("stuck-owner").textContent).toBe("财务");
    // ④ 等多久
    expect(screen.getByTestId("stuck-waited").textContent).toBe("3 天");
    // 处理对象（这条流程在处理什么）
    expect(screen.getByTestId("stuck-subject").textContent).toBe("Order/ord_1");
  });

  it("**改载荷界面就变**：换等待态 + 换 owner + 换时长，三处显示同时跟着改", async () => {
    net.payload = payloadOf([
      approvalRow({
        waitState: "WAITING_EXTERNAL_SYSTEM",
        waitRef: "supplier_portal:PO-8891",
        ownerFunctionKey: "procurement",
        ownerDisplayName: "采购",
        waitedMs: 5 * DAY + 6 * 3_600_000,
      }),
    ]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-badge")).toBeTruthy());
    expect(screen.getByTestId("stuck-badge").textContent).toBe(
      PROCESS_TASK_WAIT_STATE_META.WAITING_EXTERNAL_SYSTEM.displayName,
    );
    expect(screen.getByTestId("stuck-why").textContent).toContain(
      PROCESS_TASK_WAIT_STATE_META.WAITING_EXTERNAL_SYSTEM.blocker,
    );
    expect(screen.getByTestId("stuck-waitref").textContent).toBe("supplier_portal:PO-8891");
    expect(screen.getByTestId("stuck-owner").textContent).toBe("采购");
    expect(screen.getByTestId("stuck-waited").textContent).toBe("5 天 6 小时");
    // 卡片上带 data-wait-state，五态可被机器区分（不只是一句文案）
    expect(screen.getByTestId("stuck-card").getAttribute("data-wait-state")).toBe("WAITING_EXTERNAL_SYSTEM");
  });

  it("五个等待态**各自**都能渲染出自己的人话（一个都不许漏，且不许串台）", async () => {
    for (const s of PROCESS_TASK_WAIT_STATES) {
      net.payload = payloadOf([approvalRow({ waitState: s, waitRef: `ref_${s}` })]);
      const { unmount } = { unmount: () => {} };
      document.body.innerHTML = "";
      await renderViaRegistry();
      await waitFor(() => expect(screen.getByTestId("stuck-badge")).toBeTruthy());
      expect(screen.getByTestId("stuck-badge").textContent, `${s} 的人话没渲染对`).toBe(
        PROCESS_TASK_WAIT_STATE_META[s].displayName,
      );
      expect(screen.getByTestId("stuck-card").getAttribute("data-wait-state")).toBe(s);
      unmount();
    }
  });

  it("等待态计数条五个 key 恒在（0 是统计事实，与「缺就不显示」不冲突）", async () => {
    net.payload = payloadOf([approvalRow(), approvalRow({ instanceId: "pinst_2", waitState: "WAITING_DATA" })]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("tally-WAITING_APPROVAL")).toBeTruthy());
    expect(screen.getByTestId("tally-WAITING_APPROVAL").textContent).toContain("1");
    expect(screen.getByTestId("tally-WAITING_DATA").textContent).toContain("1");
    // 没有实例的态显示 0（这是「知道，且为零」）
    expect(screen.getByTestId("tally-WAITING_SCHEDULE").textContent).toContain("0");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 诚实缺席（本仓多起事故的直接对策）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 诚实缺席（缺就不显示那一块）", () => {
  it("没有 waitedMs ⇒ 「已等」整块**不渲染**，且界面不出现 0 / 未知 / - / N/A", async () => {
    const row = approvalRow();
    delete (row as Record<string, unknown>).waitedMs;
    delete (row as Record<string, unknown>).waitingSince;
    net.payload = payloadOf([row]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.queryByTestId("stuck-waited"), "没有等待时长就不该有这一块").toBeNull();
    expect(screen.queryByText("已等")).toBeNull();
    for (const bad of ["未知", "N/A", "暂无数据"]) {
      expect(screen.queryByText(bad), `不许用占位符 ${bad} 冒充数据`).toBeNull();
    }
  });

  it("没有 ownerDisplayName ⇒ 退回显示 key 原值（真的），不是「未知」", async () => {
    net.payload = payloadOf([
      approvalRow({ ownerFunctionKey: "tenant_custom_dept", ownerDisplayName: undefined }),
    ]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-owner")).toBeTruthy());
    expect(screen.getByTestId("stuck-owner").textContent).toBe("tenant_custom_dept");
  });

  it("没有 definitionName ⇒ **不渲染**流程名，不拿 definitionKey 冒充名字", async () => {
    const row = approvalRow();
    delete (row as Record<string, unknown>).definitionName;
    net.payload = payloadOf([row]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.queryByTestId("stuck-defname")).toBeNull();
  });

  it("零结果**不说**「一切正常」，而是点明可能只是还没有实例数据", async () => {
    net.payload = payloadOf([]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-empty")).toBeTruthy());
    const txt = screen.getByTestId("stuck-empty").textContent ?? "";
    expect(txt).toContain("不等于");
    expect(txt).toContain("模板");
    expect(txt).not.toContain("一切正常");
  });

  it("功能未开通（404 FEATURE_NOT_FOUND）与「加载失败」是**两种**显示，不合并", async () => {
    net.fail = { code: "FEATURE_NOT_FOUND", status: 404, message: "feature not found" };
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-disabled")).toBeTruthy());
    expect(screen.queryByTestId("stuck-error"), "未开通不是故障，不许显示成错误").toBeNull();

    document.body.innerHTML = "";
    net.fail = { code: "INTERNAL", status: 500, message: "boom" };
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-error")).toBeTruthy());
    expect(screen.queryByTestId("stuck-disabled")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 契约单源 + 主题（前端不得重定义契约已有类型 / 零硬编码颜色）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 单源与主题", () => {
  it("组件从 @platform/contracts 取词表与人话，**没有**手抄一份等待态字面量表", () => {
    const raw = readFileSync(join(SRC, "views", "ProcessStuckView.tsx"), "utf8");
    expect(raw.includes("PROCESS_TASK_WAIT_STATE_META"), "金丝雀：读错文件了").toBe(true);
    expect(raw.includes('from "@platform/contracts"')).toBe(true);

    // ⚠ **必须先剥注释再匹配** —— 初版没剥，结果匹到了组件文档里那句「别在这里手写
    // 一份 `{ WAITING_USER: "等人处理" }`」的**反面教材原文**，把一条讲纪律的注释
    // 判成了违纪代码。形态即铁律 0.6 的句式：「我用『源码文本里出现该模式』当作
    // 『代码里存在该映射』的证据，而前者并不度量后者」——注释也是源码文本。
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    // 金丝雀：剥注释这一步本身得是对的 —— 剥完必须还留着真代码，否则「没匹到」
    // 只是因为把整个文件都剥没了（那是工具坏了，不是代码干净）。
    expect(code.includes("PROCESS_TASK_WAIT_STATE_META"), "金丝雀：剥注释把代码也剥没了 ⇒ 工具坏了").toBe(true);
    expect(code.includes("等人处理"), "金丝雀：注释里的反面教材原文应已被剥掉").toBe(false);

    // 手抄一份 { WAITING_USER: "…" } 的映射即红。
    expect(/WAITING_USER\s*:\s*["'{]/.test(code), "组件里出现自建的 WAITING_* 映射 ⇒ 第二真相源").toBe(false);
  });

  it("mock handler 的 byWaitState 也从契约派生（mock 不许手抄五值）", () => {
    const src = readFileSync(join(SRC, "mocks", "handlers.ts"), "utf8");
    expect(src.includes("PROCESS_TASK_WAIT_STATES"), "mock 应从契约派生等待态词表").toBe(true);
  });

  it("样式零硬编码颜色（三套主题自动跟随）", () => {
    const css = readFileSync(join(SRC, "views", "ProcessStuckView.module.css"), "utf8");
    expect(css.includes("var(--"), "金丝雀：CSS 里连一个 token 都没有 ⇒ 读错文件了").toBe(true);
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const fns = css.match(/\b(rgb|rgba|hsl|hsla)\s*\(/g) ?? [];
    expect(hex, `出现硬编码 hex：${hex.join(",")}`).toHaveLength(0);
    expect(fns, `出现颜色函数字面量：${fns.join(",")}`).toHaveLength(0);
  });
});
