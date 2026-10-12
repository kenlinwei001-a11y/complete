/**
 * Numeric provenance scan (QOS-PRD §5.5).
 * For each text block: drop sentences whose ⟦ref:N⟧ markers **全部指得出东西**（N 落在
 * provenance 表内）—— 指不出的句子**不豁免**，照 PRD 正则扫；ISO 日期除外。Non-blocking flag.
 *
 * ⚠️ 豁免的判据是「标记**指得出**」不是「标记**存在**」（WO-NUM-FLAG-TRUTH，2026-10-06）——
 *    见文件末「数字红线的处置沿革」。
 */

const NUMERIC_RE = /(?<![\w⟦])\d[\d,.]*(?:%|万|亿|GWh|套|吨|天|周)?/gu;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
/** ⟦ref:…⟧ 标记全体（**剥离**用 —— 含非数字体，防标记自身的字符混进数字扫描面）。 */
const REF_MARK_RE = /⟦ref:[^⟧]*⟧/g;
/** ⟦ref:N⟧ 的**数字下标**形态（**解析**用 —— 判 N 是否落在 provenance 表内）。 */
const REF_INDEXED_RE = /^⟦ref:(\d+)⟧$/u;

function splitSentences(markdown: string): string[] {
  // "." splits only at end-of-sentence (followed by whitespace/EOL) so decimals stay intact
  return markdown.split(/(?<=[。．！？!?；;\n])|(?<=\.)(?=\s|$)/u);
}

/**
 * 有序列表序号（`1.` / `2)` / `3、`）—— **不是业务数字**，扫描前先剥掉。
 *
 * ══ 为什么必须单独剥（实测，不是推理）═══════════════════════════════════════════
 * `splitSentences` 的 `(?<=\.)(?=\s|$)` 会在**序号的句点后**切一刀 ⇒ `"1. 某句"` 被切成
 * `["1.", " 某句"]`。独立段 `"1."` 既无 ⟦ref:N⟧、又匹配 `NUMERIC_RE` ⇒ 判违规。
 * 实测两份真实答案（dsh 三方案 / 原生三方案）共 **12 处**触发，**7 处（58%）是这种序号**，
 * 一段**零业务数字**的纯有序列表即判 TRUE（金丝雀可复现）。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『这段文本里出现了数字字符』当作『这句答案里有未溯源的业务数字』的证据，
 * >   而前者并不度量后者 —— 有序列表的序号 `1.` 也是数字字符。」**
 *
 * ⚠️ 剥的**只是序号标记本身，不是整句**：`"1. 缺口 164839.67 套"` 剥掉 `1.` 之后，
 * `164839.67` 照样在扫描面内、照样要 ⟦ref:N⟧（双向金丝雀咬住，鉴别力未降）。
 * ⚠️ `.` 分支带前瞻 `(?=[ \t]|$)` 是**刻意的**：`"1.5 亿"` 的小数点不得被当序号剥掉
 * （剥了会把 `1.5` 读成 `5`）。`、` 与 `)` 在中文里后面常直接跟字，故不带前瞻。
 */
const LIST_ORDINAL_RE = /^[ \t]*\d{1,3}(?:\.(?=[ \t]|$)|[)、])[ \t]*/u;

/**
 * 这一句的**每一个** ⟦ref:N⟧ 是否都指得出东西。
 *
 * 判据（与 `agent/reflect.ts` 的 `refsWithinRange` **同一条规则**）：句内 ≥1 个标记，
 * 且**每个** N 都落在 `[0, provenanceCount)`。形态不合（`⟦ref:abc⟧`）同样算指不出。
 *
 * ⚠️ **「全部指得出」而不是「有一个指得出」**：`"缺口 1200 台 ⟦ref:0⟧–⟦ref:9⟧"` 里只要有一个
 * 悬空，这句的数字就**没有**被完整溯源，豁免必须整体失效（否则半个指针就能洗白整句）。
 */
function refsAllResolve(sentence: string, provenanceCount: number): boolean {
  let seen = false;
  REF_MARK_RE.lastIndex = 0; // 共享 /g 正则：matchAll 会读 lastIndex，先归零防跨调用串味
  for (const m of sentence.matchAll(REF_MARK_RE)) {
    seen = true;
    const indexed = REF_INDEXED_RE.exec(m[0]);
    if (!indexed) return false;
    const n = Number(indexed[1]);
    if (!(Number.isInteger(n) && n >= 0 && n < provenanceCount)) return false;
  }
  return seen;
}

/**
 * @param provenanceCount 本次答案的 provenance 表条数 —— ⟦ref:N⟧ 的 N 只有落在 `[0, provenanceCount)`
 *   才算「指得出东西」。**必填**（不给缺省）：缺省值要么宽（当成"都指得出"= 复现本函数修掉的那个谎），
 *   要么严（当成"都指不出"= 合法答案被误标），两个方向都是**替调用方猜一个它才知道的事实**。
 */
export function hasUnverifiedNumerics(markdown: string, provenanceCount: number): boolean {
  const kept = splitSentences(markdown)
    .map((s) => s.replace(LIST_ORDINAL_RE, ""))
    // 豁免 = 该句每个 ⟦ref:N⟧ 都指得出东西；指不出 ⇒ 该句照扫（不豁免）
    .filter((s) => !refsAllResolve(s, provenanceCount))
    // 悬空标记**自身**的字符（`ref:9` 里的 `9`）不许进扫描面 —— 这条豁免的是标记语法，
    // 不是「有标记就放过」：剥完标记后句里若还有数字，照样要溯源。
    .map((s) => s.replace(REF_MARK_RE, ""))
    .join("");
  const withoutDates = kept.replace(ISO_DATE_RE, "");
  NUMERIC_RE.lastIndex = 0;
  return NUMERIC_RE.test(withoutDates);
}

export function scanBlocks(
  blocks: { type: string; markdown?: string }[],
  provenanceCount: number,
): boolean {
  for (const b of blocks) {
    if (b.type === "text" && typeof b.markdown === "string" && hasUnverifiedNumerics(b.markdown, provenanceCount)) {
      return true;
    }
  }
  return false;
}

/**
 * ══ 数字红线的处置沿革（读这段再改本文件）═══════════════════════════════════════
 *
 * **2026-09-08**（仓主架构原则：「所有计算原则上使用求解器而不是 agent(LLM) 来计算，agent
 *   只负责调动工具、本体、规则等等输出结果，然后基于结果推演。」）
 *   `WO-NUMERIC-REDLINE-BLOCK` 在 **dsh 路**把它做成**无条件硬拦**；原生路刻意**只报不断**，
 *   只统计「若阻断会拦下多少」。⇒ 同一个判据、同一个值，两条路两种结局。
 *
 * **2026-10-03**（仓主裁决：**对齐原生路·只报不断**）
 *   配对实测（同一句排产问话 / 同一 agent / 同一提示词）证明该不对称的代价是**真实交付**：
 *   · 原生路答案 `unverifiedNumerics=true` ⇒ **照常整份交付**（三方案 + 5 条溯源 + 33 条规则）；
 *   · dsh 路**同等质量**的答案（三方案 + 9 处 ⟦ref:N⟧）⇒ **整份拒绝**，用户只看到一句红线文案。
 *   ⇒ dsh 臂**结构上交付不了**本平台的目标产物（「形成多个方案和方案比对」），且与答案质量无关。
 *   故 dsh 路的硬拦与 `NUMERIC_REDLINE_CODE`/`NUMERIC_REDLINE_MESSAGE` 一并删除；
 *   两条路现在都是：`unverifiedNumerics` 诚实标 + `numericRedline{action:"would_block"}` 计数。
 *
 * ⚠️ **降的是处置，不是检测**：`scanBlocks` 仍是单源判据，一个字没松。
 * ⚠️ 收紧成平台级**阻断**是一次**同时作用于两条路**的产品动作。做之前必须先修下面这条 ——
 *   否则收紧的力度取决于模型爱不爱写编号列表：本文件的 `LIST_ORDINAL_RE` 已修「有序列表序号
 *   被当业务数字」这一条（实测占触发量的 58%）；
 *   **未修的残余**：非业务计数（「共读取 6 个文件」）仍会被咬住，且检测面只扫 `text` 块
 *   （`kpi` 块里的裸数扫不到）—— 两者都是登记在案的漏网/误报面，收紧前需逐条裁决。
 *
 * **2026-10-06**（`WO-NUM-FLAG-TRUTH` · 本文件**修的是检测**，不是处置）
 *   实测现场（活服务 4002 · 真 LLM provider `deepseek-flash[1M]` · DSH 内核 `kernel:"EXTERNAL"`）：
 *   一次真实 agent 跑交付的答案正文含 **20 处** `⟦ref:N⟧`（编号 {0,2,3,4,10,11}），而
 *   `answer.provenance` = **`[]`（0 条）** ⇒ **20 处指针全部指空**，而 `unverifiedNumerics` 报 **false**。
 *   同一次运行里 `agent/reflect.ts` 的 `refsWithinRange` **判了红**并把
 *   「回答里的出处标注指向了不存在的数据」写进了屏上自披露块 —— **两条判据对同一份答案结论相反**，
 *   而喂给「诚实标」的是弱的那条。
 *
 *   弱在哪（修前的 `hasUnverifiedNumerics`）：`.filter((s) => !REF_MARK_RE.test(s))` 把**含标记的整句
 *   直接丢弃**，`return NUMERIC_RE.test(withoutDates)` 只验「数字旁边**有没有**标记」，
 *   **从不验那个标记指得出东西**。形态：
 *   > **「我用『这个数字旁边有个 ⟦ref:N⟧ 标记』当作『这个数字有出处』的证据，
 *   >   而前者并不度量后者 —— 标记可以指空（表为空）或越界（N ≥ 表长）。」**
 *
 *   修法：豁免条件由「句内有标记」改为「句内**每个**标记都指得出东西」
 *   （`refsAllResolve`，与 `reflect.ts` 的 `refsWithinRange` **同一条规则**）；指不出的句子
 *   **不豁免**，照 PRD 正则扫（悬空标记自身的字符先剥掉，防 `ref:9` 的 `9` 被当成业务数字）。
 *   `provenanceCount` **必填** —— 见 `hasUnverifiedNumerics` 的 @param。
 */
