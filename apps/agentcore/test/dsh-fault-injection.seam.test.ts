/**
 * WO-DSH-PROD-READY · W4 故障注入 + 多租户并发形态核验。
 *
 * 命题：DSH 分叉 = JSON-RPC 子进程（packages/dsh-harness，runner.ts spawn）。生产可接要求回答：
 * 子进程 crash / hang / zombie 时 engine 侧行为是什么？多租户并发时进程池形态是什么？资源有界吗？
 *
 * 方法（断言先行）：每个故障形态先钉「期望的诚实行为」——红了归因（缺口报 main 裁决），
 * 绿了钉板 + mutation 反证。故障注入缝 = 剧本化假 harness（helpers-dsh-fault-harness.ts：
 * runner.ts:68 的 spawn 路径形 `<harnessDir>/node_modules/.../bin.js` 物化在 tmp 目录），
 * 真 harness 一行不动。已覆盖不重复造：dsh-degraded-seams（STALL_LOOP 双路帧序）。
 *
 * 形态矩阵：
 *   F1  启动即死·缺 cordis 档（engine 级）⇒ 诚实抛错（不是挂起、不是静默空答案）
 *   F2  启动即崩·bin 即死（engine 级）⇒ TransportClosedError 带 exit code + stderr tail，有界时延，零残留
 *   F3  中途崩（runner 级）⇒ 有界收束 + outcome FAILED + 半截文本不冒充分段答案；现状事实：收束时延 = 满 requestTimeoutMs
 *   F4  hang（runner 级 ×2）⇒ ①prompt 后哑：deadline 收束 outcome FAILED 诚实空答；②全哑：RequestTimeoutError
 *   F5  zombie 回收（runner 级）⇒ 健康×5 + 中途崩 + SIGTERM 抵抗各跑一遍，pgrep 计数恒 0（SIGKILL 梯队实证）
 *   F6  多租户并发（engine 级）⇒ 两 tenant kernel=EXTERNAL 并发：各自独立子进程、setup 帧 tenantId 各自正确、互不串话
 *   F7  资源形态（runner 级）⇒ 并发×4 各起各的进程（钉「每 run 一进程、无池化上限」现状事实）
 *   F8  编排级失败面（HTTP 级）⇒ 启动即崩 ⇒ task FAILED + 错误信息含子进程诊断（生产形态端到端）
 *
 * env 卫生：FAULT_MODE/FAULT_RECORD/DSH_HARNESS_DIR/DSH_HARNESS 显式 save/restore（形态复刻
 * dsh-degraded-seams.test.ts :182-192）。
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { runDshAgent } from "../src/dsh-runtime/index.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  stubDirectory,
  stubProvider,
} from "./helpers-dsh-stub.js";
import {
  materializeEmptyHarnessDir,
  materializeFaultHarness,
  readFaultRecords,
  type FaultMode,
} from "./helpers-dsh-fault-harness.js";

const execFileAsync = promisify(execFile);

const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO", "FAULT_MODE", "FAULT_RECORD"] as const;

/** engine 级分叉前置：resolveConnectionFacts 走 dcp 绑定矩阵 stub（假 harness 不打电话，URL 不会被真连）。 */
const DIRECTORY = stubDirectory(stubProvider("http://127.0.0.1:9/v1"), STUB_FAKE_KEY) as never;

/** kernel=EXTERNAL 场景 agent（分叉走 agent.kernel 显式值，不碰进程 env DSH_HARNESS——臂间零污染）。 */
function externalAgent(id: string, tenantId: string): AgentDefinition {
  return {
    tenantId,
    id,
    key: id,
    version: 1,
    name: id,
    description: "W4 故障注入 kernel=EXTERNAL agent",
    model: STUB_DCP_SPEC,
    systemPrompt: "你是 W4 故障注入测试 agent。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
    kernel: "EXTERNAL",
  };
}

/** engine 级直调 runRegisteredAgent（形态复刻 agent-run-attribution.seam :294-307）。 */
function runEngineOnce(t: TestApp, agentId: string, taskId: string, tenantId: string, prompt: string) {
  return t.deps.engine.runRegisteredAgent({
    taskId,
    agentId,
    version: "latest",
    prompt,
    ctx: { tenantId, userId: "user-w4", roles: ["planner"] },
    nesting: {
      callChain: [],
      budget: new BudgetTracker(computeResidualBudget(loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv))),
    },
    emit: async () => {},
  });
}

/** zombie 计数：pgrep -f 以 binPath（tmp 全机唯一）为模式；无匹配 pgrep rc=1 ⇒ 0。 */
async function countHarnessProcesses(binPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", binPath]);
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function setFaultEnv(harnessDir: string, mode: FaultMode, recordFile?: string): void {
  process.env.DSH_HARNESS_DIR = harnessDir;
  process.env.FAULT_MODE = mode;
  if (recordFile) process.env.FAULT_RECORD = recordFile;
  else delete process.env.FAULT_RECORD;
}

describe("WO-DSH-PROD-READY W4 · DSH 故障注入 + 多租户并发形态", () => {
  let savedEnv: Record<string, string | undefined>;
  let harness: ReturnType<typeof materializeFaultHarness>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // kernel=EXTERNAL 显式驱动，env 全局开关保持关
    harness = materializeFaultHarness();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(harness.dir, { recursive: true, force: true });
  });

  it("F1 启动即死·缺 cordis 档（engine 级）⇒ 诚实抛错指名缺档，不挂起不静默", { timeout: 30_000 }, async () => {
    const emptyDir = materializeEmptyHarnessDir();
    setFaultEnv(emptyDir, "healthy");
    const t = await createTestApp({ providerDirectory: DIRECTORY });
    try {
      await t.repos.agents.insert(externalAgent("agt_w4_f1", TENANT));
      const started = Date.now();
      const err = await runEngineOnce(t, "agt_w4_f1", "task-w4-f1", TENANT, "缺档故障注入").then(
        () => { throw new Error("预期抛错却返回了结果（静默吞故障）"); },
        (e: unknown) => e,
      );
      expect(Date.now() - started, "缺档应即抛（spawn 前存在性探针），不得拖到超时").toBeLessThan(10_000);
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message), "错误必须诚实指名缺的档，不许包成空答案").toContain("cordis.yml not found");
    } finally {
      await t.app.close();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("F2 启动即崩·bin 即死（engine 级）⇒ TransportClosedError 带 exit code + stderr tail，零残留", { timeout: 30_000 }, async () => {
    setFaultEnv(harness.dir, "startup-crash");
    const t = await createTestApp({ providerDirectory: DIRECTORY });
    try {
      await t.repos.agents.insert(externalAgent("agt_w4_f2", TENANT));
      const started = Date.now();
      const err = await runEngineOnce(t, "agt_w4_f2", "task-w4-f2", TENANT, "启动崩故障注入").then(
        () => { throw new Error("预期抛错却返回了结果（静默吞故障）"); },
        (e: unknown) => e,
      );
      expect(Date.now() - started, "子进程即死应即抛（exit 边触发），不得拖到超时").toBeLessThan(15_000);
      expect(err).toBeInstanceOf(Error);
      const msg = String((err as Error).message);
      expect(msg, "诚实错误面：带 exit code（子进程死因可诊断，不是裸 'error'）").toContain("exit code: 1");
      expect(msg, "诚实错误面：带 stderr 诊断尾").toContain("deliberate startup crash");
      expect(await countHarnessProcesses(harness.binPath), "启动崩后不得有残留子进程").toBe(0);
    } finally {
      await t.app.close();
    }
  });

  it("F3 中途崩（runner 级）⇒ 有界收束 + outcome FAILED + 半截文本兜底不编造", { timeout: 30_000 }, async () => {
    setFaultEnv(harness.dir, "mid-crash");
    const started = Date.now();
    const out = await runDshAgent(
      { prompt: "中途崩故障注入", provider: "stub", model: "stub" },
      { harnessDir: harness.dir, requestTimeoutMs: 2_000 },
    );
    const elapsed = Date.now() - started;
    expect(out.result.ok, "中途崩不构成重组装拒绝（帧流自洽，只是没等到 turn/end）").toBe(true);
    if (out.result.ok) {
      expect(out.result.outcome, "无 turn/end ⇒ 诚实 FAILED（reassemble :356 三分支缺省档）").toBe("FAILED");
      const md = out.result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      expect(md, "半截 assistant 文本如实兜底（软收尾语义），不编造最终结论").toContain("崩溃前的半截回答");
      expect(out.result.answer.provenance, "无 final_answer ⇒ provenance 空 = 诚实不造溯源").toHaveLength(0);
    }
    expect(elapsed, "收束必须有上界（现状：等满 requestTimeoutMs——慢失败事实钉板）").toBeLessThan(10_000);
    expect(await countHarnessProcesses(harness.binPath), "中途崩后不得有残留子进程").toBe(0);
  });

  it("F4① hang·prompt 后哑（runner 级）⇒ deadline 有界收束 + FAILED + 诚实空答文本", { timeout: 30_000 }, async () => {
    setFaultEnv(harness.dir, "hang");
    const started = Date.now();
    const out = await runDshAgent(
      { prompt: "hang 故障注入", provider: "stub", model: "stub" },
      { harnessDir: harness.dir, requestTimeoutMs: 2_000 },
    );
    const elapsed = Date.now() - started;
    expect(elapsed, "hang 有超时上界：requestTimeoutMs 兜底（runner :101-104 deadline 轮询）").toBeLessThan(10_000);
    expect(elapsed, "deadline 确实走到了（≥ 注入的 2s——证明收束靠 deadline 而非碰巧）").toBeGreaterThanOrEqual(1_800);
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      expect(out.result.outcome, "hang 死等不到 turn/end ⇒ 诚实 FAILED 而非冒名 ANSWERED").toBe("FAILED");
      const md = out.result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      expect(md, "零文本帧 ⇒ 诚实空答兜底文本，不静默产出空字符串答案").toContain("（探索模式未能产出回答）");
    }
    expect(await countHarnessProcesses(harness.binPath), "hang 收束后子进程必须被回收（close 梯队）").toBe(0);
  });

  it("F4② hang·全哑（runner 级）⇒ initialize 超时 RequestTimeoutError 诚实上抛", { timeout: 30_000 }, async () => {
    setFaultEnv(harness.dir, "deaf");
    const started = Date.now();
    const err = await runDshAgent(
      { prompt: "全哑故障注入", provider: "stub", model: "stub" },
      { harnessDir: harness.dir, requestTimeoutMs: 2_000 },
    ).then(
      () => { throw new Error("全哑预期超时抛错却返回了结果"); },
      (e: unknown) => e,
    );
    expect(Date.now() - started, "initialize 期 hang 同样有上界（request 级 timeout）").toBeLessThan(10_000);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name, "全哑 ⇒ 请求超时错误（可分类，不是裸挂起）").toBe("RequestTimeoutError");
    expect(String((err as Error).message)).toContain("initialize");
    expect(await countHarnessProcesses(harness.binPath), "全哑收束后不得有残留子进程").toBe(0);
  });

  it("F5 zombie 回收（runner 级）⇒ 健康×5 + 中途崩 + SIGTERM 抵抗，pgrep 计数恒 0", { timeout: 60_000 }, async () => {
    expect(await countHarnessProcesses(harness.binPath), "前置：夹具目录唯一，基线计数 0").toBe(0);
    // 健康×5 连跑：每次 close 的 EOF→exit 常规档回收。
    setFaultEnv(harness.dir, "healthy");
    for (let i = 0; i < 5; i++) {
      const out = await runDshAgent(
        { prompt: `zombie 连跑 ${i}`, provider: "stub", model: "stub" },
        { harnessDir: harness.dir, requestTimeoutMs: 10_000 },
      );
      expect(out.result.ok).toBe(true);
    }
    expect(await countHarnessProcesses(harness.binPath), "健康×5 后零残留").toBe(0);
    // 中途崩：子进程自己死了，close 梯队对 exitCode 非 null 直接短路（dispose :90），父侧不得留痕。
    setFaultEnv(harness.dir, "mid-crash");
    await runDshAgent(
      { prompt: "zombie 崩臂", provider: "stub", model: "stub" },
      { harnessDir: harness.dir, requestTimeoutMs: 1_500 },
    );
    expect(await countHarnessProcesses(harness.binPath), "中途崩后零残留").toBe(0);
    // SIGTERM 抵抗：拒绝 shutdown 响应 + 无视 stdin EOF + 无视 SIGTERM ⇒ 梯队必须走到 SIGKILL 仍收束。
    setFaultEnv(harness.dir, "stubborn");
    const out = await runDshAgent(
      { prompt: "zombie 顽固臂", provider: "stub", model: "stub" },
      { harnessDir: harness.dir, requestTimeoutMs: 30_000 },
    );
    expect(out.result.ok, "顽固子进程的正常 run 本身应完成（turn/end 已发）").toBe(true);
    expect(await countHarnessProcesses(harness.binPath), "SIGTERM 抵抗者必须被 SIGKILL 梯队收尸").toBe(0);
  });

  it("F6 多租户并发（engine 级）⇒ 独立子进程 × setup 帧 tenantId 各自正确 × 互不串话", { timeout: 60_000 }, async () => {
    const recordFile = join(mkdtempSync(join(tmpdir(), "dsh-w4-record-")), "records.jsonl");
    setFaultEnv(harness.dir, "healthy", recordFile);
    const t = await createTestApp({ providerDirectory: DIRECTORY });
    try {
      await t.repos.agents.insert(externalAgent("agt_w4_alpha", "t_alpha"));
      await t.repos.agents.insert(externalAgent("agt_w4_beta", "t_beta"));
      const [resA, resB] = await Promise.all([
        runEngineOnce(t, "agt_w4_alpha", "task-w4-alpha", "t_alpha", "alpha 租户的问题"),
        runEngineOnce(t, "agt_w4_beta", "task-w4-beta", "t_beta", "beta 租户的问题"),
      ]);
      expect(resA.outcome, "alpha run 应正常作答").toBe("ANSWERED");
      expect(resB.outcome, "beta run 应正常作答").toBe("ANSWERED");
      const mdA = resA.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      const mdB = resB.answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      expect(mdA, "alpha 的答案必须出自 alpha 的 prompt（回声对位）").toContain("alpha 租户的问题");
      expect(mdB, "beta 的答案必须出自 beta 的 prompt").toContain("beta 租户的问题");
      expect(mdA, "互不串话：alpha 答案不得含 beta 的 prompt").not.toContain("beta 租户的问题");
      expect(mdB, "互不串话：beta 答案不得含 alpha 的 prompt").not.toContain("alpha 租户的问题");

      const records = readFaultRecords(recordFile);
      const prompts = records.filter((r) => r.method === "session/prompt");
      expect(prompts, "两个 tenant 各一条 session/prompt 记录").toHaveLength(2);
      const pids = new Set(prompts.map((r) => r.pid));
      expect(pids.size, "每 run 独立子进程（两 pid 相异 = 无共享运行时）").toBe(2);
      // engine 会在 prompt 外加脚手架，故按 contains 对位而非全串相等。
      const recA = prompts.find((r) => (r.prompt ?? "").includes("alpha 租户的问题"));
      const recB = prompts.find((r) => (r.prompt ?? "").includes("beta 租户的问题"));
      expect(recA, "alpha 的 prompt 必须到达了某个子进程").toBeDefined();
      expect(recB, "beta 的 prompt 必须到达了某个子进程").toBeDefined();
      expect(recA!.tenantId, "setup 帧 tenantId 对位 mcp-client-tenant 池键语义（setup-spec :238）").toBe("t_alpha");
      expect(recB!.tenantId, "setup 帧 tenantId 各自正确").toBe("t_beta");
      expect(await countHarnessProcesses(harness.binPath), "并发双臂收束后零残留").toBe(0);
    } finally {
      await t.app.close();
      rmSync(join(recordFile, ".."), { recursive: true, force: true });
    }
  });

  it("F7 资源形态（runner 级）⇒ 并发×4 各自独立子进程同时在跑（每 run 一进程·无池化上限 钉板）", { timeout: 60_000 }, async () => {
    const recordFile = join(mkdtempSync(join(tmpdir(), "dsh-w4-record-")), "records.jsonl");
    setFaultEnv(harness.dir, "healthy-slow", recordFile);
    const runs = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        runDshAgent(
          { prompt: `并发形态 ${i}`, provider: "stub", model: "stub" },
          { harnessDir: harness.dir, requestTimeoutMs: 15_000 },
        ),
      ),
    );
    for (const out of runs) expect(out.result.ok).toBe(true);
    const prompts = readFaultRecords(recordFile).filter((r) => r.method === "session/prompt");
    expect(prompts, "四条 session/prompt 记录").toHaveLength(4);
    // healthy-slow 的 400ms 事件窗口 ⊂ 全部 run 的生命周期 ⇒ 四进程真同时在跑（非串行复用）。
    expect(new Set(prompts.map((r) => r.pid)).size, "并发 4 run ⇒ 4 个相异 pid（无池化、每 run 一进程的现状事实）").toBe(4);
    expect(await countHarnessProcesses(harness.binPath), "并发收束后零残留").toBe(0);
    rmSync(join(recordFile, ".."), { recursive: true, force: true });
  });

  it("F8 编排级失败面（HTTP 级）⇒ 启动即崩 ⇒ task FAILED + 错误含子进程诊断（非挂起非空答案）", { timeout: 60_000 }, async () => {
    setFaultEnv(harness.dir, "startup-crash");
    const t = await createTestApp({ providerDirectory: DIRECTORY });
    try {
      await t.repos.agents.insert(externalAgent("agt_w4_f8", TENANT));
      await t.repos.sceneEntries.upsert({
        id: "scn_w4_fault",
        tenantId: TENANT,
        viewKey: "w4_fault_scene",
        mode: "AGENT_FIRST",
        defaultAgentId: "agt_w4_f8",
        uiHints: { placeholder: "随便问", suggestedQuestions: [] },
      });
      const { taskId } = await submitQuery(t, PLANNER, "随便问点什么", { view: "w4_fault_scene" });
      const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status), 30_000);
      expect(task.status, "子进程启动即崩 ⇒ 任务必须诚实 FAILED（编排层 failFromError 兜住）").toBe("FAILED");
      const taskError = (task as { error?: { code?: string; message?: string } }).error;
      expect(taskError?.message, "task.error 必须留住子进程原始死因（#109 诚实终态：系统知道真因就必须说）").toContain("exit code: 1");
      // CL.7 GF.2：AGENT 路失败落 gap 块答案（诚实暴露断点），不是一片空白。
      const blocks = (task.answer?.blocks ?? []) as { type?: string }[];
      expect(blocks.length, "FAILED 但留有用户看得懂的诚实答案面（gap 块/错误叙述），非空白").toBeGreaterThan(0);
      expect(await countHarnessProcesses(harness.binPath), "编排级失败后零残留").toBe(0);
    } finally {
      await t.app.close();
    }
  });
});
