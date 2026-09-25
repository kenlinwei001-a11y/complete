/**
 * WO-C0828-P1 §3 · resolveObjectId 主键匹配对照用例（派单验收：不写对照用例不算修）。
 *
 * 病灶（useOptionAdopt.ts 旧 :42-46）：任意 props 字符串相等即命中——
 * 「另一个对象的某个**非主键**属性值 == 目标业务键」时，宽松匹配会把杠杆写到错对象上，
 * 而屏上看不出来（草稿照样 EXECUTED，只是拨的是别人）。
 */
import { describe, expect, it } from "vitest";
import { resolveObjectId } from "../src/views/sim/unified/console0828/resolveObjectId";
import type { ObjectsPage } from "../src/api/types";

/** 构造一页 Line 对象：错误对象排在**前面**，宽松匹配会先撞上它。 */
function linePage(): ObjectsPage {
  return {
    items: [
      // ⚠ 错误对象：非主键属性 batchNo 的值恰好 == 目标业务键 "LINE-WS-jinhua-slitting"。
      { id: "obj_line_other", type: "Line", props: { lineId: "LINE-WS-other", batchNo: "LINE-WS-jinhua-slitting" } },
      // 正确对象：主键 lineId == 目标业务键。
      { id: "obj_line_LINE-WS-jinhua-slitting", type: "Line", props: { lineId: "LINE-WS-jinhua-slitting", batchNo: "B-0001" } },
    ],
    total: 2,
    hasMore: false,
  } as unknown as ObjectsPage;
}

describe("WO-C0828-P1 §3 · resolveObjectId 主键优先（对照：宽松会选错，主键不会）", () => {
  it("对照：同一页同一业务键，宽松匹配选错对象、主键匹配选对", () => {
    const page = linePage();
    // 宽松（旧行为，pkProp 缺席 ⇒ 回落路径）：撞上排前面的错误对象。
    expect(resolveObjectId("Line", "LINE-WS-jinhua-slitting", page)).toBe("obj_line_other");
    // 主键（新行为）：跳过错误对象的非主键撞名，命中主键相等的正确对象。
    expect(resolveObjectId("Line", "LINE-WS-jinhua-slitting", page, "lineId")).toBe("obj_line_LINE-WS-jinhua-slitting");
  });

  it("主键已声明但查无 ⇒ 不回落宽松（不被非主键撞名拐走），直落命名约定", () => {
    const page: ObjectsPage = {
      items: [
        // 只有非主键撞名，主键谁也不等；命名约定 id 也不存在 ⇒ 必须返回 null，而不是错对象 id。
        { id: "obj_line_other", type: "Line", props: { lineId: "LINE-WS-other", batchNo: "LINE-GHOST" } },
      ],
      total: 1,
      hasMore: false,
    } as unknown as ObjectsPage;
    expect(resolveObjectId("Line", "LINE-GHOST", page, "lineId")).toBeNull();
  });

  it("主键已声明、主键查无、但命名约定 id 存在 ⇒ 落约定 id", () => {
    const page: ObjectsPage = {
      items: [
        { id: "obj_material_pos_lfp", type: "Material", props: { materialId: "MAT-OTHER", alias: "pos_lfp" } },
      ],
      total: 1,
      hasMore: false,
    } as unknown as ObjectsPage;
    // 主键 materialId 不等于 "pos_lfp"（只有非主键 alias 撞名）⇒ 跳过宽松，命名约定 obj_material_pos_lfp 命中。
    expect(resolveObjectId("Material", "pos_lfp", page, "materialId")).toBe("obj_material_pos_lfp");
  });

  it("兼容：类型未声明主键（pkProp 缺席）⇒ 保留旧宽松行为", () => {
    const page: ObjectsPage = {
      items: [{ id: "obj_widget_1", type: "Widget", props: { code: "W-1" } }],
      total: 1,
      hasMore: false,
    } as unknown as ObjectsPage;
    expect(resolveObjectId("Widget", "W-1", page)).toBe("obj_widget_1");
  });

  it("主键值非字符串（数字主键）不误中：宽松旧路只认字符串，主键路同口径", () => {
    const page: ObjectsPage = {
      items: [{ id: "obj_n_1", type: "N", props: { num: 42 } }],
      total: 1,
      hasMore: false,
    } as unknown as ObjectsPage;
    expect(resolveObjectId("N", "42", page, "num")).toBeNull();
  });
});
