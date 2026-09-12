import { describe, expect, it } from "vitest";
import { generateRelatedDatasets, applyScenarioTopology, type DatasetSpec } from "../src/synthetic/schema-gen.js";

/**
 * PRD-fde §3.4 场景化数据构造：数据模拟 = 造"被问现象真实存在"的世界,而非类型对的随机行。
 *
 * 故事脚本（~100 字）：C、D 两客户的扩产订单要看"共享瓶颈"。光造一堆订单+工序没用——必须让两单的订单
 * 真的**路由到同一道工序/设备**,且该资源产能 < 两单需求和,瓶颈才真实存在、求解器才找得出"谁挤占谁"。
 * 验证:加 sharedResources(Order 共享 1 个 Process)后,生成数据里**所有 Order 的 procRef 真的指向同一个
 * 真实 Process PK**;加 plantedValues(Process.capacity=10) 后该列全是 10(产能被植成瓶颈值)。确定性 R6。
 */
const SPECS: DatasetSpec[] = [
  { datasetKey: "Process", rowCount: 5, fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
  { datasetKey: "Order", rowCount: 12, fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "procRef", dataType: "ref", refToDataset: "Process" }, { name: "qty", dataType: "number" }] },
];
function col(csv: string, name: string): string[] {
  const lines = csv.split("\n");
  const idx = lines[0]!.split(",").indexOf(name);
  return lines.slice(1).map((r) => r.split(",")[idx]!);
}

describe("PRD-fde §3.4 · 场景化数据构造（瓶颈真实存在）", () => {
  it("sharedResources count=1 → 所有订单收敛到同一个真实 Process（共享瓶颈真实存在）", () => {
    const base = generateRelatedDatasets(SPECS, 42);
    const procPks = new Set(col(base.Process!, "procId"));
    // 基线:FK 一致但分散(不一定都同一个)
    const baseRefs = new Set(col(base.Order!, "procRef"));
    expect(baseRefs.size).toBeGreaterThanOrEqual(1);

    const scen = applyScenarioTopology(base, SPECS, { sharedResources: [{ resourceType: "Process", sharedByType: "Order", viaField: "procRef", count: 1 }] });
    const refs = col(scen.Order!, "procRef");
    expect(new Set(refs).size).toBe(1); // 全部订单 → 同一道工序（最挤）
    expect(procPks.has(refs[0]!)).toBe(true); // 且是真实存在的 Process PK（FK 仍闭合）
  });

  it("count=2 → 收敛到 2 个共享资源（争用，谁挤占谁可分）", () => {
    const scen = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, { sharedResources: [{ resourceType: "Process", sharedByType: "Order", viaField: "procRef", count: 2 }] });
    expect(new Set(col(scen.Order!, "procRef")).size).toBe(2);
  });

  it("plantedValues → 把产能植成瓶颈值（capacity=10 全行）", () => {
    const scen = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, { plantedValues: [{ typeKey: "Process", field: "capacity", value: 10, everyN: 1 }] });
    expect(col(scen.Process!, "capacity").every((v) => v === "10")).toBe(true);
  });

  it("确定性 R6：同输入两次构造字节级一致;everyN 间隔植入", () => {
    const a = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, { plantedValues: [{ typeKey: "Process", field: "capacity", value: 10, everyN: 2 }] });
    const b = applyScenarioTopology(generateRelatedDatasets(SPECS, 42), SPECS, { plantedValues: [{ typeKey: "Process", field: "capacity", value: 10, everyN: 2 }] });
    expect(a.Process).toEqual(b.Process);
    const caps = col(a.Process!, "capacity");
    expect(caps[0]).toBe("10"); // 第 0 行植入
    expect(caps[1]).not.toBe("10"); // 第 1 行保留(everyN=2)
  });

  it("瓶颈联合验证：共享 1 工序 + 植入低产能 → 需求和 > 产能（求解器能判瓶颈）", () => {
    let d = generateRelatedDatasets(SPECS, 42);
    d = applyScenarioTopology(d, SPECS, {
      sharedResources: [{ resourceType: "Process", sharedByType: "Order", viaField: "procRef", count: 1 }],
      plantedValues: [{ typeKey: "Process", field: "capacity", value: 10, everyN: 1 }],
    });
    const sharedProc = col(d.Order!, "procRef")[0]!;
    const demand = col(d.Order!, "qty").reduce((s, q) => s + Number(q), 0);
    expect(new Set(col(d.Order!, "procRef")).size).toBe(1); // 都挤这一道
    expect(demand).toBeGreaterThan(10); // 需求和 > 植入产能 10 → 瓶颈真实存在
    expect(sharedProc).toBeTruthy();
  });
});
