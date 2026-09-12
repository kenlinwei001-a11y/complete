import { describe, expect, it } from "vitest";
import { runSolverSandbox } from "../src/solvers/sandbox.js";

/**
 * A18.2 · 锁死沙箱（独立子进程）无逃逸 + 确定性证明（= `solver-sandbox:check` 门）。
 * 守 R5（隔离不出边界）+ R6（沙箱内非确定来源被掐死）：LLM 生成的纯函数只能算、不能逃。
 */
describe("A18.2 · 锁死沙箱（solver-sandbox:check）", () => {
  it("正常纯函数：(ctx,args)=>output 真跑出结果", async () => {
    const r = await runSolverSandbox("(ctx, args) => ({ sum: ctx.a + args.b, items: ctx.list.length })", { a: 10, list: [1, 2, 3] }, { b: 5 });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ sum: 15, items: 3 });
  }, 15000);

  it("确定性 R6 ①：Math.random 禁用 → 报错（非确定来源掐死）", async () => {
    const r = await runSolverSandbox("(ctx, args) => Math.random()", {}, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/random|禁用/);
  }, 15000);

  it("确定性 R6 ②：Date 冻结到 epoch 0（同输入同输出）", async () => {
    const r = await runSolverSandbox("(ctx, args) => ({ now: Date.now(), y: new Date().getTime() })", {}, {});
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ now: 0, y: 0 });
  }, 15000);

  it("隔离 R5：require/process/fetch/globalThis 在作用域不可达（fs/net 无直接入口）", async () => {
    const r = await runSolverSandbox("(ctx, args) => ([typeof require, typeof process, typeof fetch, typeof globalThis].join(','))", {}, {});
    expect(r.ok).toBe(true);
    expect(r.output).toBe("undefined,undefined,undefined,undefined");
  }, 15000);

  it("隔离 R5：constructor 逃逸取 require 也拿不到（ReferenceError → 不可读 fs）", async () => {
    const r = await runSolverSandbox("(ctx, args) => { const r = (function(){}).constructor('return require')(); return r('fs'); }", {}, {});
    expect(r.ok).toBe(false); // require 在子进程 ESM 上下文未定义 → 抛错，拿不到 fs
  }, 15000);

  it("时限：死循环 → SIGKILL TIMEOUT（CPU 有界）", async () => {
    const r = await runSolverSandbox("(ctx, args) => { while (true) {} }", {}, {}, { timeoutMs: 600 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("TIMEOUT");
  }, 15000);

  it("语法错/抛错：诚实回 ok:false（不污染主进程）", async () => {
    const bad = await runSolverSandbox("(ctx, args) => { throw new Error('boom') }", {}, {});
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/boom/);
  }, 15000);

  it("R6 字节一致：同 source+ctx+args 重跑输出全等", async () => {
    const src = "(ctx, args) => ({ r: ctx.x * args.k, label: 'fixed' })";
    const a = await runSolverSandbox(src, { x: 7 }, { k: 3 });
    const b = await runSolverSandbox(src, { x: 7 }, { k: 3 });
    expect(JSON.stringify(a.output)).toBe(JSON.stringify(b.output));
    expect(a.output).toEqual({ r: 21, label: "fixed" });
  }, 15000);
});
