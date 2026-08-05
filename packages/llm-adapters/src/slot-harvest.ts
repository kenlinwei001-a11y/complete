/**
 * WO-SLOT-HARVEST · 分类结果**槽位收割器**（单源 · openai / anthropic / degrade 三条路共用）。
 *
 * 病根（2026-08-05 真 Kimi k2.5 抓包坐实·同一道题连跑 5 次 5 次全抽对了槽，只有 2 次进得了系统）：
 *   | 跑次 | Kimi 把槽写在哪 | 旧代码看的位置 | 结果 |
 *   |---|---|---|---|
 *   | #1/#5 | 顶层 `extractedSlotsJson` | 顶层 | ✅ |
 *   | #2/#3/#4 | `candidates[0].extractedSlots` | 顶层 | ❌ 槽位被**窄 zod schema 删掉**，再被 `?? {}` 报成"没有" |
 *
 * 两处病灶（缺一不可）：
 *  A-1 · **schema 自己销毁证据**：`z.object({intentKey,confidence})` 默认剔除未知键 → candidate 里的
 *        `extractedSlots` 在校验那一行就没了，之后再怎么读都读不到。
 *  A-2 · **断言性兜底却从不检查它所断言的条件**：`parsed.data.extractedSlots ?? {}` 说的是「没有槽位」，
 *        但它只知道**自己看的那一个位置**是空的 —— 「我没找到」被当成「它没有」。
 *
 * 于是本模块的两条硬规矩：
 *  1. **跑在 `raw` 上，不是 `parsed.data` 上**（窄 schema 会先把证据删掉 —— 这是命门）。
 *  2. **`unconsumed` 是诚实闸**：raw 里出现了槽位形状的数据而本收割器没吃掉 → 必须能被看见（调用方落日志），
 *     不许再出现"我没找到 = 它没有"。下次模型再变个形态，是**报出来**而不是静默丢答案。
 *
 * R6：纯函数（无 IO / 无时钟 / 无随机 / 无 LLM），同 raw 同输出。
 */

/** 槽位来自哪个位置（审计/可观测：别让下次再变形时又无声）。level=顶层/候选 × 编码=对象/JSON 字符串。 */
export type SlotSource = "topJson" | "topObject" | "candidateObject" | "candidateJson";

export interface HarvestedClassificationSlots {
  slots: Record<string, unknown>;
  /** 每个槽最终采信的来源位置（合并优先级的可审计留痕）。 */
  sources: Record<string, SlotSource>;
  /** 出现了槽位形状的数据（键名匹配 /slot/i 的对象/字符串）但本收割器**没消费** → 必须能被看见，不许静默。 */
  unconsumed: string[];
}

/** 键名匹配即视为"槽位形状"（收割器认得的四种合法形态之外的一律进 unconsumed）。 */
const SLOT_SHAPED_KEY = /slot/i;
/** 遍历上界（防病态深层结构拖慢热路径；超界即停，不递归）。 */
const MAX_WALK_DEPTH = 6;
const MAX_WALK_NODES = 2000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** JSON 字符串形态的槽位袋 → 对象；不是字符串/不可解析/解析出来不是对象 → undefined（**不吞**：调用侧据此判未消费）。 */
function parseSlotJson(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const parsed = JSON.parse(v) as unknown;
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 空值（undefined/null/空串）视为**未提供** —— 否则一句 `"base":null` 就能把 candidate 里的真值挡住。 */
function isProvided(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

interface SlotLayer {
  /** raw 里的位置（JSON path，如 `candidates[0].extractedSlots`）—— 同时是 consumed 标记键。 */
  path: string;
  source: SlotSource;
  bag: Record<string, unknown>;
}

/**
 * 从**原始**分类响应体里收割槽位（四种合法形态全收）：
 *  - 顶层 `extractedSlotsJson`(string) / 顶层 `extractedSlots`(object)
 *  - `candidates[i].extractedSlotsJson`(string) / `candidates[i].extractedSlots`(object)
 *
 * **合并优先级（确定性·写死在这里，不许"看运气"）**：
 *   ① 顶层 > candidate（顶层是模型对整条响应的表态）；
 *   ② 顶层内部：`extractedSlotsJson` > `extractedSlots`（与旧 openai 适配器行为一致 —— 旧代码里 Json 整袋覆盖 object）；
 *   ③ candidate 之间：**confidence 降序，同分按数组下标升序**；单个 candidate 内部同 ②（Json > object）；
 *   ④ 同一槽名先写者胜（= 高优先级层胜）；空值（null/""）不算"写过"，允许更低优先层补上。
 *
 * 两种编码都容忍（object 直给 / JSON 字符串），因为请求侧**不能**用 `strict:true` 收口 ——
 * 实测 Moonshot/Kimi 在 `strict:true` 下返空/不可解析，方向只能是**让读的一方容忍**。
 */
export function harvestClassificationSlots(raw: unknown): HarvestedClassificationSlots {
  const slots: Record<string, unknown> = {};
  const sources: Record<string, SlotSource> = {};
  const consumed = new Set<string>();
  if (!isPlainObject(raw)) return { slots, sources, unconsumed: [] };

  const layers: SlotLayer[] = [];
  /** 收一层：对象直收；JSON 字符串解析后收；**解析不了就不标 consumed** → 由 unconsumed 兜住（诚实）。 */
  const takeLayer = (path: string, value: unknown, level: "top" | "candidate"): void => {
    if (value === undefined || value === null) return;
    if (isPlainObject(value)) {
      layers.push({ path, source: level === "top" ? "topObject" : "candidateObject", bag: value });
      consumed.add(path);
      return;
    }
    const parsed = parseSlotJson(value);
    if (parsed) {
      layers.push({ path, source: level === "top" ? "topJson" : "candidateJson", bag: parsed });
      consumed.add(path);
    }
  };

  // ① 顶层（Json > object）
  takeLayer("extractedSlotsJson", raw.extractedSlotsJson, "top");
  takeLayer("extractedSlots", raw.extractedSlots, "top");

  // ② candidates：confidence 降序 → 同分按下标升序（确定性排序，不许依赖数组自然序的运气）
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const ordered = candidates
    .map((c, index) => ({ c, index }))
    .filter((e): e is { c: Record<string, unknown>; index: number } => isPlainObject(e.c))
    .sort((a, b) => {
      const ca = typeof a.c.confidence === "number" ? a.c.confidence : Number.NEGATIVE_INFINITY;
      const cb = typeof b.c.confidence === "number" ? b.c.confidence : Number.NEGATIVE_INFINITY;
      return cb - ca || a.index - b.index;
    });
  for (const { c, index } of ordered) {
    takeLayer(`candidates[${index}].extractedSlotsJson`, c.extractedSlotsJson, "candidate");
    takeLayer(`candidates[${index}].extractedSlots`, c.extractedSlots, "candidate");
  }

  // ③ 合并：层序即优先级，先写者胜（空值不算写过）
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer.bag)) {
      if (!isProvided(v)) continue;
      if (Object.prototype.hasOwnProperty.call(slots, k)) continue;
      slots[k] = v;
      sources[k] = layer.source;
    }
  }

  return { slots, sources, unconsumed: collectUnconsumed(raw, consumed) };
}

/**
 * 诚实闸：走一遍 raw，把**键名匹配 /slot/i 且值是对象/字符串**、却没被收割器消费的位置列出来。
 * 已消费的位置**不再下钻**（否则 `extractedSlots` 里恰好有个叫 `slotX` 的槽会被误报）。
 * 顺序 = 遍历序（对象键序来自 JSON.parse，确定性）。
 */
function collectUnconsumed(raw: Record<string, unknown>, consumed: Set<string>): string[] {
  const out: string[] = [];
  let nodes = 0;
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || nodes > MAX_WALK_NODES) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        nodes++;
        const childPath = `${path}[${i}]`;
        if (consumed.has(childPath)) return;
        walk(item, childPath, depth + 1);
      });
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      nodes++;
      const childPath = path ? `${path}.${k}` : k;
      if (consumed.has(childPath)) continue; // 已吃掉：既不报也不下钻
      if (SLOT_SHAPED_KEY.test(k) && (isPlainObject(v) || typeof v === "string")) {
        out.push(childPath);
        continue; // 报了就不再下钻（避免同一坨数据重复刷屏）
      }
      walk(v, childPath, depth + 1);
    }
  };
  walk(raw, "", 0);
  return out;
}

/** 可注入的告警出口（默认 globalThis.console.warn；本包不依赖 @types/node）。 */
export interface UnconsumedSink {
  warn(message: string): void;
}

function defaultSink(): UnconsumedSink | undefined {
  const c = (globalThis as { console?: { warn?: (msg: string) => void } }).console;
  return c && typeof c.warn === "function" ? { warn: (m: string) => c.warn!(m) } : undefined;
}

/**
 * `unconsumed` 的**真消费方**（三条适配器路都调它）：出现了槽位形状却没被收割 → 打日志。
 * 「只定义不调用」= 假绿第 9 形态（测试咬的是函数不是链路），本函数存在的意义就是让那条路真的有人走。
 */
export function reportUnconsumedSlots(
  where: string,
  harvest: Pick<HarvestedClassificationSlots, "unconsumed">,
  sink: UnconsumedSink | undefined = defaultSink(),
): void {
  if (harvest.unconsumed.length === 0 || !sink) return;
  sink.warn(
    `[llm-adapters/${where}] 分类响应里出现了槽位形状的数据但未被收割：${harvest.unconsumed.join(", ")}` +
      `（模型换了形态 → 请扩收割器 harvestClassificationSlots，别让槽位再静默丢失）`,
  );
}
