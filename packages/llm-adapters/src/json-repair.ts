/**
 * ══ LLM 输出 JSON 的**语法修复层** · 唯一出处 ═══════════════════════════════════
 *
 * ── 来历（真实测量，2026-09-14）────────────────────────────────────────────────
 * 真 key 打 Moonshot `kimi-k2.6`，让它为真实受阻环节枚举对策，**关思考模式**跑 4 次：
 *   · 首 token 1,532ms（开思考时 138,300ms）· 总 36,388ms（开思考 164,200ms）
 *   · 求解器 key **4/4 都在 63 条真实目录里**，零幻觉
 *   · **JSON 可解析 0/4** —— 全坏
 * 坏在哪（把原始输出落盘后逐字节看的）：
 *     "noCandidateReason":
 *   },
 * 键写了、冒号写了、**值没写**就直接闭合。且一次输出里**不止一处**。
 *
 * ── 为什么既有两层都救不了 ──────────────────────────────────────────────────
 * 本包此前有**两份各自抄的**提取逻辑，都只做「剥 ```` ```json ```` 围栏 / 取首末花括号」：
 *   · `openai.ts::extractJsonText`      · `degrade.ts::extractJsonObject`
 * 二者都是**纯提取，零修复** ⇒ 围栏剥干净了，里面的语法错原样带进 `JSON.parse`，照样抛。
 * 实测三种提取法（带围栏 / 去围栏 / 首末大括号）在**同一个位置**失败。
 *
 * 形态（铁律 0.6 句式）：
 *   **「我用『我剥掉了围栏』当作『这段文本能解析』的证据，而前者并不度量后者。」**
 *
 * ── 两条纪律（违反即把这层做成危险品）──────────────────────────────────────
 * ① **不许猜内容。** 只修**结构性、无歧义**的破损（缺值 / 尾逗号 / 末尾截断未闭合）。
 *    ⛔ 不补业务字段、不改已有值、不猜模型「本来想说什么」。
 * ② **每一处修复必须留痕**（`repairs[]`）。静默把坏数据变成好数据 = 本仓最恨的那种假绿：
 *    下游拿到一个「解析成功」，而它其实是被这层缝出来的。调用方必须能把修复次数报出来。
 *
 * ⚠ 扫描器**必须字符串感知**：`{"a":"} , }"}` 里的 `}` 在字符串内，正则一律会被它骗。
 *   本文件用逐字符扫描 + 转义感知，不用正则做结构判断。
 */

/** 一次修复的结果。`repairs` 为空 ⇒ 原文本身就是合法 JSON，没动过。 */
export interface JsonRepairResult {
  /** 修复后的文本（可能与输入相同）。 */
  readonly text: string;
  /** 每一处修复的人读说明；空数组 = 未做任何修改。 */
  readonly repairs: readonly string[];
}

/**
 * 剥掉 Markdown 代码围栏；没有围栏则取首个 `{`/`[` 到末个 `}`/`]` 的片段；都不命中原样返回。
 *
 * ⚠ 这一步**只提取不修复** —— 单独用它得不出「能解析」的结论（那正是本文件的来历）。
 * 与 `repairJsonText` 成对使用，或直接用 `parseLlmJson`。
 */
export function extractJsonCandidate(content: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(content);
  const body = (fence?.[1] ?? content).trim();
  // 对象优先；没有对象再看数组（有的端点顶层直接给数组）。
  const objFirst = body.indexOf("{");
  const objLast = body.lastIndexOf("}");
  if (objFirst >= 0 && objLast > objFirst) return body.slice(objFirst, objLast + 1);
  const arrFirst = body.indexOf("[");
  const arrLast = body.lastIndexOf("]");
  if (arrFirst >= 0 && arrLast > arrFirst) return body.slice(arrFirst, arrLast + 1);
  return body;
}

// ── 词法 ────────────────────────────────────────────────────────────────────
type TokKind = "{" | "}" | "[" | "]" | ":" | "," | "string" | "bare" | "eof";

interface Tok {
  readonly kind: TokKind;
  /** 原文中的起止偏移（`text.slice(from, to)` 即该 token 原文）。 */
  readonly from: number;
  readonly to: number;
  /** 仅 `bare`：该裸串是否是合法 JSON 字面量（数字 / true / false / null）。 */
  readonly literal?: boolean;
  /** 仅 `string`：是否读到了收尾引号（false = 输出在字符串中途被截断）。 */
  readonly closed?: boolean;
}

/** 合法 JSON 裸字面量 —— 不匹配的裸串一律视为**模型吐了散文**，不许当值缝进去。 */
const JSON_LITERAL = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      i++;
      continue;
    }
    if (c === "{" || c === "}" || c === "[" || c === "]" || c === ":" || c === ",") {
      out.push({ kind: c, from: i, to: i + 1 });
      i++;
      continue;
    }
    if (c === '"') {
      const from = i;
      i++;
      let esc = false;
      let closed = false;
      for (; i < src.length; i++) {
        const d = src[i] as string;
        if (esc) esc = false;
        else if (d === "\\") esc = true;
        else if (d === '"') {
          i++;
          closed = true;
          break;
        }
      }
      out.push({ kind: "string", from, to: i, closed });
      continue;
    }
    // 裸串：一路吃到下一个结构字符或空白为止。
    const from = i;
    while (i < src.length && !/[\s{}[\]:,"]/.test(src[i] as string)) i++;
    const raw = src.slice(from, i);
    out.push({ kind: "bare", from, to: i, literal: JSON_LITERAL.test(raw) });
  }
  out.push({ kind: "eof", from: src.length, to: src.length });
  return out;
}

// ── 语法状态机 ──────────────────────────────────────────────────────────────
/** 在当前容器里，下一个 token 应该是什么。 */
type Expect = "value" | "key-or-close" | "colon" | "comma-or-close";

/**
 * 保守修复 JSON 文本的**结构性**破损。不猜内容，每处留痕。
 *
 * 这是一个**真语法状态机**，不是正则 —— 因为修复的合法性只有在「此刻语法期待什么」
 * 这个上下文里才能判定。四类修复，每一类都能证明「不做内容发明」：
 *
 *   ① **缺值**：期待值，来的却是 `,` `}` `]` ⇒ 补 `null`
 *      （实测形态：`"noCandidateReason":` 后面直接闭合）
 *   ② **多余逗号**：期待键或闭合、期待值，来的是 `,` ⇒ 丢弃它
 *      （`{"a":1,}` · `[1,2,]` · `{,"a":1}`）
 *   ③ **末尾截断**：token 用尽而容器/字符串未闭合 ⇒ 按栈补齐
 *   ④ **缺分隔**：期待 `,`/闭合，来的却是新值或新键 ⇒ 补上**唯一合法**的分隔
 *      · 数组里 ⇒ 补 `,`
 *      · 对象里、来的是字符串（只能是下一个键）⇒ 补 `,`
 *      · 对象里、来的是 `{`（不可能是键），且父容器是数组 ⇒ 补 `},`
 *      （实测形态：`"effect": "…"` 换行后直接 `{`，`},` 两个字符一起丢了）
 *
 * ⛔ **明确不修、直接认输的两类**（修了就是编内容）：
 *   · 期待 `:` 却来了别的 —— 实测形态 `"locus "常州 · 卡点 changzhou…`：
 *     键与值粘连、冒号丢失。要修就得判定「键到哪个字为止」，那是猜。
 *   · 裸串不是合法 JSON 字面量（模型吐了散文）—— 同理，缝进去等于替它编了一个值。
 *   这两类交给带定位的**纠正重试**（见 `describeJsonDefect`）。
 *
 * 认输时返回 `unrepairable` 说明，且**不吞掉已做的修复**（`repairs` 照常给出，便于排错）。
 */
export function repairJsonText(input: string): JsonRepairResult {
  const toks = tokenize(input);
  const repairs: string[] = [];
  const pieces: string[] = [];
  /** 容器栈：`{` 或 `[`。 */
  const stack: ("{" | "[")[] = [];
  let expect: Expect = "value";
  /** 已拷贝到的原文偏移。 */
  let copied = 0;
  let unrepairable: string | undefined;

  const copyUpTo = (to: number): void => {
    if (to > copied) pieces.push(input.slice(copied, to));
    copied = to;
  };
  const insert = (s: string, why: string): void => {
    pieces.push(s);
    repairs.push(why);
  };
  const top = (): "{" | "[" | undefined => stack[stack.length - 1];
  const parent = (): "{" | "[" | undefined => stack[stack.length - 2];
  /** 一个值刚刚结束后，下一个该期待什么。 */
  const afterValue = (): Expect => (stack.length === 0 ? "comma-or-close" : "comma-or-close");

  for (let k = 0; k < toks.length && unrepairable === undefined; k++) {
    const t = toks[k] as Tok;
    if (t.kind === "eof") break;

    // ── ② 多余逗号 ──
    // ⚠ 判据必须**带一格前瞻**：`{"a":1,}` 里那个逗号出现时 `expect` 还是合法的
    //   `comma-or-close`，光看当前 token 判不出它多余 —— 要看它后面紧跟的是不是闭合。
    //   （第一版就漏在这里：`{"a":1,}` 原样穿过、报「没修过」。）
    const nextKind = (toks[k + 1] as Tok | undefined)?.kind;
    const commaBeforeClose = t.kind === "," && (nextKind === "}" || nextKind === "]" || nextKind === "eof");
    if (t.kind === "," && (expect === "value" || expect === "key-or-close" || commaBeforeClose)) {
      // 期待值时的 `,` 有两种读法，按容器区分：
      //  · 对象里 `"a":,` ⇒ 键写了值没写 ⇒ 补 null（这是 ①，不是 ②）
      //  · 其余（`[,` `{,` `,,` `,}`）⇒ 这个逗号是多余的，丢弃
      if (expect === "value" && top() === "{" && !commaBeforeClose) {
        copyUpTo(t.from);
        insert("null", `缺值：":" 后面直接是 ","，补 null（偏移 ${t.from}）`);
        copyUpTo(t.to);
        expect = "key-or-close"; // 对象里补完值，下一个该是键
        continue;
      }
      if (expect === "value" && top() === "{" && commaBeforeClose) {
        // `{"a":,}` —— 既缺值又多逗号：补 null、删逗号。
        copyUpTo(t.from);
        insert("null", `缺值：":" 后面直接是 ","，补 null（偏移 ${t.from}）`);
        copied = t.to;
        repairs.push(`多余逗号：闭合前的尾随 "," 已删除（偏移 ${t.from}）`);
        expect = "key-or-close";
        continue;
      }
      copyUpTo(t.from);
      copied = t.to; // 跳过它，不拷贝
      repairs.push(`多余逗号：此处不该出现 ","，已删除（偏移 ${t.from}）`);
      // 数组里删掉尾随逗号后仍期待闭合；对象里同理。
      if (!commaBeforeClose) expect = expect === "key-or-close" ? "key-or-close" : "value";
      continue;
    }

    // ── ① 缺值：期待值，来的是闭合 ──
    if (expect === "value" && (t.kind === "}" || t.kind === "]")) {
      copyUpTo(t.from);
      insert("null", `缺值：闭合前期待一个值，补 null（偏移 ${t.from}）`);
      expect = afterValue();
      // 落到下面的闭合处理
    }

    // ── ④ 缺分隔：期待 `,`/闭合，来的却是新值/新键 ──
    if (
      expect === "comma-or-close" &&
      (t.kind === "string" || t.kind === "bare" || t.kind === "{" || t.kind === "[")
    ) {
      if (top() === "[") {
        copyUpTo(t.from);
        insert(",", `缺分隔：数组元素之间少了 ","，已补（偏移 ${t.from}）`);
        expect = "value";
      } else if (top() === "{" && t.kind === "string") {
        copyUpTo(t.from);
        insert(",", `缺分隔：对象两个键之间少了 ","，已补（偏移 ${t.from}）`);
        expect = "key-or-close";
      } else if (top() === "{" && (t.kind === "{" || t.kind === "[") && parent() === "[") {
        copyUpTo(t.from);
        insert("},", `缺分隔：上一个对象没闭合、也没逗号，已补 "},"（偏移 ${t.from}）`);
        stack.pop();
        expect = "value";
      } else {
        unrepairable = `偏移 ${t.from} 处期待 "," 或闭合，来的却是 ${t.kind}，无法在不发明内容的前提下修复`;
        break;
      }
    }

    switch (t.kind) {
      case "{":
      case "[":
        if (expect !== "value") {
          unrepairable = `偏移 ${t.from} 处不该出现 "${t.kind}"（当前期待 ${expect}）`;
          break;
        }
        stack.push(t.kind);
        expect = t.kind === "{" ? "key-or-close" : "value";
        copyUpTo(t.to);
        break;

      case "}":
      case "]": {
        const want = t.kind === "}" ? "{" : "[";
        if (top() !== want) {
          unrepairable = `偏移 ${t.from} 处的 "${t.kind}" 与栈顶 "${top() ?? "(空)"}" 不匹配`;
          break;
        }
        stack.pop();
        expect = afterValue();
        copyUpTo(t.to);
        break;
      }

      case ":":
        if (expect !== "colon") {
          unrepairable = `偏移 ${t.from} 处不该出现 ":"（当前期待 ${expect}）`;
          break;
        }
        expect = "value";
        copyUpTo(t.to);
        break;

      case ",":
        if (expect !== "comma-or-close") {
          unrepairable = `偏移 ${t.from} 处不该出现 ","（当前期待 ${expect}）`;
          break;
        }
        expect = top() === "{" ? "key-or-close" : "value";
        copyUpTo(t.to);
        break;

      case "string":
        if (expect === "key-or-close") {
          expect = "colon";
        } else if (expect === "value") {
          expect = afterValue();
        } else {
          unrepairable = `偏移 ${t.from} 处不该出现字符串（当前期待 ${expect}）`;
          break;
        }
        copyUpTo(t.to);
        // ③ 的一半：输出在字符串中途断掉 ⇒ 补收尾引号（只可能是最后一个 token）。
        if (t.closed !== true) insert('"', "截断：输出在字符串中途结束，补上收尾引号");
        break;

      case "bare":
        // ⛔ 裸串不是合法字面量 ⇒ 模型吐了散文 ⇒ 认输，不许缝。
        if (t.literal !== true) {
          unrepairable =
            `偏移 ${t.from} 处是裸文本 ${JSON.stringify(input.slice(t.from, Math.min(t.to, t.from + 24)))}` +
            `，不是合法 JSON 字面量 —— 把它当值缝进去等于替模型编内容`;
          break;
        }
        if (expect !== "value") {
          unrepairable = `偏移 ${t.from} 处不该出现字面量（当前期待 ${expect}）`;
          break;
        }
        expect = afterValue();
        copyUpTo(t.to);
        break;
    }
  }

  if (unrepairable !== undefined) {
    repairs.push(`⛔ 认输：${unrepairable}`);
    return { text: input, repairs };
  }

  copyUpTo(input.length);

  // ── ③ 末尾截断 ──
  if (expect === "colon") {
    insert(": null", '截断：末尾停在键上，补 ": null"');
    expect = "comma-or-close";
  } else if (expect === "value") {
    insert("null", "截断：末尾期待一个值，补 null");
  }
  while (stack.length > 0) {
    const close = stack.pop() === "{" ? "}" : "]";
    insert(close, `截断：补上未闭合的 "${close}"`);
  }

  return { text: pieces.join(""), repairs };
}

/**
 * 把「这段文本为什么不是 JSON」写成**指得出位置**的一句话，用于喂回给模型做纠正重试。
 *
 * ⚠ 为什么必须指位置：降级路原来的纠正语是「上一条输出不是合法 JSON」——
 *   模型收到这句话只能整篇重写，实测等于重摇一次骰子。把**偏移 + 前后文**给它，
 *   它改的是那一处。这一层不花额外 token（错误串来自它自己的输出）。
 *
 * 返回空串 = 这段文本其实是合法 JSON（调用方不该走到纠正路上）。
 */
export function describeJsonDefect(content: string): string {
  const candidate = extractJsonCandidate(content);
  try {
    JSON.parse(candidate);
    return "";
  } catch (e) {
    const v8 = e instanceof Error ? e.message : String(e);
    // ⚠ **不要只信 V8 的消息**：它对本仓实测的那份坏输出**不给 position**，
    //   只给一句 `Unexpected token '}', ..."son": …" is not valid JSON` ——
    //   照它写就会得出「指不出位置」。本仓自己的状态机知道确切偏移，优先用它。
    //   形态：「我用『解析器报的错』当作『能定位』的证据，而前者并不度量后者。」
    const own = repairJsonText(candidate).repairs;
    const withOffset = own.find((r) => /偏移 \d+/.test(r));
    if (withOffset !== undefined) {
      const p = Number(/偏移 (\d+)/.exec(withOffset)?.[1] ?? 0);
      const snippet = candidate.slice(Math.max(0, p - 90), p + 40).replace(/\n/g, "⏎");
      return `第一处破损：${withOffset}；前后文：…${snippet}…（解析器原话：${v8}）`;
    }
    return `解析器报：${v8}`;
  }
}

/** 可注入的告警出口（默认 `globalThis.console.warn`；本包不依赖 `@types/node`）。 */
export interface JsonRepairSink {
  warn(message: string): void;
}

function defaultSink(): JsonRepairSink | undefined {
  const c = (globalThis as { console?: { warn?: (msg: string) => void } }).console;
  return c && typeof c.warn === "function" ? { warn: (m: string) => c.warn?.(m) } : undefined;
}

/**
 * `repairs` 的**真消费方** —— 缝过的 JSON 必须留痕，否则下游拿到的「解析成功」是假的。
 *
 * ⚠ 「只定义不调用」= 假绿第 9 形态（测试咬的是函数不是链路）。本函数存在的意义
 *   就是让 `parseLlmJson` 的每一处修复都真的有人说出来，而不是静默缝好。
 */
export function reportJsonRepairs(
  where: string,
  repairs: readonly string[],
  sink: JsonRepairSink | undefined = defaultSink(),
): void {
  if (!sink || repairs.length === 0) return;
  sink.warn(
    `[llm-adapters/${where}] 模型输出的 JSON 有 ${repairs.length} 处结构破损，已保守修复后解析：` +
      `${repairs.join("；")}（⚠ 解析成功 ≠ 模型输出正常 —— 该模型/提示词需要复核）`,
  );
}

/** `parseLlmJson` 的结果。`value === undefined` ⇒ 修复后仍不可解析。 */
export interface ParsedLlmJson {
  readonly value: unknown;
  /** 做过的修复；空 = 一次就解析成功，没动过原文。 */
  readonly repairs: readonly string[];
}

/**
 * LLM 文本 → JSON 的**唯一入口**：提取 → 直解析 → 失败才修复 → 再解析。
 *
 * ⚠ 顺序很重要：**先原样试一次**。合法 JSON 一律零修复通过，修复器永远不碰它 ——
 *   这样 `repairs.length > 0` 就精确地等于「模型这次真的吐了坏 JSON」，可以直接当观测指标用。
 *
 * ⛔ 调用方不许丢掉 `repairs`：解析成功但修过 ≠ 模型输出正常。
 */
export function parseLlmJson(content: string): ParsedLlmJson {
  const candidate = extractJsonCandidate(content);
  try {
    return { value: JSON.parse(candidate), repairs: [] };
  } catch {
    /* 落到修复 */
  }
  const fixed = repairJsonText(candidate);
  if (fixed.repairs.length === 0) return { value: undefined, repairs: [] };
  try {
    return { value: JSON.parse(fixed.text), repairs: fixed.repairs };
  } catch {
    return { value: undefined, repairs: fixed.repairs };
  }
}
