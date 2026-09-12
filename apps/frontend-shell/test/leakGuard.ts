/**
 * 残留句柄守卫（欠账 #79 · frontend-shell 全量套件偶发 teardown 期红）
 *
 * 病灶形态：全部用例 passed、`Errors 1 error`、进程退出码非 0。成因是
 * "This error was caught after test environment was torn down" —— 用例结束、jsdom 环境拆掉之后，
 * 还有 app 排的定时器回调在跑（继续 setState / 继续发 fetch），vitest 记为 unhandled error 判整包红。
 * 它取决于「拆除」与「回调」谁先到，所以同一 sha 一次绿一次红。
 *
 * 本守卫断言的是**效果**：afterEach（RTL cleanup 之后）还有没有活着的句柄。
 * 不是「检查有没有写 clearTimeout」（运输层），是「进程里还有没有这个 handle」（效果层）。
 *
 * 归属只认 **app 源码直接排** 的定时器：栈上第一个有文件位置的帧若落在 node_modules
 * （React 调度器 / react-query 重试 / RTL waitFor 轮询…），一律不算 —— 那些由库自己清，
 * 误报会把守卫本身变成新的 flaky。
 *
 * 性能：setTimeout 是全套件最热的调用之一，**不能在每次排程时就格式化调用栈**（`.stack` 取值
 * 会真的把整套跑拖慢、进而抖动那些对时序敏感的用例）。因此这里只在排程时构造一个 6 帧上限的
 * Error（仅结构化捕获，不取 .stack），把「它是谁排的」推迟到 afterEach 收割时——只有真泄漏的
 * 那几个才付格式化的代价。
 */
type TimerId = ReturnType<typeof setTimeout>;

interface LiveTimer {
  kind: "setTimeout" | "setInterval";
  delay: number;
  /** 排程点的调用栈载体；只有被判定为泄漏时才会取 .stack */
  site: Error;
}

const live = new Map<TimerId, LiveTimer>();

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
const realSetInterval = globalThis.setInterval.bind(globalThis);
const realClearInterval = globalThis.clearInterval.bind(globalThis);

/** 构造仅捕获浅栈的 Error（判定只看最上面几帧，多抓的帧纯属浪费） */
function captureSite(): Error {
  const savedLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 6;
  const err = new Error("timer-site");
  Error.stackTraceLimit = savedLimit;
  return err;
}

/** 栈顶第一个有文件位置的帧：落在 src/ 才认；落在 node_modules 直接判为非 app */
function appOriginOf(site: Error): string | null {
  const stack = site.stack;
  if (!stack) return null;
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("node:")) continue; // node 内部帧（task_queues 等）不参与判定
    const m = /(?:file:\/\/)?(\/[^\s():]+):(\d+):\d+/.exec(line);
    if (!m) continue;
    const file = m[1]!;
    if (file.endsWith("/test/leakGuard.ts")) continue;
    if (file.includes("/node_modules/")) return null;
    return file.includes("/src/") ? `${file}:${m[2]}` : null;
  }
  return null;
}

globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (typeof handler !== "function") return realSetTimeout(handler, timeout, ...args);
  // 句柄要在回调里自注销，而回调必须先于 setTimeout 存在 —— 用一格盒子把 id 递进闭包
  const box: { id: TimerId | null } = { id: null };
  const fn = handler as (...a: unknown[]) => void;
  const wrapped = (...a: unknown[]) => {
    if (box.id !== null) live.delete(box.id);
    fn(...a);
  };
  const id = realSetTimeout(wrapped, timeout, ...args) as TimerId;
  box.id = id;
  live.set(id, { kind: "setTimeout", delay: timeout ?? 0, site: captureSite() });
  return id;
}) as typeof globalThis.setTimeout;

globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = realSetInterval(handler, timeout, ...args) as unknown as TimerId;
  if (typeof handler === "function") {
    live.set(id, { kind: "setInterval", delay: timeout ?? 0, site: captureSite() });
  }
  return id;
}) as unknown as typeof globalThis.setInterval;

globalThis.clearTimeout = ((id?: TimerId) => {
  if (id !== undefined) live.delete(id);
  realClearTimeout(id);
}) as typeof globalThis.clearTimeout;

globalThis.clearInterval = ((id?: TimerId) => {
  if (id !== undefined) live.delete(id);
  realClearInterval(id);
}) as typeof globalThis.clearInterval;

/**
 * 收割残留句柄：返回 app 侧泄漏的描述串（空 = 干净）。
 * 库自己排的长活定时器（react-query gcTime 等）在此被归属过滤掉，不清也不报。
 * app 侧的则**真清掉再报** —— 守卫不能自己变成下一条用例的污染源。
 */
export function harvestLeakedTimers(): string[] {
  const out: string[] = [];
  for (const [id, h] of live) {
    const origin = appOriginOf(h.site);
    if (origin === null) continue;
    realClearTimeout(id);
    realClearInterval(id);
    out.push(`${h.kind}(${h.delay}ms) ← ${origin}`);
  }
  live.clear();
  return out.sort();
}
