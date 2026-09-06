import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WO-ORDER-WORKORDER-UI · 订单台账行展开 —— **接缝门（SEAM-GATE）**。
 *
 * ── 这道门咬的是「后端有边 → 屏上看得见」，不是「投影函数算得对」 ───────────────
 * 反面教材（本仓假绿第 9 形态）：只测 `propZh()` 之类的纯函数，函数绿、链路断，
 * 屏上照样一片裸英文键。故本文件：
 *   ① 一律经 `getRenderer("ledger")` 取到 lazy renderer 再渲染 —— 直接 import 组件
 *      只能证明"函数能跑"，证明不了"这个视图接了线"；
 *   ② 断言全部落在**用户看得见的字**上（`screen.getByText` / 表格单元格），
 *      不断言内部状态。
 *
 * ── 载荷来源：**真后端**，不是我编的 ──────────────────────────────────────────
 * `fixtures/order-workorder-real.json` = 2026-09-04 起内存态 datacore（SEED_DEMO=1·seed 42）
 * 逐条录制的真返回体（本体类型 / 两张订单 / 三次邻接 / 一张工单）。
 * 所以本文件里没有一个我发明的 propKey、中文名或工单号。
 *
 * ── 三条判据，缺一条这个单就不算交付 ──────────────────────────────────────────
 *  A（有工单）SO-3391 → 工单号/型号/基地/状态四格必须逐字等于后端那张工单；
 *  B（无工单）SO-3402 → 必须显示「无关联工单」，**不是空白、不是没有该区块**；
 *  方向 → 前端发出的邻接请求必须是 `direction:"in"`。`fulfills` 是 WorkOrder→Order，
 *        问 `out` 后端回 `{"groups":[]}` 且 **HTTP 200**（夹具 `neighbors.A_out` 就是那份实测），
 *        方向写反 = 恒空且不报错，屏上与"真没有工单"**一模一样**。这条只有机器能盯住。
 */

const FIX = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "order-workorder-real.json"), "utf8"),
) as {
  objectTypes: Record<string, { key: string; displayName: string; properties: { propKey: string; displayName?: string }[]; derivedProperties: { propKey: string; displayName?: string }[] }>;
  orders: Record<"A" | "B", { data: { id: string; type: string; props: Record<string, unknown> } }>;
  neighbors: Record<"A_in" | "A_out" | "B_in", { groups: { linkKey: string; direction: "out" | "in"; total: number; items: { id: string; typeKey: string; objectKey: string; display: string }[] }[] }>;
  workOrders: Record<string, { data: { id: string; type: string; props: Record<string, unknown> } }>;
};

const A = FIX.orders.A.data; // SO-3391 —— 后端确有 1 张工单
const B = FIX.orders.B.data; // SO-3402 —— 后端 0 张
const WO_KEY = "WO-LINE-WS-hefei-filling-1";
const WO = FIX.workOrders[WO_KEY]!.data.props;

const net = vi.hoisted(() => ({ neighborCalls: [] as { objectId: string; opts?: { linkKey?: string; direction?: string } }[] }));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  const fix = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "order-workorder-real.json"), "utf8"),
  );
  return {
    ...actual,
    queryObjectsPaged: vi.fn(async () => ({
      items: [fix.orders.A.data, fix.orders.B.data],
      total: 2,
      page: 1,
      pageSize: 50,
      hasMore: false,
    })),
    fetchObjectTypes: vi.fn(async () => Object.values(fix.objectTypes)),
    fetchNeighbors: vi.fn(async (objectId: string, opts?: { linkKey?: string; direction?: string }) => {
      net.neighborCalls.push({ objectId, opts });
      // 与真后端同语义：`fulfills` 只有入边有结果，问 out 回空 groups（不是报错）。
      if (opts?.direction === "out") return fix.neighbors.A_out;
      if (objectId === fix.orders.A.data.id) return fix.neighbors.A_in;
      return fix.neighbors.B_in;
    }),
    fetchObjectByKey: vi.fn(async (typeKey: string, objectKey: string) => {
      if (typeKey === "WorkOrder" && fix.workOrders[objectKey]) return fix.workOrders[objectKey];
      throw new Error("not found");
    }),
  };
});

import { getRenderer } from "@/views/registry";

async function renderLedger() {
  const Renderer = getRenderer("ledger");
  expect(Renderer, "renderer key `ledger` 必须在 registry 里注册（接线证据，不是组件存在）").toBeTruthy();
  const Ledger = Renderer!;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Suspense fallback={<div>loading</div>}>
        <Ledger view={{ key: "order", title: "订单台账", renderer: "ledger", layout: undefined, options: undefined }} />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByTestId("ledger", undefined, { timeout: 5000 });
}

/** 点开某张订单的行（台账是「点行展开」，不是浮层不是跳页）。 */
async function expandRow(objectId: string) {
  const row = await screen.findByTestId(`ledger-row-${objectId}`, undefined, { timeout: 5000 });
  await userEvent.click(row);
}

describe("WO-ORDER-WORKORDER-UI · 台账行展开的工单与中文名（接缝）", () => {
  beforeEach(() => {
    net.neighborCalls.length = 0;
  });

  it("§1 金丝雀：夹具本身就是真后端那份（A 有 1 张边 · A 的 out 恒空 · B 零张）", () => {
    // 报「B 没有工单」这类否定结论之前，先证明取数的路子是通的：A 必须中。
    expect(FIX.neighbors.A_in.groups[0]!.total).toBe(1);
    expect(FIX.neighbors.A_in.groups[0]!.items[0]!.objectKey).toBe(WO_KEY);
    expect(FIX.neighbors.A_out.groups).toEqual([]); // ← 方向反了就是这个样子，且 HTTP 200
    expect(FIX.neighbors.B_in.groups).toEqual([]);
    // 中文名的单一来源在后端：Order 17 个属性 + 1 个派生，一个都不许缺。
    const missing = [
      ...FIX.objectTypes.Order!.properties.filter((p) => !p.displayName).map((p) => p.propKey),
      ...FIX.objectTypes.Order!.derivedProperties.filter((p) => !p.displayName).map((p) => p.propKey),
    ];
    expect(missing, "后端未登记中文名的属性（登记表 = synthetic/battery.ts 的 PROP_DISPLAY_NAMES）").toEqual([]);
  });

  it("§2 A（后端有边）：工单号 · 型号 · 基地 · 状态四格逐字上屏", async () => {
    await renderLedger();
    await expandRow(A.id);
    const woRow = await screen.findByTestId(`ledger-wo-row-${WO_KEY}`, undefined, { timeout: 5000 });
    const cells = within(woRow).getAllByRole("cell").map((c) => c.textContent);
    // 四个值全部取自后端那张工单对象，不是渲染写死。
    expect(cells).toEqual([String(WO.woId), String(WO.modelId), String(WO.baseId), String(WO.status)]);
    expect(screen.getByTestId("ledger-wo-count").textContent).toContain("1");
    // 表头中文同样来自本体（WorkOrder.displayName），前端不内联列名。
    const zhOf = (k: string) => FIX.objectTypes.WorkOrder!.properties.find((p) => p.propKey === k)!.displayName!;
    for (const k of ["woId", "modelId", "baseId", "status"]) {
      expect(within(woRow.closest("table")!).getByText(zhOf(k))).toBeTruthy();
    }
  });

  it("§3 方向：从订单出发必须问 direction=in（写成 out 恒空且不报错）", async () => {
    await renderLedger();
    await expandRow(A.id);
    await waitFor(() => expect(net.neighborCalls.length).toBeGreaterThan(0));
    const call = net.neighborCalls.find((c) => c.objectId === A.id)!;
    expect(call.opts?.linkKey).toBe("fulfills");
    expect(call.opts?.direction, "fulfills 是 WorkOrder→Order（N:1），从订单出发只有入边有结果").toBe("in");
  });

  it("§4 B（后端零边）：必须显示「无关联工单」，不是空白、不是没有该区块", async () => {
    await renderLedger();
    await expandRow(B.id);
    // 区块本身必须在（"查了，真没有" ≠ "系统没查"，两者在屏上必须分得出）。
    const block = await screen.findByTestId("ledger-wo", undefined, { timeout: 5000 });
    const none = await within(block).findByTestId("ledger-wo-none", undefined, { timeout: 5000 });
    expect(none.textContent?.trim().length, "缺席文案不许是空白").toBeGreaterThan(0);
    expect(within(block).queryByTestId("ledger-wo-count")).toBeNull();
  });

  it("§5 属性名：屏上是业务名，裸英文键只留在 title（单源 = 后端 displayName）", async () => {
    await renderLedger();
    await expandRow(A.id);
    await screen.findByTestId("ledger-prop-so", undefined, { timeout: 5000 });
    const zh = new Map<string, string>([
      ...FIX.objectTypes.Order!.properties.map((p) => [p.propKey, p.displayName!] as const),
      ...FIX.objectTypes.Order!.derivedProperties.map((p) => [p.propKey, p.displayName!] as const),
    ]);
    for (const k of Object.keys(A.props)) {
      const el = screen.getByTestId(`ledger-prop-${k}`);
      expect(el.textContent, `属性 ${k} 屏上应显示本体登记的中文业务名`).toBe(zh.get(k) ?? k);
      expect(el.getAttribute("title"), "技术键保留在 title 供工程排查").toBe(k);
    }
    // 反向：本单修的就是"屏上一片裸英文键"，故这里显式咬住裸键**不再**作为可见文本出现。
    expect(screen.queryByText("customerId")).toBeNull();
    expect(screen.queryByText("demandDelta")).toBeNull();
  });
});
