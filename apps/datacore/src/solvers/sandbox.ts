// A18.2 锁死沙箱（父进程）：把 LLM 生成的纯函数源码丢进**独立子进程**（Node `--permission` 拒 fs/子进程/worker）
// 跑通取结果，CPU/时限有界。沙箱无逃逸 + 确定性由 `sandbox-runner.mjs` 保证（Date 冻结/Math.random 禁用）。
// 与 CP-SAT sidecar 同范式：数据只经 stdin 注入、只回 stdout JSON，不出边界（R5）。
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url));

/**
 * Node 权限模型的开关名随版本变过：Node 20 只有 `--experimental-permission`，较新的 22.x/23+ 才是
 * `--permission`。此前这里把 `--permission` 写死，于是在 CLAUDE.md 明确声明支持的 **Node 20** 上
 * 子进程直接以 `bad option: --permission` 启动失败 —— 沙箱求解器整条路径在最低支持版本上是死的，
 * 连带 DF.8/DF.11 接地链永远停在 UNREGISTERED（到不了 PROVISIONAL）。
 *
 * 该缺陷长期无人发现，因为开发机跑 Node 22（本地全绿）而 CI 从未真正执行过测试（pnpm 版本冲突
 * 导致每次 run 8 秒内死于 setup）。**本仓「绿测试≠能用」的又一层：绿只代表在你那台机器上绿。**
 *
 * 故改为运行时探测实际可用的开关，而非按版本号猜边界（版本边界本身就是这次踩坑的来源）。
 */
let permFlagCache: string | null | undefined;
function permissionFlag(): string | null {
  if (permFlagCache !== undefined) return permFlagCache;
  for (const flag of ["--permission", "--experimental-permission"]) {
    const probe = spawnSync(process.execPath, [flag, "-e", ""], { env: {}, stdio: "ignore" });
    if (probe.status === 0) return (permFlagCache = flag);
  }
  // ⛔ fail-closed：两个开关都不可用时**拒绝执行**，绝不退化成"无隔离直接跑"。
  //    这里跑的是 LLM 生成的不可信代码，没有权限模型就没有沙箱，静默降级 = 静默开洞。
  return (permFlagCache = null);
}

export interface SandboxResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface SandboxOpts {
  /** 墙钟时限（毫秒），超时 SIGKILL（默认 1500ms）。 */
  timeoutMs?: number;
  /** 最大输出字节（防输出炸内存，默认 256KB）。 */
  maxOutputBytes?: number;
}

/**
 * 在锁死子进程沙箱里执行 `(ctx,args)=>output` 纯函数源码。
 * 返回 {ok, output} 或 {ok:false, error}（语法错/抛错/超时/越权/输出过大）。绝不在主进程 eval 不可信代码。
 */
export function runSolverSandbox(source: string, ctx: unknown, args: unknown, opts: SandboxOpts = {}): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const maxOut = opts.maxOutputBytes ?? 256 * 1024;
  return new Promise((resolve) => {
    const permFlag = permissionFlag();
    if (permFlag === null) {
      // 无权限模型 = 无沙箱。宁可诚实拒绝，也不把不可信代码放进裸子进程。
      return resolve({ ok: false, error: "SANDBOX_UNAVAILABLE: node permission model not supported by this runtime" });
    }
    let child;
    try {
      child = spawn(
        process.execPath,
        // 权限模型拒文件写/子进程/worker（fs 读仅放行 runner 自身）；空 env。
        [permFlag, `--allow-fs-read=${RUNNER}`, RUNNER],
        { env: {}, stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (e) {
      return resolve({ ok: false, error: `SPAWN_FAIL: ${(e as Error).message}` });
    }
    let out = "";
    let err = "";
    let done = false;
    const finish = (r: SandboxResult) => { if (done) return; done = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: "TIMEOUT" }), timeoutMs);
    child.stdout.on("data", (d: Buffer) => { out += d; if (out.length > maxOut) finish({ ok: false, error: "OUTPUT_TOO_LARGE" }); });
    child.stderr.on("data", (d: Buffer) => { err += d; });
    child.on("error", (e) => finish({ ok: false, error: `CHILD_ERROR: ${e.message}` }));
    child.on("close", () => {
      if (done) return;
      clearTimeout(timer);
      done = true;
      try { resolve(JSON.parse(out) as SandboxResult); }
      catch { resolve({ ok: false, error: (err.slice(0, 200) || "NO_OUTPUT").trim() }); }
    });
    try { child.stdin.write(JSON.stringify({ source, ctx, args })); child.stdin.end(); }
    catch (e) { finish({ ok: false, error: `STDIN_FAIL: ${(e as Error).message}` }); }
  });
}
