import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { db } from "@/mocks/db";
import { queryClient } from "@/store/queryClient";

/**
 * F19（迁移 · WO-PROJECT-SIM-WHATIF）：⑥ what-if 已从「焊死 3 滑杆（夜班/加产线/外协）+ capacity_forecast whatIf
 * 三系数」迁到**动态杠杆**（自⑤瓶颈反推 + 敏感度排序，走 generic_inference 真重算）。原 3 滑杆断言不再适用——
 * 改为断言动态杠杆集 + tornado + 真重算 deltas + C08 边界 + 多方案矩阵 + 采纳杠杆组合 payload（不删测降覆盖）。
 *
 * SEAM（数据种绑定 × 引擎路由 × 前端渲染，一测压两半）：
 *   ① 杠杆随瓶颈变 ② 拖动→generic_inference 真重算(deltas 非零·逐字投影) ③ 每值 provenance
 *   ④ tornado 排序=真敏感度 ⑤ 边界自 C08 规则闸 ⑥ 多方案矩阵真算 + 一键采纳回填。
 */

async function gotoStep6(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByTestId("pm-stepper");
  await user.click(screen.getByTestId("pm-step-chip-6"));
  await screen.findByTestId("pm-step6");
  await screen.findByTestId("dynamic-lever-panel");
}

describe("F19 · ⑥ 动态杠杆（瓶颈反推 + 敏感度排序 · generic_inference 真重算）", () => {
  it("迁移：动态杠杆集渲染（非焊死 3 滑杆）+ tornado 排序 = 真敏感度降序", async () => {
    loginAs("planner");
    renderApp("/v/project-sim");
    await gotoStep6();

    // 杠杆自⑤瓶颈反推（产能瓶颈 → 产能杠杆集）：设备OEE / 良率 / 利用率 / 外协，非焊死夜班/加产线滑杆。
    expect(screen.queryByTestId("whatif-night")).toBeNull();
    expect(await screen.findByTestId("lever-slider-oee_current")).toBeInTheDocument();
    expect(screen.getByTestId("lever-slider-yield_baseline")).toBeInTheDocument();
    expect(screen.getByTestId("lever-slider-outsourceRatio")).toBeInTheDocument();

    // ④ tornado 顺序 = 敏感度降序（oee 1.8 > yield 1.2 > util 0.9 > outsource 0.6）。
    const bars = within(screen.getByTestId("lever-tornado")).getAllByTestId(/^tornado-bar-/);
    expect(bars.map((b) => b.getAttribute("data-testid"))).toEqual([
      "tornado-bar-oee_current",
      "tornado-bar-yield_baseline",
      "tornado-bar-utilization",
      "tornado-bar-outsourceRatio",
    ]);
  });

  it("SEAM②③ 拖动杠杆 → generic_inference 真重算（携真 {objectType,objectId,prop,value}）→ deltas 非零 + 每值 provenance", async () => {
    loginAs("planner");
    // 捕获 B 侧 run 请求，证携带该杠杆的真对象三元组（objectId 非写死）。
    let captured: { objectType: string; objectId: string; prop: string; value: number } | null = null;
    server.use(
      http.post("*/b/v1/solvers/generic_inference/run", async ({ request }) => {
        const body = (await request.json()) as { args?: { apply?: { objectType: string; objectId: string; prop: string; value: number }[] } };
        captured = body.args?.apply?.[0] ?? null;
        return HttpResponse.json({
          data: { deltas: [{ objId: "obj_Base_CZ", type: "Base", prop: "oeeIndex", before: 0.8, after: 0.91 }], rows: [{ objectId: "obj_Base_CZ", type: "Base", prop: "oeeIndex", before: 0.8, after: 0.91 }], affectedObjects: 1, count: 1, rootTypes: ["Equipment"] },
          snapshotVersion: "ov-gi",
        });
      }),
    );
    renderApp("/v/project-sim");
    await gotoStep6();

    fireEvent.change(await screen.findByTestId("lever-slider-oee_current"), { target: { value: "0.95" } });
    await waitFor(() => expect(screen.getByTestId("lever-deltas")).toBeInTheDocument());
    // 携真三元组（objectId 来自杠杆发现的真对象，非写死）
    expect(captured).toEqual({ objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", value: 0.95 });
    // 逐字投影 before/after（KILL-MOCK：喂显式 payload → 逐字渲）+ 影响面计数
    expect(screen.getByTestId("lever-affected-count")).toHaveTextContent("1");
    const row = screen.getByTestId("lever-delta-row-obj_Base_CZ-oeeIndex");
    expect(within(row).getByTestId("lever-before-obj_Base_CZ-oeeIndex")).toHaveTextContent("0.800");
    expect(within(row).getByTestId("lever-after-obj_Base_CZ-oeeIndex")).toHaveTextContent("0.910");
    // ③ 每值 provenance（可展开·非裸数字·<Provenance> 渲成 prov-v-<testId>）
    expect(within(row).getByTestId("prov-v-ld-obj_Base_CZ-oeeIndex")).toBeInTheDocument();
  });

  it("SEAM④ tornado 排序=真敏感度：改 mock 敏感度 → 顺序随之变（证排序非写死）", async () => {
    loginAs("planner");
    // 反转敏感度：outsource 最大 → 排最前。
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { mode?: string } };
        if (body.args?.mode !== "levers") return HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: [] }, snapshotVersion: "ov-gi" });
        return HttpResponse.json({
          data: {
            levers: [
              { objectType: "Order", objectId: "obj_Order_X", prop: "outsourceRatio", factor: "外协", currentValue: 0, sensitivity: 2.5, provenance: { src: "s", formula: "f", inputs: [] } },
              { objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", factor: "设备OEE", currentValue: 0.82, sensitivity: 0.3, provenance: { src: "s", formula: "f", inputs: [] } },
            ],
            deltas: [], rows: [], affectedObjects: 0, count: 2, rootTypes: ["Order", "Equipment"],
          },
          snapshotVersion: "ov-lv",
        });
      }),
    );
    renderApp("/v/project-sim");
    await gotoStep6();
    await screen.findByTestId("tornado-bar-outsourceRatio");
    const bars = within(screen.getByTestId("lever-tornado")).getAllByTestId(/^tornado-bar-/);
    expect(bars.map((b) => b.getAttribute("data-testid"))).toEqual(["tornado-bar-outsourceRatio", "tornado-bar-oee_current"]);
  });

  it("SEAM⑤ 边界自 C08 规则闸：外协杠杆 max 读 C08 阈值（改闸值 → 上限随之变，非内联 20）", async () => {
    loginAs("planner");
    renderApp("/v/project-sim");
    await gotoStep6();
    // 默认 C08 = ratio 0.2 → 外协滑杆 max=0.2
    const outsource = await screen.findByTestId("lever-slider-outsourceRatio");
    expect(outsource).toHaveAttribute("max", "0.2");
    // 改 C08 闸值为 0.3 → 上限随之变（清缓存证重取规则表·非内联 20）
    server.use(
      http.get("*/a/v1/rules", () =>
        HttpResponse.json([{ id: "rule-c08", key: "C08", name: "外协红线", expression: "Order.outsourceRatio <= 0.3", severity: "WARN", version: 2, status: "PUBLISHED" }]),
      ),
    );
    cleanup();
    queryClient.clear();
    renderApp("/v/project-sim");
    await gotoStep6();
    await waitFor(() => expect(screen.getByTestId("lever-slider-outsourceRatio")).toHaveAttribute("max", "0.3"));
  });

  it("SEAM① 杠杆随瓶颈变：物料瓶颈项目 → 物料杠杆集（含外协/长协覆盖），不含设备OEE 杠杆（证非写死）", async () => {
    loginAs("planner");
    let sentFactors: string[] | undefined;
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { mode?: string; factors?: string[] } };
        if (body.args?.mode !== "levers") return HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: [] }, snapshotVersion: "ov-gi" });
        sentFactors = body.args?.factors; // 证杠杆发现由⑤瓶颈因子驱动（非写死）
        return HttpResponse.json({
          data: {
            levers: [
              { objectType: "Order", objectId: "obj_Order_SO-1", prop: "outsourceRatio", factor: "物料齐套·外协", currentValue: 0, sensitivity: 1.1, provenance: { src: "s", formula: "f", inputs: [] } },
              { objectType: "MaterialBalance", objectId: "obj_MB_1", prop: "coverage", factor: "物料齐套·长协覆盖", currentValue: 0.72, sensitivity: 0.7, provenance: { src: "s", formula: "f", inputs: [] } },
            ],
            deltas: [], rows: [], affectedObjects: 0, count: 2, rootTypes: ["Order", "MaterialBalance"],
          },
          snapshotVersion: "ov-lv",
        });
      }),
    );
    renderApp("/v/project-sim");
    await gotoStep6();
    // 物料杠杆集：含 coverage/外协，不含设备OEE 杠杆
    expect(await screen.findByTestId("lever-slider-coverage")).toBeInTheDocument();
    expect(screen.getByTestId("lever-slider-outsourceRatio")).toBeInTheDocument();
    expect(screen.queryByTestId("lever-slider-oee_current")).toBeNull();
    // 杠杆发现请求携带⑤瓶颈因子（非空 → 由真瓶颈驱动）
    expect(sentFactors && sentFactors.length).toBeGreaterThan(0);
  });

  it("SEAM⑥ 多方案矩阵真算 + 一键采纳回填杠杆 + 采纳 → Action(杠杆组合 payload)", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await gotoStep6();

    // 三方案矩阵（max_产能 / min_代价 / 均衡），各方案 generic_inference 真算 → capGain 各异（非写死）
    await screen.findByTestId("scheme-row-maxCap");
    const cap = within(screen.getByTestId("scheme-capgain-maxCap")).getByText(/\d/).textContent;
    const bal = within(screen.getByTestId("scheme-capgain-balanced")).getByText(/\d/).textContent;
    expect(cap).not.toEqual(bal); // 方案不同 → 矩阵各行不同（真算·非写死）

    // 一键采纳某方案 → 回填杠杆滑杆值（滑杆 value 变到方案值）
    const oeeBefore = (screen.getByTestId("lever-slider-oee_current") as HTMLInputElement).value;
    await user.click(screen.getByTestId("scheme-adopt-maxCap"));
    await waitFor(() => expect((screen.getByTestId("lever-slider-oee_current") as HTMLInputElement).value).not.toBe(oeeBefore));

    // 采纳杠杆组合 → Action 草稿（payload = 动态杠杆组合 + 推演快照）
    await user.click(screen.getByTestId("lever-adopt"));
    expect(await screen.findByText(/草稿已创建，待审批/)).toBeInTheDocument();
    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("采纳产能保障方案");
    const payload = draft.payload as { modelId: string; levers: { objectType: string; prop: string; value: number }[]; snapshot: { mainBn: string } };
    expect(payload.modelId).toBe("4680-NCM");
    expect(Array.isArray(payload.levers)).toBe(true);
    expect(payload.levers.length).toBeGreaterThan(0);
    expect(payload.levers[0]).toHaveProperty("objectType");
    expect(payload.levers[0]).toHaveProperty("prop");
    expect(payload.levers[0]).toHaveProperty("value");
  });
});
