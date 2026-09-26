import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  describeJsonDefect,
  extractJsonCandidate,
  parseLlmJson,
  repairJsonText,
  reportJsonRepairs,
} from "./json-repair.js";
import { extractJsonText } from "./openai.js";
import { extractJsonObject } from "./degrade.js";

/**
 * ══ 真实输出驱动 · 不是合成 fixture ═══════════════════════════════════════════
 * `test-fixtures/kimi-k2.6-nothink-broken.txt` 是 **2026-09-14 真 key 打 Moonshot
 * `kimi-k2.6`（关思考模式）拿回来的原始输出**，原样落盘、一个字节没改。
 * 它就是那次「JSON 可解析 0/4」的其中一份。
 *
 * ⚠ 这条测试咬的是**链路**不是函数：两个适配器入口（openai / degrade）都必须能把它读出来。
 *   只测 `repairJsonText` 是「排练」不是「实现」（假绿第 9 形态）。
 */
const REAL_BROKEN = readFileSync(
  fileURLToPath(new URL("../test-fixtures/kimi-k2.6-nothink-broken.txt", import.meta.url)),
  "utf8",
);

describe("json-repair · 真实坏输出", () => {
  it("🐤 金丝雀：这份 fixture 确实是坏的 —— 三种纯提取法全部解析失败", () => {
    // 若哪天这条变绿，说明 fixture 被人改过或换过，本文件其余断言全部失去意义。
    const candidate = extractJsonCandidate(REAL_BROKEN);
    expect(() => JSON.parse(candidate)).toThrow();
    expect(() => JSON.parse(REAL_BROKEN)).toThrow();
    const stripped = REAL_BROKEN.replace(/^\s*```(?:json)?/, "").replace(/```\s*$/, "");
    expect(() => JSON.parse(stripped)).toThrow();
  });

  /**
   * ⚠ 这一份真实输出里有**两处**破损，性质不同，处置也不同 —— 这正是「修复」与「重试」的分界：
   *   ① `"noCandidateReason":` 后面缺值      ⇒ 结构性、无歧义 ⇒ **修**（补 null）
   *   ② `"locus "常州 · 卡点 changzhou…` ⇒ 键与值粘连、冒号丢了 ⇒ **不修**
   *      要修就得判定「键到哪个字为止」（`locus` ？`locus ` ？），那是**编内容**，
   *      违反 json-repair.ts 纪律 ①。这一类交给带定位的纠正重试。
   *
   * ⛔ 不许为了让这条测试变绿，去把修复器改成会猜的那种 —— 那才是真正危险的失败。
   */
  it("① 缺值被修掉，② 键值粘连**故意不修** ⇒ 如实报修不好", () => {
    const r = parseLlmJson(REAL_BROKEN);
    expect(r.repairs.join(" | ")).toContain("缺值");
    expect(r.value, "键值粘连这一类不该被猜着修好").toBeUndefined();
  });

  it("修不好时，给模型的纠正语必须**指得出位置**（否则等于让它重摇骰子）", () => {
    const d = describeJsonDefect(REAL_BROKEN);
    expect(d).not.toBe("");
    expect(d).toMatch(/偏移 \d+/);
    // 前后文必须真的把出错那一段带上 —— 这是「指得出位置」的判据。
    expect(d).toContain("locus");
  });

  it("两个适配器入口走的是同一份实现（两份抄本已收归一份）", () => {
    // degrade 路：修不好 ⇒ undefined（⛔ 不许编一个对象出来），由上层触发纠正重试。
    expect(extractJsonObject(REAL_BROKEN)).toBeUndefined();
    // openai 路的提取器逐字节等同单源提取器。
    expect(extractJsonText(REAL_BROKEN)).toBe(extractJsonCandidate(REAL_BROKEN));
  });

  it("同一份输出只去掉粘连那一处 ⇒ 修复器立刻能把它救回来（证明 ① 的修复是真在起作用）", () => {
    // 对照实验：只改破损 ②，不动破损 ①。若修复器对 ① 无效，这条照样红。
    const onlyDefect1 = REAL_BROKEN.replace('"locus "常州', '"locus": "常州');
    const r = parseLlmJson(onlyDefect1);
    expect(r.value, `仍不可解析；做过的修复：${r.repairs.join(" | ")}`).toBeDefined();
    expect(r.repairs.join(" | ")).toContain("缺值");
    const v = r.value as { items?: { candidates?: { solverKey?: string }[] }[] };
    expect(v.items).toHaveLength(4);
    // 这些 key 在本仓 63 条求解器目录里都是真的（实测核对过，零幻觉）。
    expect((v.items ?? []).flatMap((i) => (i.candidates ?? []).map((c) => c.solverKey))).toContain("lta_gap");
  });
});

describe("json-repair · 三类结构破损（每类一条，都是实测见过的形态）", () => {
  it("① 缺值：\"key\": 后直接闭合 / 直接逗号 ⇒ 补 null", () => {
    expect(parseLlmJson('{"a":1,"b":}').value).toEqual({ a: 1, b: null });
    expect(parseLlmJson('{"a":,"b":2}').value).toEqual({ a: null, b: 2 });
    expect(parseLlmJson('{"a":[1,2],"b":}').value).toEqual({ a: [1, 2], b: null });
  });

  it("② 多余逗号：尾随 / 连续 / 紧跟开括号 ⇒ 删", () => {
    expect(parseLlmJson('{"a":1,}').value).toEqual({ a: 1 });
    expect(parseLlmJson('{"a":[1,2,]}').value).toEqual({ a: [1, 2] });
    expect(parseLlmJson('{,"a":1}').value).toEqual({ a: 1 });
  });

  it("③ 末尾截断：字符串/数组/对象未闭合 ⇒ 按栈补齐", () => {
    expect(parseLlmJson('{"a":"未说完').value).toEqual({ a: "未说完" });
    expect(parseLlmJson('{"a":[1,2').value).toEqual({ a: [1, 2] });
    expect(parseLlmJson('{"a":{"b":1').value).toEqual({ a: { b: 1 } });
    expect(parseLlmJson('{"a":1,"b":').value).toEqual({ a: 1, b: null });
  });
});

describe("json-repair · 不许越界（修复器最危险的失败是「修多了」）", () => {
  it("合法 JSON 一律零修复、逐字节不动", () => {
    for (const s of ['{"a":1}', '{"a":"逗号, 花括号 } 都在字符串里"}', '{"a":[{"b":null}]}', '{"a":"斜杠\\\\"}']) {
      const r = parseLlmJson(s);
      expect(r.repairs, `${s} 不该被修`).toEqual([]);
      expect(r.value).toEqual(JSON.parse(s));
    }
  });

  it("字符串内部的结构字符不许被当成结构（正则实现必然在此翻车）", () => {
    // 这三条是「字符串感知」的判据：若扫描器不认引号/转义，它们会被改坏或误判。
    expect(parseLlmJson('{"a":"值里有 : 冒号 , 逗号 } 右括号"}').repairs).toEqual([]);
    expect(parseLlmJson('{"a":"结尾是转义引号 \\""}').repairs).toEqual([]);
    expect(repairJsonText('{"a":"x,"}').text).toBe('{"a":"x,"}');
  });

  it("修不好就得说修不好 ⇒ value undefined，⛔ 不许编一个对象出来", () => {
    expect(parseLlmJson("这不是 JSON，一个花括号都没有").value).toBeUndefined();
    expect(parseLlmJson('{"a":@@@}').value).toBeUndefined();
  });
});

describe("json-repair · 留痕（缝过就必须说）", () => {
  it("reportJsonRepairs 真的会喊，且零修复时闭嘴", () => {
    const said: string[] = [];
    const sink = { warn: (m: string) => said.push(m) };
    reportJsonRepairs("测试", [], sink);
    expect(said).toEqual([]); // 没修过 ⇒ 不许刷屏
    reportJsonRepairs("测试", ["缺值：补 null"], sink);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("解析成功 ≠ 模型输出正常");
  });

  it("parseLlmJson 的 repairs 精确等于「这次真的坏了」", () => {
    expect(parseLlmJson('{"ok":1}').repairs).toEqual([]);
    expect(parseLlmJson('{"ok":}').repairs.length).toBeGreaterThan(0);
  });
});
