import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WO-CAP-07-MODEL-DIM（型号维度·本体链路⑤前端 surface）证：
 * C1 逐值——选型号 → capacity_forecast 出该型号 P50/P90/缺口/主瓶颈 + 型号可产基地网络（PRODUCIBLE_AT），
 *          前端展示逐值 == 求解器端点值（此处以真跑 oracle 4680-NCM 值为夹具：p50 5.1836→"5.2" 等）。
 * C2 非写死——型号下拉来自本体 Model 对象（searchObjects("Model")·真后端），非组件内硬编码列表。
 * 切换型号 → 重调 capacity_forecast、结果随型号变（型号维度真生效）。
 *
 * 夹具值取自真跑（真起 datacore+agentcore·真浏览器逐值对照·见 docs/evidence/wo-cap-07-model-dim-fde.md）。
 */

// 型号可产基地网络（PRODUCIBLE_AT）夹具：4680-NCM（真跑 oracle）与 4680-LFP（证型号维度切换真变）。
const OUT_NCM = {
  p50: 5.1836, p90: 4.8667, healthFactor: 0.93, gap: 35.1333, ok: false, mainBn: "设备OEE",
  dataMode: "LIVE" as const, pendingCertList: [],
  perBaseRows: [
    { base: "常州", weeklyCap: 0.42, certFactor: 1, maintWeek: null, bottleneck: "瓶颈工序", tightness: 65, live: true, cumTotal: 2.5 },
    { base: "成都", weeklyCap: 0.44, certFactor: 1, maintWeek: null, bottleneck: "设备OEE", tightness: 85, live: true, cumTotal: 2.6 },
    { base: "合肥", weeklyCap: 0.43, certFactor: 1, maintWeek: null, bottleneck: "设备OEE", tightness: 87, live: true, cumTotal: 2.6 },
  ],
  nonProducible: [
    { base: "信阳", reason: "基地业态「储能」与型号「动力」不匹配" },
    { base: "厦门", reason: "NCM 体系产线未在该基地铺设 / 认证" },
  ],
  producibleCount: 3, totalBases: 12,
};
const OUT_LFP = {
  p50: 3.6, p90: 3.3, healthFactor: 0.93, gap: 36.7, ok: false, mainBn: "瓶颈工序",
  dataMode: "LIVE" as const, pendingCertList: [],
  perBaseRows: [
    { base: "溧阳", weeklyCap: 0.5, certFactor: 1, maintWeek: null, bottleneck: "瓶颈工序", tightness: 70, live: true, cumTotal: 3.0 },
  ],
  nonProducible: [],
  producibleCount: 1, totalBases: 12,
};

const searchObjectsSpy = vi.fn(async (_type: string, _q?: string) => ({
  // C2：本体 Model 对象（真后端返回形），非组件内写死；modelId 与真跑一致。
  items: [
    { id: "obj_model_4680-NCM", type: "Model", props: { modelId: "4680-NCM" } },
    { id: "obj_model_4680-LFP", type: "Model", props: { modelId: "4680-LFP" } },
    { id: "obj_model_方形-NCM", type: "Model", props: { modelId: "方形-NCM" } },
  ],
}));
const defaultRunSolver = async (key: string, args: Record<string, unknown>) => {
  expect(key).toBe("capacity_forecast");
  const out = args.modelId === "4680-LFP" ? OUT_LFP : OUT_NCM;
  return { data: out, snapshotVersion: "v1" };
};
const runSolverSpy = vi.fn(defaultRunSolver);

vi.mock("@/api/endpoints", () => ({
  searchObjects: (type: string, q: string) => searchObjectsSpy(type, q),
  runSolver: (key: string, args: Record<string, unknown>) => runSolverSpy(key, args),
}));

import ModelCapacitySlice from "@/views/sim/ModelCapacitySlice";

function renderSlice(props: React.ComponentProps<typeof ModelCapacitySlice> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ModelCapacitySlice {...props} />
    </QueryClientProvider>,
  );
}

describe("WO-CAP-07 型号维度切片（本体链路⑤前端 surface）", () => {
  afterEach(() => { cleanup(); searchObjectsSpy.mockClear(); runSolverSpy.mockClear(); runSolverSpy.mockImplementation(defaultRunSolver); });

  it("C2：型号下拉来自本体 Model 对象（searchObjects 真查·非写死列表）", async () => {
    renderSlice();
    const select = await screen.findByTestId("sandbox-model-select");
    // 查的是本体 Model 类型
    expect(searchObjectsSpy).toHaveBeenCalledWith("Model", "");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["4680-NCM", "4680-LFP", "方形-NCM"]);
    // 反证非写死：项目推演的兜底常量（刀片-LFP/VDA-NCM/储能-*）绝不出现（列表纯来自 Model 对象）。
    expect(options).not.toContain("刀片-LFP");
    expect(options).not.toContain("VDA-NCM");
  });

  it("C1 逐值：选真型号 4680-NCM → capacity_forecast 出 P50/P90/缺口/主瓶颈 + 型号可产基地网络（PRODUCIBLE_AT）", async () => {
    renderSlice({ initialModel: "4680-NCM", demand: 40, weeks: 6 });
    // 型号自 what-if 带入为默认
    const select = await screen.findByTestId("sandbox-model-select");
    expect((select as HTMLSelectElement).value).toBe("4680-NCM");

    // 逐值 == capacity_forecast 端点（fmt 一位小数：5.1836→5.2 / 4.8667→4.9 / 35.1333→35.1）。
    await waitFor(() => expect(screen.getByTestId("sandbox-model-p50")).toHaveTextContent("5.2"));
    expect(screen.getByTestId("sandbox-model-p90")).toHaveTextContent("4.9");
    expect(screen.getByTestId("sandbox-model-gap")).toHaveTextContent("35.1");
    expect(screen.getByTestId("sandbox-model-mainbn")).toHaveTextContent("设备OEE");
    // 入参对口（需求 40 / 6 周）传入求解器。
    expect(runSolverSpy).toHaveBeenCalledWith("capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 });

    // 型号级可产基地网络（PRODUCIBLE_AT）：可产基地 + 各基地瓶颈；不可产基地；收敛 3/12。
    const cz = screen.getByTestId("sandbox-model-base-常州");
    expect(cz).toHaveTextContent("瓶颈工序");
    expect(cz).toHaveTextContent("65");
    expect(screen.getByTestId("sandbox-model-base-成都")).toHaveTextContent("设备OEE");
    expect(screen.getByTestId("sandbox-model-nonprod-信阳")).toBeInTheDocument();
    expect(screen.getByTestId("sandbox-model-converge")).toHaveTextContent("3/12");
  });

  it("WO-CAPFORECAST-DATAMODE-HONEST（KILL-MOCK-RED 命门·green→red 锁）：顶层 dataMode=SYNTHETIC 但行 live=true → 行标「合成」非「实测」（合成物化绝不冒充实测·与 S2 徽标口径统一）", async () => {
    // 命门复现：capacity_forecast 顶层 dataMode=SYNTHETIC（合成 provenance 决策世界）但每行 live=true（measurement 维真算）。
    // 修前 ModelCapacitySlice 据行 live 标「实测」= 合成冒充实测（违铁律 0.4）。修后 rowDecisionLive=live && !decisionSynthetic → 标「合成」。
    runSolverSpy.mockImplementation(async (key: string) => {
      expect(key).toBe("capacity_forecast");
      return { data: { ...OUT_NCM, dataMode: "SYNTHETIC" as const }, snapshotVersion: "v1" };
    });
    renderSlice({ initialModel: "4680-NCM", demand: 40, weeks: 6 });
    const cz = await screen.findByTestId("sandbox-model-base-常州");
    await waitFor(() => expect(cz).toHaveTextContent("合成"));
    // green→red：合成决策世界的行绝不标「实测」（移除 rowDecisionLive 的 !decisionSynthetic 门 → 此断言红）。
    expect(cz).not.toHaveTextContent("实测");
    expect(screen.getByTestId("sandbox-model-base-成都")).not.toHaveTextContent("实测");
  });

  it("型号维度真生效：切到 4680-LFP → 重调 capacity_forecast、P50/主瓶颈随型号变", async () => {
    const user = userEvent.setup();
    renderSlice({ initialModel: "4680-NCM", demand: 40, weeks: 6 });
    await waitFor(() => expect(screen.getByTestId("sandbox-model-p50")).toHaveTextContent("5.2"));

    await user.selectOptions(screen.getByTestId("sandbox-model-select"), "4680-LFP");
    await waitFor(() => expect(screen.getByTestId("sandbox-model-p50")).toHaveTextContent("3.6"));
    expect(screen.getByTestId("sandbox-model-mainbn")).toHaveTextContent("瓶颈工序");
    expect(runSolverSpy).toHaveBeenCalledWith("capacity_forecast", { modelId: "4680-LFP", qty: 40, weeks: 6 });
  });

  it("诚实空态：本体无 Model 对象 → 不编造型号（诚实空态·不硬塞兜底列表）", async () => {
    searchObjectsSpy.mockResolvedValueOnce({ items: [] });
    renderSlice();
    await screen.findByTestId("sandbox-model-empty");
    expect(screen.queryByTestId("sandbox-model-select")).toBeNull();
  });
});
