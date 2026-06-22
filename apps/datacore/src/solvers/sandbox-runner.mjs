// A18.2 锁死沙箱子进程 runner（独立子进程范式，用户裁决 2026-06-21）。
// 在受限作用域执行 LLM 生成的纯函数 `(ctx,args)=>output`：
//  - 确定性(R6)：Date 冻结到 epoch 0、Math.random 禁用（抛错）——非确定来源被掐死；
//  - 隔离(R5)：父进程以 `--permission` 起本进程 → fs 写/子进程/worker 被 Node 权限模型拒；
//    require/process/fetch/globalThis 在函数作用域遮蔽为 undefined（净室，数据只经 stdin 注入、只回 stdout）。
// 协议：stdin 收 {source, ctx, args} JSON → stdout 回 {ok, output?} 或 {ok:false, error}。
let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(input); } catch { return emit({ ok: false, error: "BAD_INPUT_JSON" }); }
  const { source, ctx, args } = payload ?? {};
  if (typeof source !== "string") return emit({ ok: false, error: "NO_SOURCE" });

  // 确定性替身：冻结时钟 + 禁随机（沙箱内任何非确定来源即报错，守 R6）。
  class FrozenDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(0); }
    static now() { return 0; }
  }
  const RANDOM_BANNED = () => { throw new Error("Math.random 禁用（沙箱确定性 R6）"); };
  const frozenMath = new Proxy(Math, { get: (t, k) => (k === "random" ? RANDOM_BANNED : t[k]) });

  try {
    // 遮蔽危险全局为 undefined；用 strict-mode Function 跑用户纯函数（require/process/fetch 不可达）。
    const fn = new Function(
      "ctx", "args", "Date", "Math", "process", "require", "fetch", "globalThis", "setTimeout", "setInterval",
      `"use strict"; const __userFn = (${source}); return __userFn(ctx, args);`,
    );
    const output = fn(ctx, args, FrozenDate, frozenMath, undefined, undefined, undefined, undefined, undefined, undefined);
    // 输出必须可 JSON 序列化（净室只回数据）。
    emit({ ok: true, output: JSON.parse(JSON.stringify(output ?? null)) });
  } catch (e) {
    emit({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
});
function emit(o) { try { process.stdout.write(JSON.stringify(o)); } catch { process.stdout.write('{"ok":false,"error":"EMIT_FAIL"}'); } }
