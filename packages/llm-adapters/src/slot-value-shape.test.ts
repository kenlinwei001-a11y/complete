import { describe, expect, it } from "vitest";
import { harvestClassificationSlots, normalizeSlotValue, reportUnconsumedSlots } from "./slot-harvest.js";
import { OpenAICompatAdapter } from "./openai.js";

/**
 * ★ WO-BASE-SLOT-UNIFY §B / §E-3 · **槽值形态归一 SEAM**（`G-SLOT-VALUE-SHAPE`）。
 *
 * 治的病（2026-08-05 真 Kimi k2.5·同一道题连跑 5 次的第 5 跑，**报文原样**在下面 KIMI_RUN5_BODY）：
 *   收割器把「袋子」收对了（位置层 #106 已治），但袋子里每个值都被模型包了一层类型标注信封
 *   `{"type":"objectRef","value":"4680"}` → 交出去的是包装对象 → `validateSlotValue` 必挂 → 反问。
 *   #106 是「抽到了被丢掉」，这条是「袋子收对了值没归一」—— 同一条槽位链上的**不同的病**。
 *
 * 两条测（缺一不可·工单 §E-3）：
 *  ① 正向：真报文四个槽全部归一成裸值（`4680` / `0.2` / `6` / `常州`）；
 *  ② **反向**：合法的 object ref `{objectType,objectId}` **不许**被拆坏 —— 拆包放宽就是把一个病换成另一个病。
 *
 * 变异反证（工单 §E-3·须真跑真转红）：
 *  ① `slot-harvest.ts` 合并循环里去掉 `normalizeSlotValue`（直接 `slots[k]=raw0`）→ ①/③/④ 转红；
 *  ② 把 `slotValueWrapper` 的判据放宽到「有 value 键就拆」（删掉 `typeof v.type !== "string"` 那行）
 *     → ② 转红（`{objectType:"Base",objectId:"changzhou",value:...}` 形态被拆坏）。
 */

/** 真 Kimi 第 5 跑原样报文（工单 §B 抬头那一行）：每个槽值都包了一层 `{type,value}`。 */
const KIMI_RUN5_SLOTS =
  '{"model":{"type":"objectRef","value":"4680"},"demandDelta":{"type":"number","value":0.2},' +
  '"weeks":{"type":"number","value":6},"base":{"type":"string","value":"常州"}}';
const KIMI_RUN5_BODY =
  '{"outOfCatalog":false,"candidates":[{"intentKey":"capacity_feasibility","confidence":0.93}],' +
  `"extractedSlotsJson":${JSON.stringify(KIMI_RUN5_SLOTS)}}`;

function kimiStub(body: string) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: body } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      },
    },
  };
}

describe("WO-BASE-SLOT-UNIFY §E-3① · 真 Kimi `{type,value}` 报文 → 四个槽全部归一成裸值", () => {
  it("收割器直测：extractedSlotsJson 里四个信封槽 → 裸值（**不是**包装对象）", () => {
    const h = harvestClassificationSlots(JSON.parse(KIMI_RUN5_BODY));
    console.log("\n  ── §E-3① 真报文归一 ──\n  slots=" + JSON.stringify(h.slots) + "\n  unwrapped=" + JSON.stringify(h.unwrapped));
    // ★ 命门：裸值。归一缺席时这里是 {"model":{"type":"objectRef","value":"4680"}, …}
    expect(h.slots).toEqual({ model: "4680", demandDelta: 0.2, weeks: 6, base: "常州" });
    // 留痕（工单 §B 要求 2：拆包不许静默）——顺序 = 袋内键序（JSON.parse 保序·确定性 R6）
    expect(h.unwrapped).toEqual(["model:objectRef", "demandDelta:number", "weeks:number", "base:string"]);
    expect(h.unconsumed).toEqual([]);
  });

  it("穿**真 OpenAI 兼容适配器**（classify 全链）→ RawClassification.extractedSlots 已是裸值", async () => {
    const a = new OpenAICompatAdapter({ client: kimiStub(KIMI_RUN5_BODY) as never });
    const r = await a.classify({ model: "kimi-k2.5", system: "s", user: "4680 加 20% 六周常州能不能接" });
    console.log("  ── §E-3① 适配器出口 ──\n  extractedSlots=" + JSON.stringify(r.extractedSlots));
    expect(r.candidates[0]?.intentKey).toBe("capacity_feasibility");
    expect(r.extractedSlots).toEqual({ model: "4680", demandDelta: 0.2, weeks: 6, base: "常州" });
  });

  it("留痕有**真消费方**（落日志·不是只定义不调用）", () => {
    const lines: string[] = [];
    reportUnconsumedSlots("test", { unconsumed: [], unwrapped: ["base:string"] }, { warn: (m) => lines.push(m) });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("base:string");
    reportUnconsumedSlots("test", { unconsumed: [], unwrapped: [] }, { warn: (m) => lines.push(m) });
    expect(lines.length).toBe(1); // 没拆过就不刷屏
  });
});

describe("WO-BASE-SLOT-UNIFY §E-3② · **反向**：合法 object ref 不许被拆坏（拆包放宽 = 换一个病）", () => {
  it("`{objectType,objectId}` 原样透出（下游 fillSlots 真要的就是这个形状）", () => {
    const ref = { objectType: "Base", objectId: "changzhou", label: "常州" };
    expect(normalizeSlotValue(ref).value).toBe(ref); // 同一个引用，一点没动
    const h = harvestClassificationSlots({ extractedSlots: { base: ref } });
    expect(h.slots.base).toEqual(ref);
    expect(h.unwrapped).toEqual([]); // 没拆过 → 不留痕
  });

  it("★ 命门：`{objectType,objectId,value}`（带 value 键的合法 ref）也不许拆 —— 判据是 `type` 是字符串 ⊕ 有 value 键 ⊕ 键数≤3", () => {
    // 放宽成「有 value 键就拆」的话，这条会被拆成 "不该拿到的值"。
    const ref = { objectType: "Base", objectId: "changzhou", value: "不该拿到的值" };
    expect(normalizeSlotValue(ref).value).toEqual(ref);
    expect(harvestClassificationSlots({ extractedSlots: { base: ref } }).slots.base).toEqual(ref);
  });

  it("不认得的形态一律原样透出（诚实边界：不猜·交下游校验判）", () => {
    // `type` 不是字符串 → 不是类型标注
    expect(normalizeSlotValue({ type: 1, value: "x" }).value).toEqual({ type: 1, value: "x" });
    // 没有 value 键 → 不是信封
    expect(normalizeSlotValue({ type: "objectRef", objectId: "changzhou" }).value).toEqual({ type: "objectRef", objectId: "changzhou" });
    // 键数 >3 → 是业务对象不是信封
    const wide = { type: "number", value: 1, unit: "万套", note: "n" };
    expect(normalizeSlotValue(wide).value).toEqual(wide);
    // 数组 / 裸值 / null 原样
    expect(normalizeSlotValue(["xinyang"]).value).toEqual(["xinyang"]);
    expect(normalizeSlotValue("常州").value).toBe("常州");
    expect(normalizeSlotValue(null).value).toBe(null);
  });

  it("**只拆一层**：里层信封原样透出（拆到哪层算数不许靠猜）", () => {
    const nested = { type: "objectRef", value: { type: "string", value: "常州" } };
    expect(normalizeSlotValue(nested).value).toEqual({ type: "string", value: "常州" });
  });
});

describe("WO-BASE-SLOT-UNIFY §E-3③ · 归一与既有合并优先级/空值规则不打架", () => {
  it("空信封 `{type:'string',value:''}` 算「没给」→ 更低优先层的真值补得上（同 base:null 老规矩）", () => {
    const h = harvestClassificationSlots({
      extractedSlots: { base: { type: "string", value: "" } },
      candidates: [{ intentKey: "i", confidence: 0.9, extractedSlots: { base: "常州" } }],
    });
    // 先拆再判空——否则一个「非空对象」的空信封就把 candidate 的真值挡死了。
    expect(h.slots.base).toBe("常州");
    expect(h.sources.base).toBe("candidateObject");
    expect(h.unwrapped).toEqual([]); // 空信封没被采信 → 不留痕（留痕只记真正生效的那次拆包）
  });

  it("信封与裸值混排：顶层 Json > 顶层 object > candidate 的层序不变，值一律归一", () => {
    const h = harvestClassificationSlots({
      extractedSlotsJson: '{"base":{"type":"string","value":"顶层Json"}}',
      extractedSlots: { base: "顶层Object", day: { type: "date", value: "D+5" } },
      candidates: [{ intentKey: "i", confidence: 0.9, extractedSlots: { factor: { type: "string", value: "物料齐套" } } }],
    });
    expect(h.slots).toEqual({ base: "顶层Json", day: "D+5", factor: "物料齐套" });
    expect(h.sources).toEqual({ base: "topJson", day: "topObject", factor: "candidateObject" });
    expect(h.unwrapped).toEqual(["base:string", "day:date", "factor:string"]);
  });

  it("R6 确定性：同 raw 重跑逐字节一致", () => {
    const raw = JSON.parse(KIMI_RUN5_BODY) as unknown;
    expect(JSON.stringify(harvestClassificationSlots(raw))).toBe(JSON.stringify(harvestClassificationSlots(raw)));
  });
});
