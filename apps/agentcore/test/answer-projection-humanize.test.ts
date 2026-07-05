import { describe, expect, it } from "vitest";
import { summarizeSolverOutput } from "../src/workflow/executor.js";
import { deriveConclusion, humanizeField, isInternalIdValue, META_FIELDS } from "../src/workflow/solver-field-labels.js";

/**
 * WO-ANSWER-PROJECTION-HUMANIZE 齿检（治 G-3 答案投影劣质·审计簇③⑤）：
 *  ① 裸英文 key→人话 label+单位（revert 登记即回退裸 key·红）；
 *  ② 元字段（dataMode/ruleSetVersion/confidence.*）不进 KPI 区→脚注；
 *  ③ 判断类问句必出一句结论叙事（确定性·只引真值）；
 *  ④ 内部对象 id / infeasible 内部术语不直出；
 *  数字红线：投影不新增任何输出里没有的数字。
 * 全确定性·无网络/时钟/LLM。
 */
const PROV = "prov_teeth";
const kpiLabels = (bs: ReturnType<typeof summarizeSolverOutput>) =>
  bs.filter((b) => b.type === "kpi").map((b) => (b as { label: string }).label);
const kpiOf = (bs: ReturnType<typeof summarizeSolverOutput>, label: string) =>
  bs.find((b) => b.type === "kpi" && (b as { label: string }).label === label) as
    | { label: string; value: string; unit?: string }
    | undefined;
const textOf = (bs: ReturnType<typeof summarizeSolverOutput>) =>
  bs.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");

describe("① KPI label 人话化 + 单位", () => {
  it("cockpit_kpi 裸 key → 人话 label + 单位（revAttainPct→营收达成率%·utilPeak→产能利用率峰值%）", () => {
    const blocks = summarizeSolverOutput(
      { data: { supplyV7: 0.92, revAttainPct: 87.5, utilPeak: 96.3, aopBaseRev: 45_0000_0000, cashCushion: 3_0000_0000 } },
      PROV,
      "cockpit_kpi",
    );
    const labels = kpiLabels(blocks);
    expect(labels).toContain("营收达成率");
    expect(labels).toContain("产能利用率峰值");
    expect(labels).toContain("现金缓冲");
    // 齿：裸英文 key 一个都不许残留
    for (const raw of ["supplyV7", "revAttainPct", "utilPeak", "aopBaseRev", "cashCushion"]) {
      expect(labels).not.toContain(raw);
    }
    expect(kpiOf(blocks, "营收达成率")?.unit).toBe("%");
    expect(kpiOf(blocks, "现金缓冲")?.unit).toBe("元");
    // 数字红线：值恒等于输入真值，投影不改数
    expect(kpiOf(blocks, "营收达成率")?.value).toBe("87.5");
  });

  it("capex_scenario 极端裸 label S/G/s0 → 人话（solverKey 消歧）", () => {
    const blocks = summarizeSolverOutput(
      { data: { scenarioKey: "cap-A", s0: [10, 20], S: [30, 40], G: [5, 6] } },
      PROV,
      "capex_scenario",
    );
    const labels = kpiLabels(blocks);
    expect(labels).not.toContain("S");
    expect(labels).not.toContain("G");
    expect(labels).not.toContain("s0");
    expect(labels).toContain("基线供给(按季)");
    expect(labels).toContain("达成供给(按季)");
    expect(labels).toContain("季度缺口(按季)");
  });

  it("齿·revert：humanizeField 登记命中即人话，未登记回落 camelCase 拆词（绝不裸 s0）", () => {
    expect(humanizeField("revAttainPct").label).toBe("营收达成率");
    expect(humanizeField("S", "capex_scenario").label).toBe("达成供给(按季)");
    expect(humanizeField("S", "plan_audit").label).toBe("严重项"); // 同名消歧
    // 未登记字段回落人话拆词（非裸原样）
    expect(humanizeField("someNewField").label).toBe("Some New Field");
  });
});

describe("② 元字段移出 KPI 区 → 脚注", () => {
  it("dataMode/ruleSetVersion/confidence.note 不当 KPI·收拢到口径脚注", () => {
    const blocks = summarizeSolverOutput(
      {
        data: {
          p50: 1200,
          dataMode: "SYNTHETIC",
          ruleSetVersion: "rs-2026-07",
          confidence: { measurement: "PARTIAL", note: "部分数字来自合成补数，未全溯源到真实采集。" },
        },
      },
      PROV,
      "capacity_forecast",
    );
    const labels = kpiLabels(blocks);
    // 齿：元字段绝不在 KPI 区
    expect(labels).not.toContain("dataMode");
    expect(labels).not.toContain("数据模式");
    expect(labels).not.toContain("ruleSetVersion");
    expect(labels).not.toContain("规则集版本");
    expect(labels).not.toContain("置信度");
    // 业务 KPI 仍在
    expect(labels).toContain("P50 产能");
    // 脚注条含口径/版本/置信度（整句 note 不当 KPI）
    const text = textOf(blocks);
    expect(text).toContain("口径与来源");
    expect(text).toContain("SYNTHETIC");
    expect(text).toContain("rs-2026-07");
    expect(text).toContain("部分数字来自合成补数");
  });
});

describe("③ 判断类问句结论叙事（确定性·只引真值）", () => {
  it("verdict/threshold 型（carbon_footprint 值得吗/超标吗）→ 一句结论", () => {
    const blocks = summarizeSolverOutput(
      { data: { modelId: "NCM-4680", total: 349.6, threshold: 70, verdict: "超标" } },
      PROV,
      "carbon_footprint",
    );
    const text = textOf(blocks);
    expect(text).toContain("结论：");
    expect(text).toContain("超标"); // 只引输出里的 verdict 真值
  });

  it("feasible+residualGap（怎么排/闭不闭缺口）→ 结论含可行性 + 残余缺口真值", () => {
    const blocks = summarizeSolverOutput(
      { data: { gap: 120, feasible: false, residualGap: 40, combo: [] } },
      PROV,
      "countermeasure_combo",
    );
    const c = deriveConclusion({ gap: 120, feasible: false, residualGap: 40, combo: [] });
    expect(c).not.toBeNull();
    expect(c).toContain("无可行方案");
    expect(c).toContain("残余缺口 40");
    expect(textOf(blocks)).toContain("结论：");
  });

  it("数字红线：结论叙事绝不出现输出里没有的数字", () => {
    const c = deriveConclusion({ verdict: "通过", residualGap: 0 }) ?? "";
    // 输出只有 residualGap=0 → 结论用『已被完全覆盖』，不得凭空造数
    expect(c).toContain("缺口已被完全覆盖");
    expect(c).not.toMatch(/[1-9]/); // 无杜撰非零数字
  });

  it("无判据字段（纯读出）→ 不强造结论（deriveConclusion 返回 null）", () => {
    expect(deriveConclusion({ baseName: "常州", p50: 1000 })).toBeNull();
  });
});

describe("④ 内部 id / infeasible 内部术语不直出", () => {
  it("对象子字段 id=obj_ 内部 id 不当 KPI 值（S03）", () => {
    expect(isInternalIdValue("obj_01JABCDEF")).toBe(true);
    expect(isInternalIdValue("常州")).toBe(false);
    const blocks = summarizeSolverOutput(
      { data: { base: { id: "obj_01JXYZ", name: "常州", cap: 1500 } } },
      PROV,
      "capex_scenario",
    );
    const values = blocks.filter((b) => b.type === "kpi").map((b) => (b as { value: string }).value);
    expect(values).not.toContain("obj_01JXYZ"); // 内部 id 被剔除
    // 真业务子字段仍在（name/cap）
    expect(values).toContain("常州");
  });

  it("空子字段披露不再直出 infeasible（S13：unresolved→待处理项·人话）", () => {
    const blocks = summarizeSolverOutput(
      { data: { adjustments: [{ eq: "E1", shift: 2 }], unresolved: [] } },
      PROV,
      "maintenance_stagger",
    );
    const text = textOf(blocks);
    expect(text).not.toContain("infeasible");
    expect(text).not.toContain("unresolved");
    expect(text).toContain("待处理项"); // 人话点名
    expect(text).toMatch(/子字段.*：无/);
    expect(blocks.some((b) => b.type === "table")).toBe(true); // 结果表并存
  });
});

describe("⑥ S03 形状齿（复验修·切片 payload 过 solver_summary → 零 JSON 格 + 零 obj_ 值）", () => {
  /** S03（risk_root_cause·常州物料齐套越线）切片形态：对象数组 {id,type,props}——复验原案 props 列曾整段裸 JSON。 */
  const S03_SLICE = {
    data: {
      baseId: "obj_base_changzhou", // ④ 真实 id 形态（下划线）——复验原案 'Base·Id = obj_base_changzhou' KPI
      factor: "物料齐套",
      objects: [
        { id: "obj_order_3391", type: "Order", props: { so: "SO-3391", cust: "整车厂A", qty: 1200, due: "2026-07-10" } },
        { id: "obj_order_3392", type: "Order", props: { so: "SO-3392", cust: "整车厂B", qty: 800, kit: false } },
        { id: "obj_model_4680-NCM", type: "Model", props: { name: "4680-NCM", cap: 1500 } },
      ],
    },
  };
  const allCells = (bs: ReturnType<typeof summarizeSolverOutput>): (string | number | null)[] =>
    bs
      .filter((b) => b.type === "table")
      .flatMap((b) => (b as { rows: (string | number | null)[][] }).rows.flat());
  const allStrings = (bs: ReturnType<typeof summarizeSolverOutput>): string[] => [
    ...allCells(bs).filter((c): c is string => typeof c === "string"),
    ...bs.filter((b) => b.type === "kpi").map((b) => String((b as { value: string }).value)),
    ...bs.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown),
  ];

  it("切片表零裸 JSON 格：props 对象格→紧凑人话（PK 打头 + k=v 串），无 {}/引号 JSON 形状", () => {
    const blocks = summarizeSolverOutput(S03_SLICE, PROV, "risk_root_cause");
    const table = blocks.find((b) => b.type === "table") as { columns: string[]; rows: (string | number | null)[][] } | undefined;
    expect(table).toBeDefined();
    for (const cell of allCells(blocks)) {
      if (typeof cell !== "string") continue;
      expect(cell).not.toMatch(/[{}[\]"]/u); // 零 JSON 形状（原案 '{"so":"SO-3391"...' 整段直出）
      expect(cell.startsWith("{")).toBe(false);
    }
    // props 列人话内容仍在（真值逐项，PK so 优先打头·非 JSON 包裹）
    const joined = allCells(blocks).filter((c): c is string => typeof c === "string").join("\n");
    expect(joined).toContain("SO-3391");
    expect(joined).toContain("cust=整车厂A");
    expect(joined).toContain("qty=1200");
    expect(joined).toContain("4680-NCM");
    expect(joined).toContain("kit=否"); // 布尔人话，非 false 裸 JSON
  });

  it("零 obj_ 值：真实 id 形态（下划线/连字符）全过滤——表格/KPI/文本任何位置不出现", () => {
    const blocks = summarizeSolverOutput(S03_SLICE, PROV, "risk_root_cause");
    for (const s of allStrings(blocks)) {
      expect(s).not.toMatch(/\bobj_[\w-]+/u);
    }
    // KPI 区不再有 'Base Id = obj_base_changzhou'（复验原案）
    const values = blocks.filter((b) => b.type === "kpi").map((b) => (b as { value: string }).value);
    expect(values).not.toContain("obj_base_changzhou");
  });

  it("④ 复验齿：INTERNAL_ID_RE 收下划线/连字符真实 id 形态（原尾段 [0-9a-zA-Z]+ 半漏）", () => {
    expect(isInternalIdValue("obj_base_changzhou")).toBe(true);
    expect(isInternalIdValue("obj_model_4680-NCM")).toBe(true);
    expect(isInternalIdValue("obj_01JABCDEF")).toBe(true); // 原全窄形态仍收
    expect(isInternalIdValue("SO-3391")).toBe(false); // 业务单号非内部 id
    expect(isInternalIdValue("4680-NCM")).toBe(false);
    expect(isInternalIdValue("常州")).toBe(false);
  });

  it("嵌套对象 KPI 路径同守（base.id=obj_base_changzhou 不当值·name/cap 真值仍在）", () => {
    const blocks = summarizeSolverOutput(
      { data: { base: { id: "obj_base_changzhou", name: "常州", cap: 1500 } } },
      PROV,
      "capex_scenario",
    );
    const values = blocks.filter((b) => b.type === "kpi").map((b) => (b as { value: string }).value);
    expect(values).not.toContain("obj_base_changzhou");
    expect(values).toContain("常州");
    expect(values).toContain("1500");
  });
});

describe("META_FIELDS 契约（脚注集合稳定）", () => {
  it("dataMode/ruleSetVersion/confidence 恒在元字段集", () => {
    expect(META_FIELDS.has("dataMode")).toBe(true);
    expect(META_FIELDS.has("ruleSetVersion")).toBe(true);
    expect(META_FIELDS.has("confidence")).toBe(true);
  });
});
