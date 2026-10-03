import { describe, expect, it } from "vitest";
import { lookupReusableByQuestion, tokenizeQuestion, type SliceDescriptor } from "../src/ontology/slice-index.js";

/**
 * 增量4 · E6 切片按近似问句复用（P2）：description + indexEntities 检索命中既有切片，不重规划。
 * 确定性（R6，无网络/LLM）：同问句同切片集同命中。
 */

const descriptors: SliceDescriptor[] = [
  { sliceKey: "slice_order_bottleneck", rootType: "Order", description: "订单经工序共享瓶颈设备降级影响交付", indexEntities: ["Order", "Process", "Equipment"] },
  { sliceKey: "slice_order_credit", rootType: "Order", description: "客户信用额度敞口订单", indexEntities: ["Order", "Customer"] },
  { sliceKey: "slice_line_util", rootType: "Line", description: "产线利用率排产", indexEntities: ["Line", "Base"] },
];

describe("增量4 · E6 切片近似问句复用", () => {
  it("tokenizeQuestion 确定性：同串两次分词一致 + 含 CJK bigram", () => {
    const a = tokenizeQuestion("订单瓶颈降级");
    const b = tokenizeQuestion("订单瓶颈降级");
    expect(a).toEqual(b);
    expect(a).toContain("订单");
    expect(a).toContain("瓶颈");
  });

  it("近似问句命中既有切片（同 rootType，词重叠 ≥ 阈值）→ 复用 sliceKey", () => {
    // 近似句（措辞不同但语义贴近 slice_order_bottleneck 的 description/实体）
    const hit = lookupReusableByQuestion(descriptors, "Order", "某工序瓶颈设备故障导致订单降级、交付受影响");
    expect(hit).not.toBeNull();
    expect(hit!.sliceKey).toBe("slice_order_bottleneck");
    expect(hit!.score).toBeGreaterThan(0.2);
  });

  it("不同语义问句 → 命中对应切片（信用问句命中 credit 切片，非 bottleneck）", () => {
    const hit = lookupReusableByQuestion(descriptors, "Order", "这个客户的信用额度还够不够接新订单，敞口多大");
    expect(hit!.sliceKey).toBe("slice_order_credit");
  });

  it("rootType 不匹配 → 不跨 root 误复用（Line 问句不命中 Order 切片）", () => {
    const hit = lookupReusableByQuestion(descriptors, "Line", "产线利用率排产");
    expect(hit!.sliceKey).toBe("slice_line_util");
  });

  it("无关问句（全低于阈值）→ null（不硬凑复用，走正常规划）", () => {
    const hit = lookupReusableByQuestion(descriptors, "Order", "天气怎么样适合钓鱼吗");
    expect(hit).toBeNull();
  });

  it("确定性 R6：同问句两次查命中同一 sliceKey + 同分", () => {
    const q = "工序共享瓶颈设备降级影响订单交付";
    const a = lookupReusableByQuestion(descriptors, "Order", q);
    const b = lookupReusableByQuestion(descriptors, "Order", q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
