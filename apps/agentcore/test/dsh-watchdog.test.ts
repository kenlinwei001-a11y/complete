/**
 * WO-DSH-N3 · STALL_LOOP 看门狗：runner 级集成臂（B1-B4）+ 指纹/env 解析单元臂（D1/D2）。
 *
 * 蓝本 = /tmp/dsh-web-run/n3-plan-full.md assertions B1-B4/D1/D2。
 * 对位 native：apps/agentcore/src/agent/loop.ts:1167-1184（cumulative-per-signature 环检测
 * → degrade('BUDGET_EXHAUSTED','STALL_LOOP')）；watchdog 本体 = packages/dsh-harness/plugins/
 * platform-watchdog.mjs（scoped tools/post-execute 计数 + 两档升级 advisory/interrupt）。
 *
 * env 卫生：runner 把 process.env 原样 spread 进子进程（runner.ts:63），
 * QOS_AGENT_LOOP_REPEAT_CAP 的臂间隔离必须显式做（save/restore）。
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDshAgent, type DshSessionEvent } from "../src/dsh-runtime/index.js";

// apps/agentcore/test/ → 仓根 = ../../../
const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const INTEGRATION_TIMEOUT = 60_000;
const CAP_KEY = "QOS_AGENT_LOOP_REPEAT_CAP";

const toolCallFrames = (events: readonly DshSessionEvent[]) => events.filter((e) => e.type === "tool/call");
const turnEndFrame = (events: readonly DshSessionEvent[]) => events.find((e) => e.type === "turn/end");

describe("N3 · runner 级 stall_loop 剧本（B1-B4）", () => {
  let savedCap: string | undefined;
  beforeEach(() => {
    savedCap = process.env[CAP_KEY];
    delete process.env[CAP_KEY]; // 臂间默认禁用；要 cap 的臂走 opts.env 显式注入
  });
  afterEach(() => {
    if (savedCap === undefined) delete process.env[CAP_KEY];
    else process.env[CAP_KEY] = savedCap;
  });

  it("B1 正例：stall_loop + cap=3 → abort cause=stall-loop ∧ STALL_LOOP 降级 ∧ tool/call===3", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const run = await runDshAgent(
      { prompt: "p", provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000, env: { MOCK_SCENARIO: "stall_loop", [CAP_KEY]: "3" } },
    );
    const end = turnEndFrame(run.events);
    expect(end, "帧流缺 turn/end").toBeDefined();
    expect((end as DshSessionEvent).data, "turn/end 未落 stall-loop abort cause").toEqual({
      turn: expect.any(Number),
      reason: { kind: "aborted", reason: { kind: "stall-loop", tool: "echo_tool", count: 3, cap: 3 } },
    });
    expect(toolCallFrames(run.events), "post-execute 计数 ⇒ 第 cap 次执行后才中断，tool/call 帧应恰为 cap").toHaveLength(3);
    expect(run.result.ok).toBe(true);
    if (run.result.ok) {
      expect(run.result.outcome).toBe("BUDGET_EXHAUSTED");
      expect(run.result.degraded).toEqual({ reason: "STALL_LOOP" });
    }
  });

  it("B2 异参对照（不误伤）：stall_loop_varying + cap=3 → 无 stall-loop ∧ ANSWERED ∧ tool/call===8", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const run = await runDshAgent(
      { prompt: "p", provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000, env: { MOCK_SCENARIO: "stall_loop_varying", [CAP_KEY]: "3" } },
    );
    const end = turnEndFrame(run.events);
    expect(JSON.stringify(end?.data), "异参各自独立计数（对位 loop.ts:1154-1155），不得出现 stall-loop").not.toContain("stall-loop");
    expect(toolCallFrames(run.events)).toHaveLength(8);
    expect(run.result.ok).toBe(true);
    if (run.result.ok) {
      expect(run.result.outcome).toBe("ANSWERED");
      expect(run.result.degraded).toBeUndefined();
    }
  });

  it("B3 自定义 cap=4（≠缺省 3）：cause.cap===4 ∧ tool/call===4 —— cap 由 env 驱动非硬编码", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const run = await runDshAgent(
      { prompt: "p", provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000, env: { MOCK_SCENARIO: "stall_loop", [CAP_KEY]: "4" } },
    );
    const end = turnEndFrame(run.events);
    const cause = (end?.data as { reason?: { reason?: { cap?: unknown } } } | undefined)?.reason?.reason;
    expect(cause?.cap, "中断点必须跟随 env 注入的 cap=4").toBe(4);
    expect(toolCallFrames(run.events)).toHaveLength(4);
    expect(run.result.ok).toBe(true);
    if (run.result.ok) expect(run.result.degraded).toEqual({ reason: "STALL_LOOP" });
  });

  it("B4 无 cap env → 无 stall-loop ∧ tool/call===8 ∧ ANSWERED（opt-in 缺省禁用，对位 loop.ts:533）", { timeout: INTEGRATION_TIMEOUT }, async () => {
    const run = await runDshAgent(
      { prompt: "p", provider: "mock", model: "mock" },
      { harnessDir: HARNESS_DIR, requestTimeoutMs: 30_000, env: { MOCK_SCENARIO: "stall_loop" } },
    );
    const end = turnEndFrame(run.events);
    expect(JSON.stringify(end?.data)).not.toContain("stall-loop");
    expect(toolCallFrames(run.events)).toHaveLength(8);
    expect(run.result.ok).toBe(true);
    if (run.result.ok) {
      expect(run.result.outcome).toBe("ANSWERED");
      expect(run.result.degraded).toBeUndefined();
    }
  });
});

describe("N3 · D1 canonicalize 夹具（对位 stock 语义）", () => {
  // stock 指纹算法出处：dsh-repeat-tool-reminder/lib/index.js:207-220（模块私有不导出 :323，
  // 我方 platform-watchdog.mjs 逐字复刻并导出供本夹具对拍）。
  it("键序打乱/嵌套对象/数组入参 → 同一 canonical 串；实差异 → 不同串", async () => {
    const { canonicalize } = (await import("../../../packages/dsh-harness/plugins/platform-watchdog.mjs")) as {
      canonicalize: (v: unknown) => string;
    };
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 }, arr: [{ y: 1, x: 2 }, [3, 4]] });
    const b = canonicalize({ arr: [{ x: 2, y: 1 }, [3, 4]], a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b); // 深键序递归排序 ⇒ 仅键序差异 canonical 相同
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 }, arr: [[4, 3], { x: 2, y: 1 }] })).not.toBe(a); // 数组保序 ⇒ 序异即异
    expect(canonicalize({ b: 2, a: { d: 2, c: 3 }, arr: [{ y: 1, x: 2 }, [3, 4]] })).not.toBe(a); // 值异即异
    expect(canonicalize('{"raw":1}')).toBe(canonicalize('{"raw":1}')); // 字符串入参（未解析兜底）直通
  });
});

describe("N3 · D2 cap 解析（opt-in，对位 loop.ts:533）", () => {
  it("'3'→启用 cap=3；'0'/缺失/'abc'/'3.5'→禁用", async () => {
    const { parseLoopRepeatCap } = (await import("../../../packages/dsh-harness/plugins/platform-watchdog.mjs")) as {
      parseLoopRepeatCap: (raw: string | undefined) => number | undefined;
    };
    expect(parseLoopRepeatCap("3")).toBe(3);
    expect(parseLoopRepeatCap("1")).toBe(1);
    expect(parseLoopRepeatCap("0")).toBeUndefined();
    expect(parseLoopRepeatCap("-2")).toBeUndefined();
    expect(parseLoopRepeatCap(undefined)).toBeUndefined();
    expect(parseLoopRepeatCap("abc")).toBeUndefined();
    expect(parseLoopRepeatCap("3.5")).toBeUndefined();
  });
});
