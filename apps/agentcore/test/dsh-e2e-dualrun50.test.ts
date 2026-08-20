/**
 * WO-DSH-E2E · §16.2 L1 双跑字节比对（50 任务）driver。
 *
 * 对账口径单源 = fixtures/dualrun-corpus/RECONCILIATION.md（team-lead 2026-08-19 重定义：
 * scalar + kernel 唯一白名单 + native 迭代锚 + dsh stats 对齐）。骨架扩 N2
 * dsh-dualrun-reconcile.test.ts 双臂形态（蓝图 evidence 4），四断言面：
 *   A1 Answer 结构逐字节（剥 stats + provenance id/toolCallId 归一）；
 *   A2 拒绝口径（文案逐字节 + dsh wire deny 证据 + native 强制点 provId 锚）；
 *   A3 SSE 事件名序列（收缩白名单过滤后逐项等 + 差集 ⊆ ALLOWED_PSEUDO_TYPES 反咬）；
 *   A4 审计逐字段（归一化/逐值等/kernel 唯一差/native 迭代锚/dsh stats 锚）。
 * 发车哨兵（蓝图 risks #3，防 native-vs-native 假绿）：dsh 臂 stub wire 请求数 ==
 * 剧本轮数 + kernel==="EXTERNAL" + answer 含任务 marker；deny_prefork 类反向哨兵（零 spawn）。
 * A5 确定性：子集同臂连跑两遍过同一比对器。
 *
 * 环境：负载 >400 时按 env-precheck 口径 180s timeout 串行（--pool=forks --maxWorkers=1
 * --maxConcurrency=1 --testTimeout=180000）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentDefinition, AgentRunRecord, RuleVerdict, SkillDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { scanBlocks } from "../src/util/numerics.js";
import {
  STUB_DCP_SPEC,
  STUB_FAKE_KEY,
  startStubOpenAi,
  stubDirectory,
  stubProvider,
  type StubRequest,
} from "./helpers-dsh-stub.js";
import {
  A5_SUBSET,
  DUALRUN_CORPUS,
  GATED_SLOTS,
  skillIdOf,
  type DualRunTask,
} from "./fixtures/dualrun-corpus/corpus.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

// ---------------------------------------------------------------------------
// 白名单单源守卫：ALLOWED_PSEUDO_TYPES / KNOWN_EVENTS 的唯一权威在 N2 套件
// （dsh-dualrun-reconcile.test.ts，蓝图 evidence 4「单源白名单」）。本文件不重声明——
// 直接解析源文件字面量，源漂移即红（import 该测试文件会重复注册其套件，故走文本锚）。
// ---------------------------------------------------------------------------
const N2_SRC = readFileSync(fileURLToPath(new URL("./dsh-dualrun-reconcile.test.ts", import.meta.url)), "utf8");
function literalArray(name: string): string[] {
  const m = N2_SRC.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`单源守卫：${name} 在 dsh-dualrun-reconcile.test.ts 中未找到`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const ALLOWED_PSEUDO_TYPES = literalArray("ALLOWED_PSEUDO_TYPES");
const SHRUNK_PSEUDO_TYPES = ALLOWED_PSEUDO_TYPES.filter((t) => t !== "final_answer" && t !== "load_skill");
const KNOWN_EVENTS = literalArray("KNOWN_EVENTS");

// ---------------------------------------------------------------------------
// 双臂驱动
// ---------------------------------------------------------------------------

interface CapturedEvent {
  event: string;
  payload: Record<string, unknown>;
}

interface ArmProducts {
  outcome: string;
  answer: Record<string, unknown>;
  run: AgentRunRecord;
  sketch: { toolName: string; inputSummary: string }[];
  events: CapturedEvent[];
  stubRequests: StubRequest[];
}

function agentDef(task: DualRunTask): AgentDefinition {
  return {
    id: `agt_${task.id}`,
    tenantId: TENANT,
    key: `agt_${task.id}`,
    version: 1,
    name: `L1 双跑 ${task.id}`,
    description: "WO-DSH-E2E L1 dualrun50 corpus agent",
    model: STUB_DCP_SPEC, // 两臂同值：model 成真 scalar（探针 P1 坐实 roleModel 回落原值）
    systemPrompt: `你是 L1 双跑对账 agent（${task.id}）。`,
    tools: [{ kind: "BUILTIN", name: "query_objects" }],
    ruleBindings: task.ruleBindings,
    skills: task.skills.map((s) => ({ skillId: skillIdOf(task.id, s.key), version: 1 as const })),
    mcpServers: [],
    scopeDeclaration: { objectTypes: ["Base"], toolNames: ["query_objects"] },
    status: "PUBLISHED",
  };
}

function skillDef(task: DualRunTask, s: DualRunTask["skills"][number]): SkillDefinition {
  return {
    id: skillIdOf(task.id, s.key),
    tenantId: TENANT,
    key: s.key,
    version: 1,
    name: s.name,
    summary: s.summary,
    body: s.body,
    resources: [],
    status: "PUBLISHED",
    sideEffect: "READ",
    approvalGate: "none",
    provenancePolicy: "best_effort",
    references: (s.preRuleKeys ?? []).map((key) => ({
      kind: "rule" as const,
      key,
      role: "precondition" as const,
      required: true,
    })),
  } as SkillDefinition;
}

/** 规则求值逐任务编剧：pre-check（queryText 载荷）/ POST_CHECK（answerText 载荷）分流。 */
function patchRules(t: TestApp, task: DualRunTask): void {
  if (!task.native.preBlock && !task.native.postBlock) return;
  const rules = t.dataCore.rules as unknown as {
    evaluate: (c: unknown, k: unknown, p: unknown) => Promise<RuleVerdict[]>;
  };
  const orig = rules.evaluate.bind(rules);
  rules.evaluate = async (c: unknown, k: unknown, p: unknown) => {
    const payload = (p ?? {}) as Record<string, unknown>;
    if (task.native.preBlock && "queryText" in payload) return task.native.preBlock;
    if (task.native.postBlock && "answerText" in payload) return task.native.postBlock;
    return orig(c, k, p);
  };
}

async function runArm(task: DualRunTask, flag: "off" | "on"): Promise<ArmProducts> {
  const stub = flag === "on" ? await startStubOpenAi(task.dsh.rounds.map((r) => ({ ...r }))) : undefined;
  const t = await createTestApp(
    stub ? { providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never } : {},
  );
  for (const s of task.skills) await t.repos.skills.insert(skillDef(task, s));
  await t.repos.agents.insert(agentDef(task));
  patchRules(t, task);
  const events: CapturedEvent[] = [];
  const emit = async (event: string, payload: unknown) => {
    events.push({ event, payload: payload as Record<string, unknown> });
  };
  if (flag === "on") {
    process.env.DSH_HARNESS = "1";
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    if (task.dsh.govDeny) process.env.PLATFORM_GOV_DENY = task.dsh.govDeny.join(",");
  }
  try {
    if (flag === "off") t.llm.queueAgentTurn(...task.native.turns);
    const result = await t.deps.engine.runRegisteredAgent({
      taskId: `task_${task.id}`,
      agentId: `agt_${task.id}`,
      version: "latest",
      prompt: task.prompt,
      ctx,
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit,
    });
    // 镜像 orchestrator.ts:2187（G-9 逃生舱）：answer.final 整对象直发 result.answer（两臂同一行，N2 同形）。
    events.push({ event: "answer.final", payload: result.answer as Record<string, unknown> });
    return {
      outcome: result.outcome,
      answer: result.answer as Record<string, unknown>,
      run: result.run,
      sketch: result.sketch,
      events,
      stubRequests: stub?.requests ?? [],
    };
  } finally {
    delete process.env.DSH_HARNESS;
    delete process.env.DSH_HARNESS_DIR;
    delete process.env.PLATFORM_GOV_DENY;
    if (stub) await stub.close();
  }
}

// ---------------------------------------------------------------------------
// 比对器（归一化 + 声明映射 + kernel 唯一白名单）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** answer 归一：剥 dsh stats 附加键；provenance 的 id/toolCallId 归一占位（归一化集 + 声明映射集）。 */
function normalizeAnswer(a: Json): Json {
  const { stats: _drop, ...rest } = a;
  const provenance = ((rest.provenance as Json[] | undefined) ?? []).map((p) => ({
    ...p,
    id: "<prov>",
    toolCallId: "<tc>",
  }));
  return { ...rest, provenance };
}

/** run 归一：剔归一化集（id/createdAt）与分项锚定集（iterations/tokens/kernel）后比 scalar 尾。 */
function scalarTail(r: AgentRunRecord): Json {
  const {
    id: _id,
    createdAt: _ca,
    iterations: _it,
    totalInputTokens: _ti,
    totalOutputTokens: _to,
    kernel: _k,
    ...rest
  } = r as AgentRunRecord & { createdAt?: string };
  return rest as Json;
}

const seqOf = (events: readonly CapturedEvent[]): string[] =>
  events.map((e) => `${e.event}:${typeof e.payload?.type === "string" ? e.payload.type : ""}`);

const stripStats = (events: readonly CapturedEvent[]): CapturedEvent[] =>
  events.map((e) => {
    if (e.event !== "answer.final" || !("stats" in e.payload)) return e;
    const { stats: _drop, ...rest } = e.payload;
    return { event: e.event, payload: rest };
  });

const filterPseudo = (events: readonly CapturedEvent[]): CapturedEvent[] =>
  events.filter((e) => !(typeof e.payload?.type === "string" && SHRUNK_PSEUDO_TYPES.includes(e.payload.type)));

/** N2 A5 同形：多重集差（剥 stats 后、过滤前计算）。 */
function diffItems(a: readonly CapturedEvent[], b: readonly CapturedEvent[]): string[] {
  const seqA = [...seqOf(stripStats(a))];
  const seqB = [...seqOf(stripStats(b))];
  const bagB = new Map<string, number>();
  for (const s of seqB) bagB.set(s, (bagB.get(s) ?? 0) + 1);
  const onlyA: string[] = [];
  for (const s of seqA) {
    const n = bagB.get(s) ?? 0;
    if (n > 0) bagB.set(s, n - 1);
    else onlyA.push(s);
  }
  const bagA = new Map<string, number>();
  for (const s of seqA) bagA.set(s, (bagA.get(s) ?? 0) + 1);
  const onlyB: string[] = [];
  for (const s of seqB) {
    const n = bagA.get(s) ?? 0;
    if (n > 0) bagA.set(s, n - 1);
    else onlyB.push(s);
  }
  return [...onlyA, ...onlyB];
}

function checkSseFace(task: DualRunTask, x: ArmProducts, y: ArmProducts): void {
  for (const item of diffItems(x.events, y.events)) {
    const pseudoType = item.split(":")[1] ?? "";
    expect(
      ALLOWED_PSEUDO_TYPES.includes(pseudoType),
      `${task.id} 差集项 ${item} 的伪步类型必须在 ALLOWED_PSEUDO_TYPES 内（加项须评审）`,
    ).toBe(true);
  }
  expect(seqOf(filterPseudo(stripStats(x.events)))).toEqual(seqOf(filterPseudo(stripStats(y.events))));
  for (const e of [...x.events, ...y.events]) {
    expect(KNOWN_EVENTS, `${task.id} 事件名 ${e.event} 必须在 KNOWN_EVENTS 十名内`).toContain(e.event);
  }
}

function checkAuditFace(task: DualRunTask, x: ArmProducts, xKernel: string, y: ArmProducts, yKernel: string): void {
  // scalar 尾逐值等 + kernel 两臂锚定字面量（⇒ 差集恰 = {kernel}，白名单零膨胀）
  expect(scalarTail(x.run)).toEqual(scalarTail(y.run));
  expect(x.run.kernel).toBe(xKernel);
  expect(y.run.kernel).toBe(yKernel);
  // 归一化集形态锚
  expect(x.run.id).toMatch(/^run_/);
  expect(y.run.id).toMatch(/^run_/);
}

/** 单臂锚：native 迭代/token 锚 + dsh 空壳/stats 锚（RECONCILIATION §2-A4）。 */
function checkArmAnchors(task: DualRunTask, flag: "off" | "on", arm: ArmProducts): void {
  if (flag === "off") {
    expect(arm.run.totalInputTokens).toBe(task.expect.nativeTokens.input);
    expect(arm.run.totalOutputTokens).toBe(task.expect.nativeTokens.output);
    const its = arm.run.iterations;
    expect(its.length).toBe(task.expect.nativeIterations.length);
    its.forEach((it, i) => {
      const anchor = task.expect.nativeIterations[i];
      expect(it.toolCalls.length).toBe(anchor.calls.length);
      it.toolCalls.forEach((c, j) => {
        expect(c.toolName).toBe(anchor.calls[j].toolName);
        expect(c.outcome).toBe(anchor.calls[j].outcome);
        if (anchor.calls[j].input !== undefined) expect(c.input).toEqual(anchor.calls[j].input);
        expect(c.toolCallId).toMatch(/^tc_/);
        expect(c.durationMs).toBeGreaterThanOrEqual(0);
      });
    });
  } else {
    // dsh 臂审计空壳（固有不对称 #4）：iterations 恒空、tokens 恒零
    expect(arm.run.iterations).toEqual([]);
    expect(arm.run.totalInputTokens).toBe(0);
    expect(arm.run.totalOutputTokens).toBe(0);
    const anchor = task.expect.dshStats;
    const stats = (arm.answer as { stats?: { tokenUsage: Json; contextPressure?: Json; sessionStats: Json } }).stats;
    if (!anchor) {
      expect(stats, `${task.id} 零 spawn 任务不得有 stats 键`).toBeUndefined();
    } else {
      expect(stats, `${task.id} dsh 臂必带 stats（N2 M8 回声）`).toBeDefined();
      expect(stats!.tokenUsage).toEqual({
        uncachedInputTokens: anchor.uncachedInputTokens,
        outputTokens: anchor.outputTokens,
        cacheReadTokens: anchor.cacheReadTokens,
        cacheWriteTokens: anchor.cacheWriteTokens,
      });
      expect(stats!.contextPressure).toEqual({ pressureTokens: anchor.pressureTokens });
      expect(stats!.sessionStats.turns).toBe(anchor.turns);
      expect(stats!.sessionStats.steps).toBe(anchor.steps);
    }
  }
}

/** 四面对账主入口。flags 标明每臂实际身份（A5 同臂复跑也过同一比对器）。 */
function compareArms(task: DualRunTask, x: ArmProducts, y: ArmProducts, flags: { x: "off" | "on"; y: "off" | "on" }): void {
  // ---- 发车哨兵（蓝图 risks #3）：按各臂实际身份锚定 ----
  const arms = [
    { label: "x", arm: x, flag: flags.x },
    { label: "y", arm: y, flag: flags.y },
  ];
  for (const { label, arm, flag } of arms) {
    if (flag === "on") {
      if (task.expect.dshZeroSpawn) {
        expect(arm.stubRequests.length, `${task.id} 反向哨兵：分叉前预检早退 ⇒ dsh 零 spawn`).toBe(0);
      } else {
        expect(
          arm.stubRequests.length,
          `${task.id} 哨兵：dsh 臂子进程必须真走完整剧本（wire 请求数 == 剧本轮数）`,
        ).toBe(task.dsh.rounds.length);
      }
    } else {
      expect(arm.stubRequests.length, `${task.id} 哨兵：native 臂不得触 stub wire`).toBe(0);
    }
    expect(JSON.stringify(arm.answer), `${task.id} 哨兵：${label} 臂 answer 须含任务 marker`).toContain(task.id);
  }

  // ---- A1 · Answer 结构逐字节（剥 stats + provenance 归一）----
  expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(y.answer));
  expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(task.expect.answer as unknown as Json));

  // ---- A2 · 拒绝口径（deny 类）----
  for (const { arm, flag } of arms) {
    if (flag !== "on") continue;
    for (const w of task.expect.denyWire ?? []) {
      const body = JSON.stringify(arm.stubRequests[w.requestIndex]?.body ?? null);
      expect(body, `${task.id} dsh 臂治理桥 deny 证据：requests[${w.requestIndex}] 须含 deny reason`).toContain(w.reason);
    }
  }
  if (task.cls === "deny_prefork") {
    expect(JSON.stringify(x.answer)).toContain("prov_skill_rule_check");
  } else if (task.cls.startsWith("deny_")) {
    expect(JSON.stringify(x.answer)).toContain("prov_post_check");
  }

  // ---- A3 · SSE 事件名序列 ----
  checkSseFace(task, x, y);

  // ---- A4 · 审计逐字段 ----
  checkAuditFace(task, x, flags.x === "on" ? "EXTERNAL" : "NATIVE", y, flags.y === "on" ? "EXTERNAL" : "NATIVE");
  checkArmAnchors(task, flags.x, x);
  checkArmAnchors(task, flags.y, y);

  // ---- sketch / outcome parity ----
  expect(x.sketch).toEqual(y.sketch);
  expect(x.outcome).toBe(y.outcome);
}

// ---------------------------------------------------------------------------
// 套件
// ---------------------------------------------------------------------------

describe("WO-DSH-E2E · §16.2 L1 双跑字节比对（50 任务）", () => {
  it("A0 语料自检：构成 / 四维覆盖 / gated 槽在册", () => {
    expect(DUALRUN_CORPUS.length).toBe(50);
    expect(new Set(DUALRUN_CORPUS.map((t) => t.id)).size).toBe(50);
    const deny = DUALRUN_CORPUS.filter((t) => t.cls.startsWith("deny_"));
    expect(deny.length).toBeGreaterThanOrEqual(10);
    expect(deny.filter((t) => t.cls === "deny_pre").length).toBeGreaterThanOrEqual(1);
    expect(deny.filter((t) => t.cls === "deny_mid").length).toBeGreaterThanOrEqual(1);
    expect(deny.filter((t) => t.cls === "deny_all").length).toBeGreaterThanOrEqual(1);
    expect(DUALRUN_CORPUS.filter((t) => t.source === "scenario").length).toBeGreaterThanOrEqual(20);
    expect(DUALRUN_CORPUS.filter((t) => t.prompt.length >= 4096).length).toBeGreaterThanOrEqual(4);
    // 工具轮 0/1/3 + 多轮 5 往返（native turns 数 = LLM 往返数）
    const turnsOf = (t: DualRunTask) => t.native.turns.length;
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 1)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 2)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => turnsOf(t) === 5)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => t.native.turns.filter((tn) => typeof tn !== "function" && tn.content.some((b) => b.type === "tool_use" && b.name === "load_skill")).length === 3)).toBe(true);
    // provenance 形态 + 多块形态
    expect(DUALRUN_CORPUS.some((t) => (t.expect.answer.provenance?.length ?? 0) > 0)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => t.expect.answer.blocks.some((b) => b.type === "table"))).toBe(true);
    // A5 子集 ∈ 语料
    for (const id of A5_SUBSET) expect(DUALRUN_CORPUS.some((t) => t.id === id)).toBe(true);
    // 答案块经生产 scanBlocks 零裸数（unverifiedNumerics:false 锚的单源护栏）
    for (const t of DUALRUN_CORPUS) {
      expect(scanBlocks(t.expect.answer.blocks), `${t.id} 答案块含裸数，unverifiedNumerics 锚会漂`).toBe(false);
    }
    expect(GATED_SLOTS.length).toBe(2);
  });

  for (const task of DUALRUN_CORPUS) {
    it(
      `${task.id} [${task.cls}] 双臂四面对账`,
      { timeout: 180_000 },
      async () => {
        const off = await runArm(task, "off");
        const on = await runArm(task, "on");
        compareArms(task, off, on, { x: "off", y: "on" });
      },
    );
  }

  describe("A5 确定性（同臂连跑两遍，比对器不得把噪声当差集）", () => {
    for (const id of A5_SUBSET) {
      const task = DUALRUN_CORPUS.find((t) => t.id === id)!;
      it(`${id} 双臂各复跑一遍过同一比对器`, { timeout: 300_000 }, async () => {
        const off1 = await runArm(task, "off");
        const off2 = await runArm(task, "off");
        compareArms(task, off1, off2, { x: "off", y: "off" });
        const on1 = await runArm(task, "on");
        const on2 = await runArm(task, "on");
        compareArms(task, on1, on2, { x: "on", y: "on" });
      });
    }
  });

  it("gated 槽鸣报：角色路/场景路 STALL_LOOP 覆盖待 WO-degraded-seams 落线", () => {
    for (const g of GATED_SLOTS) {
      console.warn(`GATED ${g.id}（${g.path} ${g.scenario}）：${g.gate}`);
    }
    expect(GATED_SLOTS.map((g) => g.path)).toEqual(["runRolePathB", "runSceneAgent"]);
  });
});
