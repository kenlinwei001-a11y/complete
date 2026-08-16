import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 剥注释一律走仓内**唯一**那份实现（自带四条金丝雀）——各抄一份正则的金丝雀是装饰品。
import { REPO_ROOT, srcCode, stripComments, factHits, commentOnlyCanary, codeEatenCanary } from "./factlock.js";
import { OBJECT_KEY_PROPS, projectNavigationSlice, renderNavigationSlice } from "../src/agent/navigation-slice.js";
import { renderOntologySemanticContext } from "../src/agent/ontology-context.js";
import type { TypeSemantics } from "@platform/contracts";

/**
 * WO-STALE-TEXT-4 · **喂给 LLM 的属性名清单 × 本体真相源** 接缝门。
 *
 * ── 这道门拦的是什么（真发生过，不是假想）───────────────────────────────────────
 * `navigation-slice.ts` 的 `OBJECT_KEY_PROPS` 是**唯一一张直接印进 agent 首轮 prompt 的属性名清单**，
 * 而它的两个消费方**都是静默丢弃、不是抛错**：
 *   ① `renderNavigationSlice` → `keyProps.join("/")` → prompt ⇒ 名字错了，模型照着一个不存在的
 *      字段去查，工具回空；
 *   ② `ontology-context.ts` 的 `renderTypeBlock` 拿它当**白名单**过滤 `getTypeSemantics` 的真属性
 *      （`if (wanted && !wanted.has(pk)) continue`）⇒ 名字错了，那个属性的 description/unit/派生公式
 *      **整条被滤掉**，模型拿不到值，屏上少一段解释。
 * 两条通路都**不报错**，且旧名以**字符串**形态存在 ⇒ `pnpm -r typecheck` / `build` 全绿。
 * 照 CLAUDE.md 铁律 0.6 的句式：
 *   **「我用『三包 typecheck 绿』当作『改名改全了』的证据，而前者并不度量后者。」**
 *
 * ── 为什么非有这道门不可（2026-08-16 实测数字）──────────────────────────────────
 * 上一单（WO-STALE-TEXT-SWEEP）只修了被点名的 `DemandSegment` 一行，`REQUIREMENTS-TRACE.md`
 * 记的是「agentcore 3 处」。本单把整张表逐名对账：**25 个类型 / 85 个属性名里，40 个（47%）
 * 在其声明的类型上根本不存在** —— 比记账数大 13 倍。
 * 「修 40 处文案」是一次性的；**这个文件才是机制** —— 下次再改名，是机器先说话。
 *
 * ── 咬四件事，缺一件这道门就只是「排练」────────────────────────────────────────
 *  §1 **判据自身没瞎**：抽取器先跑金丝雀（已知必中 / 已知必判假 / 规模下界 / 一条真实踩过的坑）。
 *     金丝雀不中 ⇒ 报「**工具坏了**」，**不许**把结果读作「清单干净」。
 *  §2 **主判据**：`OBJECT_KEY_PROPS` 每一个 (类型, 属性) 都必须在本体里真实存在。
 *  §3 **同族第二面**：剥注释后，`apps/agentcore/src` 里凡以 `Type.prop` 形态写给 LLM 的属性名
 *     （solver 描述等）同样不许指假名 —— 只守住那张表不够，同一族的病会换个地方长。
 *  §4 **接缝（不是测函数，是测链路）**：真跑生产入口 `projectNavigationSlice` →
 *     `renderNavigationSlice`，断言这些名字**真的到达了 prompt 文本**；再驱动
 *     `renderOntologySemanticContext`，断言真属性名能让口径块渲染得出来、假名会让它整块塌成 `null`
 *     —— 后者正是 `DemandSegment` 当初的实测病样（口径块渲染 0 行 ⇒ 返 null）。
 *
 * ⚠ **诚实边界**：本文件把 DataCore 本体的类型定义**当文本读**（跨 app 引源码违反
 *   contracts-only-shared，故不 import）。所以它证明的是「名字与本体**声明**逐字相等」，
 *   **不**证明运行期 `getTypeSemantics` 真回了这些属性 —— 那一半由 DataCore 侧
 *   `ontology-core.test.ts` / `synthetic-*` 金值守。两半合起来才是全链。
 */

// ---------------------------------------------------------------------------
// 抽取器 · DataCore 本体真相源（typeKey → 属性名集合）
// ---------------------------------------------------------------------------

/** 本体类型定义的两处真相源（`batteryObjectTypes()` + `extendedObjectTypes()`）。 */
const ONTOLOGY_SOURCES = [
  "apps/datacore/src/synthetic/battery.ts",
  "apps/datacore/src/synthetic/battery-extended.ts",
] as const;

/**
 * 跳过一个字符串/模板串字面量。
 *
 * ⚠ **这不是防御性编程，是一条实测踩过的坑**：本抽取器第一版的括号配平不跳字符串，
 * 而 `battery.ts` 的 `cadenceProps` 里有一句 description 写着 `∈[0, everyDays)` ——
 * 那个 `[` 把配平算歪，整个 `cadenceProps` 抽不出来（当场打印「引用了未知变量 cadenceProps」）。
 * 若那条警告被忽略，结论会变成「Cadence 的属性一个都不存在」。故 §1 有一条对应的回归金丝雀。
 */
function skipString(text: string, i: number): number {
  const q = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j += 1;
  }
  return j;
}

/** 从 `startIdx`（必须正好是 `open`）取到配平的 `close`，返回含两端的 slice；不配平返 null。 */
function balanced(text: string, startIdx: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") { i = skipString(text, i) - 1; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** 按**顶层**逗号切分一个 `[...]` 数组体（同样跳字符串）。 */
function splitTopLevel(arrBody: string): string[] {
  const inner = arrBody.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(inner, i);
      cur += inner.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const propKeysIn = (s: string): string[] => [...s.matchAll(/propKey:\s*"([^"]+)"/g)].map((m) => m[1]!);

/**
 * `const xxxProps: PropertyDef[] = [...]` / `DerivedPropertyDef[]` → 变量名 → 属性名。
 *
 * 🚦 **主逻辑与金丝雀共用这一份**（房规：各抄一份正则的金丝雀是装饰品 —— 改主正则时它拿旧的去测、照样绿）。
 * ⚠ 注意 `m.index + m[0].length - 1`：正则末尾那个 `[` 才是数组开头。
 *   写成 `text.indexOf("[")` 会命中**类型标注** `PropertyDef[]` 的那个 `[` ⇒ 抽出空数组
 *   —— 本单第一版金丝雀就是这么写的，当场被自己咬红（正是这条金丝雀该干的事）。
 */
function collectPropVarDecls(text: string): { vars: Map<string, string[]>; unresolved: string[] } {
  const vars = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*:\s*(?:Property|DerivedProperty)Def\[\]\s*=\s*\[/g)) {
    const body = balanced(text, m.index! + m[0].length - 1, "[", "]");
    if (body) vars.set(m[1]!, propKeysIn(body));
    else unresolved.push(`变量 ${m[1]} 的数组体配平失败`);
  }
  return { vars, unresolved };
}

export type OntologyProps = Map<string, Set<string>>;

/**
 * 抽 typeKey → 属性名集合（`PropertyDef` + `DerivedPropertyDef`，两者都是
 * `getTypeSemantics` 会下发、`renderTypeBlock` 会渲染的属性通道）。
 * 抽取前**先剥注释** —— 注释里提一嘴不算「本体里有这个属性」。
 */
export function extractOntologyProps(): { props: OntologyProps; unresolved: string[] } {
  const props: OntologyProps = new Map();
  const unresolved: string[] = [];
  const add = (key: string, keys: string[]): void => {
    if (!props.has(key)) props.set(key, new Set());
    for (const k of keys) props.get(key)!.add(k);
  };

  // ── ① battery.ts：`const xxxProps: PropertyDef[] = [...]` + `batteryObjectTypes()` 注册体
  const bat = stripComments(readFileSync(join(REPO_ROOT, ONTOLOGY_SOURCES[0]), "utf8"));
  const { vars: varProps, unresolved: varErrs } = collectPropVarDecls(bat);
  unresolved.push(...varErrs);
  const fnIdx = bat.indexOf("export function batteryObjectTypes()");
  const retArr = fnIdx < 0 ? null : balanced(bat, bat.indexOf("[", bat.indexOf("return [", fnIdx)), "[", "]");
  if (!retArr) unresolved.push("batteryObjectTypes() 的 return 数组抽不出来");
  for (const entry of retArr ? splitTopLevel(retArr) : []) {
    // 三种注册写法：`plain("K",…)` / `plainD("K",…)` / `{ key: "K", … }` / `{ ...plain("K",…), … }`
    const keyM = entry.match(/^(?:\{\s*\.\.\.)?(?:plainD?\(|\{)\s*(?:key:\s*)?"([A-Za-z_]\w*)"/);
    if (!keyM) { unresolved.push(`注册项解析失败：${entry.slice(0, 60)}`); continue; }
    const keys: string[] = [...propKeysIn(entry)];
    for (const ref of [...entry.matchAll(/\b(\w+(?:Props|Derived))\b/g)].map((m) => m[1]!)) {
      const got = varProps.get(ref);
      if (got) keys.push(...got);
      else unresolved.push(`注册项 ${keyM[1]} 引用了抽不出来的变量 ${ref}`);
    }
    add(keyM[1]!, keys);
  }

  // ── ② battery-extended.ts：`def("K", 名, 域, [ p("x") | pd("x", 口径) | { propKey: "x" } ])`
  const ext = stripComments(readFileSync(join(REPO_ROOT, ONTOLOGY_SOURCES[1]), "utf8"));
  const extIdx = ext.indexOf("export function extendedObjectTypes()");
  const extArr = extIdx < 0 ? null : balanced(ext, ext.indexOf("[", ext.indexOf("return [", extIdx)), "[", "]");
  if (!extArr) unresolved.push("extendedObjectTypes() 的 return 数组抽不出来");
  for (const entry of extArr ? splitTopLevel(extArr) : []) {
    const keyM = entry.match(/def\(\s*"([A-Za-z_]\w*)"/);
    if (!keyM) { unresolved.push(`ext 注册项解析失败：${entry.slice(0, 60)}`); continue; }
    add(keyM[1]!, [...[...entry.matchAll(/\bpd?\(\s*"([^"]+)"/g)].map((m) => m[1]!), ...propKeysIn(entry)]);
  }

  return { props, unresolved };
}

// ---------------------------------------------------------------------------
// §1 · 判据自身没瞎（金丝雀先说话 · 铁律 0.6）
// ---------------------------------------------------------------------------

describe("§1 · 抽取器自证（不中就报「工具坏了」，不许报「清单干净」）", () => {
  const { props, unresolved } = extractOntologyProps();

  it("金丝雀 A · 规模下界 + 零解析失败：抽不出东西 ⇒ 结论作废", () => {
    expect(unresolved, `本体抽取有解析失败项 ⇒ 真相源不全，一切「属性存在」的结论作废：\n${unresolved.join("\n")}`).toEqual([]);
    expect(props.size, `只抽到 ${props.size} 个对象类型（下界 60）⇒ 抽取器坏了`).toBeGreaterThan(60);
    const total = [...props.values()].reduce((a, s) => a + s.size, 0);
    expect(total, `只抽到 ${total} 个属性名（下界 500）⇒ 抽取器坏了`).toBeGreaterThan(500);
  });

  it("金丝雀 B · 已知必中：真属性必须被抽到（含派生属性这条通道）", () => {
    // 逐字取自 `battery.ts` 的 `demandSegmentProps` / `metricProps` / `metricDerived`。
    expect(props.get("DemandSegment")).toContain("demandWanPerYearP50");
    expect(props.get("Metric")).toContain("key");
    expect(props.get("Metric"), "派生属性（metricDerived）必须一并抽到 —— renderTypeBlock 只渲染带口径的那些").toContain("gapPct");
    // extendedObjectTypes 那条支路（`def(...)` + `p()/pd()` 写法）必须也活着。
    expect(props.get("Supplier"), "battery-extended.ts 支路抽空了 ⇒ 半个本体不见了").toContain("leadTime");
    expect(props.get("CausalFactor")).toContain("metricKey");
  });

  it("金丝雀 C · 已知必判假：本体里没有的名字不许被抽出来", () => {
    // 这三个是本单实测的真假名，不是编的：`attainPct` 全 datacore 零 propKey 声明；
    // `capacityDaily` 只长在 Line 上（Base 上没有）；`caused_by` 是 LinkType 不是属性。
    expect(props.get("Segment"), "假名被抽成了真属性 ⇒ 主判据会漏报").not.toContain("attainPct");
    expect(props.get("Base")).not.toContain("capacityDaily");
    expect(props.get("RootCauseChain")).not.toContain("caused_by");
  });

  it("金丝雀 D · 回归：字符串里的括号不许把配平算歪（`∈[0, everyDays)` 那个真实坑）", () => {
    // 第一版抽取器就栽在这里：`cadenceProps` 的 description 里有 `∈[0, everyDays)`，
    // 不跳字符串就会把 `[` 计进深度 ⇒ 整个 cadenceProps 抽不出来 ⇒ 读作「Cadence 没有属性」。
    expect(props.get("Cadence"), "Cadence 的属性抽空了 ⇒ 括号配平又把字符串当代码算了").toContain("everyDays");

    // 合成必中样例 —— 走**主逻辑同一个入口** `collectPropVarDecls`，不另抄一份配平。
    // description 里那句 `∈[0, n)` 逐字仿 `battery.ts` 的 `cadenceProps.offsetDays`：不跳字符串就会
    // 把 `[` 计进深度、把 `)` 当括号 ⇒ 抽出空表 ⇒ 结论反转成「Cadence 没有属性」。
    const synth = [
      `const xProps: PropertyDef[] = [`,
      `  { propKey: "a", description: "周期内相位，∈[0, everyDays) 且含 { 不闭合的花括号" },`,
      `  { propKey: "b" },`,
      `];`,
    ].join("\n");
    const got = collectPropVarDecls(synth);
    expect(got.unresolved, "合成样例都配平不了 ⇒ balanced 坏了，本节一切结论作废").toEqual([]);
    expect(got.vars.get("xProps"), "字符串里的括号又把配平算歪了").toEqual(["a", "b"]);

    // 反向必判假：把「跳字符串」这一步拿掉，同一段样例必须抽**不**出来 ——
    // 证明上面那条绿是「跳字符串」给的，不是碰巧（只跑正向只能证明今天绿，跑反向才证明是谁给的牙）。
    const naive = (t: string): string | null => {
      let d = 0;
      const s = t.indexOf("[", t.indexOf("= ["));
      for (let i = s; i < t.length; i++) {
        if (t[i] === "[") d++;
        else if (t[i] === "]") { d--; if (d === 0) return t.slice(s, i + 1); }
      }
      return null;
    };
    expect(propKeysIn(naive(synth) ?? ""), "不跳字符串竟然也抽对了 ⇒ 本条金丝雀没在验它该验的东西").not.toEqual(["a", "b"]);
  });

  it("金丝雀 E · 剥注释管线活着（双向：注释不算代码 · 代码不许被当注释吃掉）", () => {
    expect(factHits(commentOnlyCanary("KP_CANARY"), "KP_CANARY"), "只在注释里的串被当成代码 ⇒ stripComments 坏了").toEqual([]);
    expect(factHits(codeEatenCanary("KP_CANARY"), "KP_CANARY"), "行注释后的真代码被吃掉了 ⇒ 一切否定结论作废").not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 · 主判据：喂给 LLM 的属性名清单，每个名字在本体里真实存在
// ---------------------------------------------------------------------------

describe("§2 · OBJECT_KEY_PROPS 逐名对账本体（改名漏改在这里当场红）", () => {
  const { props } = extractOntologyProps();

  it("覆盖面自证：表非空且每个类型都非空（表塌了就不是「全对」是「没测」）", () => {
    const types = Object.keys(OBJECT_KEY_PROPS);
    expect(types.length, "OBJECT_KEY_PROPS 空了 ⇒ 本判据什么都没测").toBeGreaterThan(20);
    expect(types.filter((t) => OBJECT_KEY_PROPS[t]!.length === 0), "有类型的 keyProps 是空数组 ⇒ 白名单退化成「不过滤」，静默丢口径").toEqual([]);
    expect(Object.values(OBJECT_KEY_PROPS).flat().length).toBeGreaterThan(80);
  });

  it("每个类型键都是本体里真实存在的对象类型", () => {
    const ghosts = Object.keys(OBJECT_KEY_PROPS).filter((t) => !props.has(t));
    expect(ghosts, `这些类型在 DataCore 本体里不存在（getTypeSemantics 永远查不到 ⇒ 整块口径丢失）：\n${ghosts.join(", ")}`).toEqual([]);
  });

  it("每个属性名都是**该类型上**真实存在的属性（不是别的类型的、不是求解器输出字段、不是链路名）", () => {
    const bad: string[] = [];
    for (const [type, keys] of Object.entries(OBJECT_KEY_PROPS)) {
      const real = props.get(type);
      if (!real) continue; // 上一条已单独报
      for (const k of keys) {
        if (real.has(k)) continue;
        // 报错时把「它到底长在哪个类型上」一并算出来 —— 区分「改名漏改」与「抄错地方」，两者修法不同。
        const elsewhere = [...props].filter(([, s]) => s.has(k)).map(([t]) => t);
        const near = [...real].filter((r) => r.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(r.toLowerCase()));
        bad.push(
          `${type}.${k} —— 本体上 ${type} 无此属性` +
            (elsewhere.length ? `；该名字实际长在 [${elsewhere.join("/")}] 上（⇒「抄错地方」，换真属性不是换新名）` : "") +
            (near.length ? `；形近真属性：${near.join("/")}（⇒ 可能是「改名漏改」）` : "") +
            (!elsewhere.length && !near.length ? "；全本体零声明（⇒ 多半是把求解器输出字段/链路名当成了属性）" : ""),
        );
      }
    }
    expect(bad, `喂给 LLM 的属性名有 ${bad.length} 个在本体里不存在 —— 两个消费方都静默丢弃，typecheck 一个都看不见：\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 · 同族第二面：源码里以 `Type.prop` 形态写给 LLM 的属性名
// ---------------------------------------------------------------------------

describe("§3 · agentcore 源码里的 `Type.prop` 引用同样不许指假名", () => {
  const { props } = extractOntologyProps();
  const TYPE_PROP = /\b([A-Z][A-Za-z]{2,})\.([a-z][A-Za-z0-9_]*)\b/g;

  it("剥注释后逐行扫 apps/agentcore/src（solver 描述等 LLM 可见文案也在内）", () => {
    const tree = srcCode("apps/agentcore/src");
    expect(tree.length, `扫描面塌了：只扫到 ${tree.length} 个文件 ⇒ 工具坏了，结论作废`).toBeGreaterThan(80);

    const hits: string[] = [];
    const bad: string[] = [];
    for (const [file, code] of tree) {
      code.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(TYPE_PROP)) {
          const [, type, prop] = m as unknown as [string, string, string];
          const real = props.get(type);
          if (!real) continue; // 不是本体类型（JS 类名/命名空间），本判据不管
          hits.push(`${type}.${prop}`);
          if (!real.has(prop)) bad.push(`${file}:${i + 1}  ${type}.${prop}`);
        }
      });
    }
    // 金丝雀：报「0 个假名」之前先证明这条扫描真扫到了东西（否则「干净」只是「没扫到」）。
    expect(hits.length, "剥注释后一条 `Type.prop` 都没扫到 ⇒ 扫描器坏了，不许读作「没有假名」").toBeGreaterThan(10);
    expect(hits, "已知必中的 `DemandSegment.demandWanPerYearP50` 不在命中集里 ⇒ 扫描器坏了").toContain("DemandSegment.demandWanPerYearP50");
    expect(bad, `这些写给 LLM 的属性名在本体里不存在：\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 · 接缝：这些名字**真的到达了** prompt，且真属性真能渲出口径块
// ---------------------------------------------------------------------------

describe("§4 · 接缝驱动（测链路不测函数：清单 → prompt → 口径块）", () => {
  it("生产入口 projectNavigationSlice → renderNavigationSlice：keyProps 逐字印进首轮 prompt", () => {
    const slice = projectNavigationSlice("常州基地的产线利用率和日产能怎么样？");
    const text = renderNavigationSlice(slice);
    expect(slice.objectTypes.length, "导航图一个对象类型都没投影出来 ⇒ 本条什么都没测").toBeGreaterThan(0);
    for (const ot of slice.objectTypes) {
      for (const k of ot.keyProps) {
        expect(text, `keyProps「${ot.type}.${k}」没出现在渲染出的 prompt 里 ⇒ 这条链断了，前面两节等于白测`).toContain(k);
      }
    }
    // 且这些名字确实来自被对账的那张表（不是别处临时拼的）。
    for (const ot of slice.objectTypes) {
      const table = OBJECT_KEY_PROPS[ot.type];
      if (table) expect(ot.keyProps).toEqual(table);
    }
  });

  it("renderTypeBlock 的白名单语义：真属性 → 口径块渲得出；假名 → 整块塌成空（DemandSegment 当初的实测病样）", () => {
    // semantics 逐字模拟 A 侧 getTypeSemantics 对 DemandSegment 的下发（真属性 + 真口径）。
    const semantics: TypeSemantics[] = [
      {
        typeKey: "DemandSegment",
        displayName: "需求细分",
        props: [
          { propKey: "demandWanPerYearP50", description: "需求预测中位口径 P50（万套/年）", unit: "万套/年", dataType: "number" },
          { propKey: "segId", dataType: "string" },
          { propKey: "segment", dataType: "string" },
        ],
        derived: [],
        rules: [],
      },
    ];
    const mk = (keyProps: string[]) => ({
      domain: "forecast",
      objectTypes: [{ type: "DemandSegment", keyProps }],
      solvers: [],
      chain: "",
      rules: [],
      nonEmpty: true,
    });

    // ① 真名（= 现表内容）：那条带 description+unit 的属性必须渲染出来。
    const good = renderOntologySemanticContext(mk(OBJECT_KEY_PROPS.DemandSegment!), semantics);
    expect(good).toContain("demandWanPerYearP50");
    expect(good, "口径（unit）没跟着下来 ⇒ 白名单过滤把口径滤掉了").toContain("万套/年");

    // ② 旧假名（历史病样，逐字取自 2026-08-15 修掉的那一行）：白名单一个都对不上
    //    ⇒ renderTypeBlock 渲染 0 行 ⇒ 整块返 null ⇒ 模型拿不到值、屏上少一段解释，**且不报错**。
    const stale = renderOntologySemanticContext(mk(["segment", "p50", "demandPct"]), semantics);
    expect(stale, "假名清单竟然也渲出了口径 ⇒ 白名单语义变了，本门的病理前提已不成立，须重写").not.toContain("万套/年");
    expect(stale, "假名清单必须让口径块整块塌掉（这正是「不报错所以没人发现」的机理）").not.toContain("demandWanPerYearP50");
  });
});
