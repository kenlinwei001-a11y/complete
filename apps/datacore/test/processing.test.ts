import { describe, expect, it } from "vitest";
import { fold, runProcessing } from "../src/pipeline/processing.js";
import type { ProcessingSpec } from "@platform/contracts";

const ROWS = [
  { order_id: "O1", amount: 10, risk: 0.2, status: "A", event_date: "2026-06-01" },
  { order_id: "O1", amount: 5, risk: 0.9, status: "B", event_date: "2026-06-10" },
  { order_id: "O2", amount: 7, risk: 0.3, status: "C", event_date: "2026-01-01" },
];

const baseSpec = (extra: Partial<ProcessingSpec> = {}): ProcessingSpec => ({
  mappings: [
    { sourceField: "order_id", targetProp: "order_id", dataType: "String", fn: "Last", isPrimaryKey: true },
    { sourceField: "amount", targetProp: "amount", dataType: "Double", fn: "Sum" },
    { sourceField: "risk", targetProp: "order_risk", dataType: "Double", fn: "Max", isStateVariable: true },
    { sourceField: "status", targetProp: "status", dataType: "String", fn: "Last" },
  ],
  mode: "BATCH",
  ...extra,
});

describe("OntoFlow P2 · 数据处理引擎", () => {
  it("PE1: fold 各函数手算", () => {
    const r = [{ v: 3 }, { v: 1 }, { v: 5 }];
    expect(fold(r, "Sum", "v")).toBe(9);
    expect(fold(r, "Max", "v")).toBe(5);
    expect(fold(r, "Min", "v")).toBe(1);
    expect(fold(r, "Avg", "v")).toBe(3);
    expect(fold(r, "Count", "v")).toBe(3);
    expect(fold(r, "First", "v")).toBe(3);
    expect(fold(r, "Last", "v")).toBe(5);
  });

  it("PE2: 按主键分组折叠（Sum/Max/Last）+ 状态变量；确定性重跑一致", () => {
    const a = runProcessing(ROWS, baseSpec());
    const o1 = a.find((e) => e.key === "O1")!;
    const o2 = a.find((e) => e.key === "O2")!;
    expect(o1.props).toMatchObject({ order_id: "O1", amount: 15, order_risk: 0.9, status: "B" });
    expect(o2.props).toMatchObject({ order_id: "O2", amount: 7, order_risk: 0.3, status: "C" });
    const b = runProcessing(ROWS, baseSpec());
    expect(b).toEqual(a); // 确定性
  });

  it("PE3: 失效规则 —— 参考点=最大日期，超 ttl 标 expired", () => {
    const r = runProcessing(ROWS, baseSpec({ expiry: { field: "event_date", ttlDays: 30 } }));
    expect(r.find((e) => e.key === "O1")!.expired).toBeUndefined(); // 6-10 = ref，不过期
    expect(r.find((e) => e.key === "O2")!.expired).toBe(true); // 1-01 距 6-10 > 30 天
  });

  it("PE4: 脱敏 HASH/REDACT/PARTIAL", () => {
    expect(runProcessing(ROWS, baseSpec({ masking: [{ prop: "status", strategy: "REDACT" }] })).every((e) => e.props.status === "***")).toBe(true);
    expect(String(runProcessing(ROWS, baseSpec({ masking: [{ prop: "status", strategy: "HASH" }] }))[0]!.props.status)).toMatch(/^h:[0-9a-f]+$/);
    // PARTIAL 长值：O1 长度 2 → "**"；构造长 pk 验证首尾保留
    const longRows = [{ order_id: "ORDER12345", amount: 1, risk: 0, status: "A", event_date: "2026-06-01" }];
    const r = runProcessing(longRows, baseSpec({ masking: [{ prop: "order_id", strategy: "PARTIAL" }] }));
    expect(r[0]!.props.order_id).toBe("O***5");
  });

  it("PE5: 窗口分组（按 amount 桶 step=10 分组）", () => {
    const rows = [
      { k: "X", amount: 3 },
      { k: "X", amount: 7 },
      { k: "X", amount: 25 },
    ];
    const spec: ProcessingSpec = {
      mappings: [
        { sourceField: "k", targetProp: "k", dataType: "String", fn: "Last" },
        { sourceField: "amount", targetProp: "amount", dataType: "Double", fn: "Sum" },
      ],
      groupBy: { fields: ["k"], window: { field: "amount", step: 10 } },
      mode: "BATCH",
    };
    const r = runProcessing(rows, spec);
    // 桶 0(3,7)→amount=10；桶 20(25)→amount=25 → 两组
    expect(r).toHaveLength(2);
    expect(r.map((e) => e.props.amount).sort((a, b) => Number(a) - Number(b))).toEqual([10, 25]);
  });
});
