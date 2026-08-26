/**
 * ══ WO-SANDBOX-MEMORY · `GET /a/v1/sim/sessions` 的**流式投影** ═══════════════════════
 *
 * 病灶（本单亲手实测 **2026-08-22**，非推测；复验见本块末尾《怎么再测一遍》）：
 * 该端点把**每一条**会话的完整 `baseSnapshot` 全量回给前端。
 * 一条 = 11,348 对象 × 36 状态变量 = 408,528 格 ≈ 8.4MB JSON；库里 35 条 ⇒ **单跳 285MB**。
 * 而前端有 **5 个调用点 / 3 个不同缓存键**（`["a","sim-sessions"]` ·
 * `[…,"enterprise-fork"]` · `[…,"impact-analysis"]`），于是同一份 285MB 在
 * React Query 缓存里**同时躺 2–3 份**。真浏览器实测（35 条会话，已 gc）：
 *   · 沙盘挂载、列表在途        heap =  91.5MB
 *   · 列表落地                 heap = 257.3MB   ⇒ **这一跳净持有 165.8MB**
 *   · 缓存逐条：`["a","sim-sessions"]` 293.27MB ＋ `[…,"enterprise-fork"]` 293.27MB
 *
 * 关键事实（本单逐个消费方读过，不是猜的）：**除 `SandboxView` 的下区差分基线之外，
 * 没有任何一个消费方读 `baseSnapshot`**。五个调用点要的全是
 * id / createdAt / status / curTick / scope / disabledRuleKeys 这些几十字节的字段。
 *
 * ⇒ 本模块在**解析之前**就把 `baseSnapshot` 从字节流里剥掉：
 *   · 剥掉 ⇒ 缓存里不再有那 285MB（`JSON.parse` 也不再为它建对象图，峰值同时下来）；
 *   · 需要基线的那一处（且**只有那一处**）用 `keepFor` 单条捞回来，**一次只驻留一条**。
 *
 * ⛔ **为什么剥成「字段不存在」而不是 `{}` 或 `null`**：留一个空世界回去，将来任何人读它
 *   都会安静地拿到"这个世界没有格"——那正是本仓最恨的静默错答。字段**缺席** ⇒ 类型上
 *   `SimSessionListItem` 压根没有这个键 ⇒ 谁想读，`tsc` 当场报错。**机器先说话。**
 *
 * ⛔ **这不是"后端该做的事前端补一刀"的重复实现**：端点该不该投影是另一张单的事。
 *   本模块**与那张单正交** —— 后端一旦不再下发 `baseSnapshot`，扫描器扫不到这个键，
 *   就是个纯拷贝，行为逐字节不变（`stripped === 0`，见 `SessionsProjectionStats`）。
 *
 * ── 《怎么再测一遍》（2026-08-22 那次实测的复现路径，逐条都能亲手跑）───────────────
 *   ① 量级断言（不需要后端）：
 *      `pnpm --filter frontend-shell exec vitest run test/sandbox-memory-projection.test.ts`
 *      —— 用例 ⑨「11,348 对象 × 36 变量那一条，剥后 < 1‰」就是上面那组数字的机器化断言；
 *      用例 ①「金丝雀：stripped 必须 > 0」保证扫描器没瞎（剥不到就红，而不是安静报干净）。
 *   ② 真回包字节数（SEED_DEMO=1 起 datacore 之后）：
 *      `curl -s -o /dev/null -w '%{size_download}\n' -H 'X-Debug-User: demo:admin:admin|planner|catalog_admin' http://127.0.0.1:4001/a/v1/sim/sessions`
 *   ③ 前端这一屏真的不再持有那份内存：
 *      `pnpm --filter frontend-shell exec vitest run test/sandbox-memory-window.seam.test.tsx`
 *      —— 用例 ⑤「回包很大，落到组件里的却只有几十字节/条」。
 */

/** 剥掉 `baseSnapshot` 之后的会话列表项：**该字段在类型上就不存在**（谁想读，tsc 报错）。 */
export type WithoutBaseSnapshot<T> = Omit<T, "baseSnapshot">;

/** 扫描统计 —— 报「剥了 0 条」这种否定结论时，必须同时给出金丝雀证据（铁律 0.6）。 */
export interface SessionsProjectionStats {
  /** 真被剥掉的 `baseSnapshot` 个数。**0 不等于"扫描器坏了"，也不等于"回包干净"** —— 看 `itemsSeen`。 */
  stripped: number;
  /** 扫到的 item 对象个数（金丝雀：它为 0 而回包非空 ⇒ 扫描器坏了，不许报「列表是空的」）。 */
  itemsSeen: number;
  /** 剥掉的字节数（= 省下来的解析量）。 */
  strippedBytes: number;
}

export interface SessionsProjectionResult<T> {
  items: WithoutBaseSnapshot<T>[];
  /** `keepFor` 指名那条会话的 `baseSnapshot`；没指名 / 没找到 ⇒ `null`（**不造一个空世界出来**）。 */
  kept: unknown | null;
  stats: SessionsProjectionStats;
}

/** `cur` 攒到这么多字符就冲进 out（只在"不在字符串里、不在候选键里、末字符不是逗号"时才冲）。 */
const FLUSH_AT = 1 << 16;

/** 被剥的那个键。**只有一处**——扫描主逻辑与金丝雀共用它，不许各抄一份（铁律 0.6 机制条）。 */
export const STRIPPED_KEY = "baseSnapshot";

/**
 * 增量扫描器：边喂字节边吐"已剥掉 `baseSnapshot`"的 JSON 文本。
 *
 * 只在 `{ [ { … } ] }` 这**一层**（= `{"items":[{会话}]}` 的会话对象）上剥，
 * 嵌套更深处同名的键一律不动 —— 免得哪天某个字段内部恰好也叫这个名字被误伤。
 */
class Stripper {
  private out: string[] = [];
  private cur = "";
  /** 容器栈：`{` / `[`。剥的判据 = 栈恰为 `{ [ {`。 */
  private stack: string[] = [];
  private inStr = false;
  private esc = false;
  /** 当前字符串 token 在 `cur` 里的起点（`null` = 不在字符串 token 里）。 */
  private tokStart: number | null = null;
  private tok = "";
  /** 刚读完的那个字符串 token 是不是 `baseSnapshot`，且正等冒号。 */
  private awaitColon = false;
  /** `awaitColon` 期间记住键在 `cur` 里的起点 —— 见到冒号才真的截断（不见冒号说明那不是键）。 */
  private keyStart = 0;
  /** 上一个已确认的键名（用来认 `"id": "…"` 的值）。 */
  private lastKey: string | null = null;
  /** 每个 item 对象的 id（帧内），供 `keepFor` 判定。 */
  private frameId: string | null = null;
  private mode: "copy" | "value" | "afterValue" = "copy";
  private valDepth = 0;
  private capture: string[] | null = null;
  private captureBuf = "";

  private keptText: string | null = null;
  private pendingCapture: string | null = null;

  stats: SessionsProjectionStats = { stripped: 0, itemsSeen: 0, strippedBytes: 0 };

  constructor(private readonly keepFor: string | null) {}

  /** 是不是正站在"会话对象"那一层（栈 = `{ [ {`）。 */
  private atItemLevel(): boolean {
    return this.stack.length === 3 && this.stack[0] === "{" && this.stack[1] === "[" && this.stack[2] === "{";
  }

  private flushMaybe(): void {
    if (this.mode !== "copy" || this.inStr || this.tokStart !== null || this.awaitColon) return;
    if (this.cur.length < FLUSH_AT) return;
    // 末字符是逗号时**不冲** —— 那个逗号可能马上要被"剥掉最后一个成员"这条路回收掉。
    if (this.cur.endsWith(",")) return;
    this.out.push(this.cur);
    this.cur = "";
  }

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;

      // ── 跳过 / 捕获 `baseSnapshot` 的值 ───────────────────────────────
      if (this.mode === "value") {
        if (this.capture !== null) {
          this.captureBuf += ch;
          if (this.captureBuf.length > FLUSH_AT) { this.capture.push(this.captureBuf); this.captureBuf = ""; }
        }
        this.stats.strippedBytes++;
        if (this.inStr) {
          if (this.esc) this.esc = false;
          else if (ch === "\\") this.esc = true;
          else if (ch === '"') this.inStr = false;
          continue;
        }
        if (ch === '"') { this.inStr = true; continue; }
        if (ch === "{" || ch === "[") { this.valDepth++; continue; }
        if (ch === "}" || ch === "]") {
          this.valDepth--;
          if (this.valDepth === 0) {
            if (this.capture !== null) {
              this.capture.push(this.captureBuf);
              this.pendingCapture = this.capture.join("");
              this.capture = null; this.captureBuf = "";
            }
            this.mode = "afterValue";
          }
          continue;
        }
        // 标量值（数字 / true / null）：没有括号可数，遇到 `,` 或 `}` 就算完
        if (this.valDepth === 0 && (ch === "," || ch === "}" || ch === "]")) {
          this.mode = "afterValue";
          i--; // 这个字符要交给 afterValue 处理
          this.stats.strippedBytes--;
          continue;
        }
        continue;
      }

      // ── 值跳完了：把紧跟的逗号一并吃掉；若它是最后一个成员，则回收前面那个逗号 ──
      if (this.mode === "afterValue") {
        if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
        if (ch === ",") { this.mode = "copy"; continue; }
        // 是 `}`（或 `]`）⇒ 被剥的是最后一个成员 ⇒ 把 `cur` 末尾那个逗号去掉
        const trimmed = this.cur.replace(/[\s]*$/, "");
        if (trimmed.endsWith(",")) this.cur = trimmed.slice(0, -1);
        this.mode = "copy";
        i--; // 这个 `}` 交给正常拷贝路径去数栈
        continue;
      }

      // ── 正常拷贝 ─────────────────────────────────────────────────────
      this.cur += ch;

      if (this.inStr) {
        if (this.esc) { this.esc = false; this.tok += ch; continue; }
        if (ch === "\\") { this.esc = true; this.tok += ch; continue; }
        if (ch === '"') {
          this.inStr = false;
          const token = this.tok;
          this.tok = "";
          // `"id": "…"` 的值：记进当前帧
          if (this.lastKey === "id" && this.atItemLevel()) this.frameId = token;
          if (token === STRIPPED_KEY && this.atItemLevel()) {
            this.awaitColon = true;
            this.keyStart = this.tokStart!;
          } else {
            this.lastKey = token; // 可能是键，见到冒号才作数；不是键也无害（下个键会覆盖）
          }
          this.tokStart = null;
          continue;
        }
        this.tok += ch;
        continue;
      }

      if (ch === '"') { this.inStr = true; this.tokStart = this.cur.length - 1; this.tok = ""; continue; }

      if (this.awaitColon) {
        if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
        if (ch === ":") {
          // 真是键 ⇒ 把 `"baseSnapshot":` 从输出里抹掉，转入跳值
          this.cur = this.cur.slice(0, this.keyStart);
          this.awaitColon = false;
          this.mode = "value";
          this.valDepth = 0;
          this.inStr = false;
          this.stats.stripped++;
          // keepFor 指名时：先无条件捕获（`id` 未必排在前面），帧结束再按 id 定去留
          this.capture = this.keepFor !== null ? [] : null;
          this.captureBuf = "";
          continue;
        }
        // 不是键（是个数组元素之类）⇒ 当普通 token 放过
        this.awaitColon = false;
      }

      if (ch === "{" || ch === "[") {
        this.stack.push(ch);
        if (this.stack.length === 3 && this.stack[0] === "{" && this.stack[1] === "[" && ch === "{") {
          this.stats.itemsSeen++;
          this.frameId = null;
          this.pendingCapture = null;
        }
        this.lastKey = null;
      } else if (ch === "}" || ch === "]") {
        const wasItem = this.atItemLevel();
        this.stack.pop();
        if (wasItem && ch === "}") {
          if (this.pendingCapture !== null) {
            if (this.keepFor !== null && this.frameId === this.keepFor) this.keptText = this.pendingCapture;
            this.pendingCapture = null; // 不是要的那条 ⇒ 当场松手，一次只驻留一条
          }
          this.frameId = null;
        }
        this.lastKey = null;
      }

      this.flushMaybe();
    }
  }

  finish<T>(): SessionsProjectionResult<T> {
    this.out.push(this.cur);
    this.cur = "";
    const text = this.out.join("");
    this.out = [];
    const parsed = JSON.parse(text) as { items?: WithoutBaseSnapshot<T>[] };
    const kept = this.keptText === null ? null : (JSON.parse(this.keptText) as unknown);
    this.keptText = null;
    return { items: parsed.items ?? [], kept, stats: this.stats };
  }
}

/**
 * 把一段完整 JSON 文本按上面的规则投影（**扫描器主逻辑的唯一实现** —— 流式路与非流式路
 * 都调它，测试里的金丝雀也调它。抄第二份正则就成了装饰品：改主逻辑时金丝雀拿旧的去测、照样绿）。
 */
export function projectSessionsText<T>(text: string, keepFor: string | null = null): SessionsProjectionResult<T> {
  const s = new Stripper(keepFor);
  s.push(text);
  return s.finish<T>();
}

/**
 * 从一个 `Response` 流式读出投影结果。
 *
 * `res.body` 不可用时（jsdom / MSW / 老浏览器）**回落到 `res.text()` 再走同一支扫描器** ——
 * 回落只损失"不攒整串"这一个好处，剥字段与类型这两件事逐字节一致。
 */
export async function readSessionsProjected<T>(
  res: Response,
  keepFor: string | null = null,
): Promise<SessionsProjectionResult<T>> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    return projectSessionsText<T>(await res.text(), keepFor);
  }
  const s = new Stripper(keepFor);
  const reader = body.getReader();
  const dec = new TextDecoder("utf-8");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) s.push(dec.decode(value, { stream: true }));
  }
  const tail = dec.decode();
  if (tail) s.push(tail);
  return s.finish<T>();
}
