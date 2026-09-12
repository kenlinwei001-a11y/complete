/**
 * WO-D1 · 求解取消上下文（DataCore 侧）。
 *
 * 病灶（审核方真跑坐实）：AgentCore 的同步求解代理 `POST /b/v1/solvers/{key}/run` 用
 * `Promise.race([invoke, timeout])` 做 15s 超时 → 504 SOLVER_TIMEOUT。**`Promise.race` 只是不再等它，
 * 不是取消它**：整条链上没有任何 AbortSignal，504 返回后底层求解仍跑到底（探针实测 504@169ms 之后再等
 * 700ms → `finished=1`）。全局推演页滑杆 debounce 300ms 连发 → 服务端叠加求解、旧的仍在烧。
 *
 * 本模块 = DataCore 侧"取消到底"的载体：路由把请求生命周期（客户端断开 = AgentCore abort 了 fetch，
 * 或前端 AbortController 断连）派生成 AbortSignal，用 AsyncLocalStorage 挂成**请求作用域的环境取消令牌**，
 * 求解执行链上的可取消层（优化器 sidecar 的 fetch / A18 沙箱子进程 / 内存态贪心循环 / await 检查点）
 * 各自就近消费。
 *
 * 为什么用 AsyncLocalStorage 而不是逐层加参数：
 *   ① 求解入口 `app.ts → ontology.invokeSolver → solvers.invoke → compute → optimizer.solveXxx` 中间层
 *      （ontology.ts）不在本 WO 的文件边界内，逐层加参会越界改他人领地；
 *   ② 可取消点分散在 20+ 求解私有方法与 optimizer-client/sandbox 里，ALS 让消费点就近取用而不污染签名；
 *   ③ 未包裹的调用路径（内部派生、定时任务、测试直调）`getStore()` 恒 undefined → 行为逐字节不变（R6 向后兼容）。
 *
 * ⚠ 诚实边界（不许假装能取消）：
 *   - **可真取消**：优化器 sidecar 的 HTTP 调用（fetch signal → 连接中断）、A18 沙箱子进程（SIGKILL）、
 *     内存态贪心 portfolio/cross_object_occupancy 的逐项循环、各 await 检查点。
 *   - **不可取消**：单次同步 JS `compute()`（Node 单线程，函数跑起来就无法从外部打断）——取消只在
 *     await 边界/循环检查点生效；以及 **CP-SAT sidecar 进程本身**（services/optimizer/server.py 是
 *     ThreadingHTTPServer + BaseHTTPRequestHandler，无取消接口、不感知客户端断开，CP-SAT 求完才回写，
 *     写到死socket 才失败）。我们能做到的是**不再占用连接/不再等它**，但那个 Python 线程会跑完当次求解。
 *     此处不粉饰：上层绝不报告"已取消"来掩盖下层仍在跑（见 optimizer-client.ts 同款注记）。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../errors.js";

const cancelStore = new AsyncLocalStorage<AbortSignal>();

/**
 * 求解被取消（客户端断开 / 上游超时）。499 = client closed request（nginx 惯例）——此时客户端多半已经走了，
 * 状态码只影响日志与网关计数，不冒充成功也不冒充服务端错误。
 */
export class SolverCancelledError extends AppError {
  constructor(where: string) {
    super("SOLVER_CANCELLED", `求解已取消（客户端断开或上游超时）：${where}`, 499);
    this.name = "SolverCancelledError";
  }
}

/** 在请求作用域内挂取消信号后执行（signal 缺省 → 原样执行，行为不变）。 */
export function runWithCancellation<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return signal ? cancelStore.run(signal, fn) : fn();
}

/** 当前请求作用域的取消信号（无 → undefined，消费点自然降级为"不可取消"的现行为）。 */
export function currentCancellationSignal(): AbortSignal | undefined {
  return cancelStore.getStore();
}

/** await 边界检查点：已取消 → 抛 SolverCancelledError（不再往下烧 CPU / 打仓储）。 */
export function throwIfCancelled(where: string): void {
  if (cancelStore.getStore()?.aborted) throw new SolverCancelledError(where);
}
