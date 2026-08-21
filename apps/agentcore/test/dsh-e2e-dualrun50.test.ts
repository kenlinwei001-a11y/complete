/**
 * WO-DSH-E2E · §16.2 L1 双跑字节比对（63 任务）driver。
 *
 * 对账口径单源 = fixtures/dualrun-corpus/RECONCILIATION.md（team-lead 2026-08-19 重定义：
 * scalar + kernel 唯一白名单 + native 迭代锚 + dsh stats 对齐）。骨架扩 N2
 * dsh-dualrun-reconcile.test.ts 双臂形态（蓝图 evidence 4），四断言面：
 *   A1 Answer 结构逐字节（剥 stats + provenance id/toolCallId 归一）；
 *   A2 拒绝口径（文案逐字节 + dsh wire deny 证据 + native 强制点 provId 锚）；
 *   A3 SSE 事件名序列（收缩白名单过滤后逐项等 + 差集 ⊆ ALLOWED_PSEUDO_TYPES 反咬）；
 *   A4 审计逐字段（归一化/逐值等/kernel 唯一差/native 迭代锚/dsh stats 锚）。
 * 发车哨兵（蓝图 risks #3，防 native-vs-native 假绿）：dsh 臂 stub wire 请求数 ==
 * 剧本轮数 + kernel==="EXTERNAL" + answer 含任务 marker；deny_prefork 类反向哨兵（零 spawn）；
 * EMPTY 空块类 marker 哨兵条件豁免（markerSentinelExempt 谓词 + wire 首请求替代锚，A0 双恰护栏）。
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
  // ⚠ `m` 与 `m[1]` 要分开判：正则整体没命中 ⇒ 源文件里根本没这个常量（单源守卫该报的那件事）；
  //    命中而捕获组为空 ⇒ 正则写错了。两者处置方向不同，合成一句会把「工具坏了」读成「源没这个符号」。
  if (!m) throw new Error(`单源守卫：${name} 在 dsh-dualrun-reconcile.test.ts 中未找到`);
  const body = m[1];
  if (body === undefined) throw new Error(`单源守卫：${name} 命中但捕获组为空 —— 是这里的正则坏了，不是源缺符号`);
  const out = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((v): v is string => v !== undefined);
  // 金丝雀：单源白名单不可能是空的。抽出 0 条 ⇒ 报「工具坏了」，不许静默返回 []
  // （那会让下游所有基于该白名单的断言变成恒真）。
  if (out.length === 0) throw new Error(`单源守卫：${name} 抽出 0 条 ⇒ 抽取器坏了，不是白名单空了`);
  return out;
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
  /** G2：result.structured 捕获（expectsSchema 任务的双臂对账面；非结构化任务两臂同 undefined）。 */
  structured?: unknown;
  /** G3：result.degraded 捕获（length 截断任务的分锚面；先补观测面再断言，同 structured 纪律）。 */
  degraded?: { reason: string };
  run: AgentRunRecord;
  sketch: { toolName: string; inputSummary: string }[];
  events: CapturedEvent[];
  stubRequests: StubRequest[];
  /**
   * W5 块3（A4b）：本臂运行落库的 toolCalls 审计行（repos.toolCalls.listByTask 原样快照，
   * 仅取对账字段）。native 臂 load_skill 每轮一行（loop.ts:731）；dsh 臂恒零行
   * （reassemble 纯重组装零 IO——固有不对称 #4 的审计空壳维度，本面把它从「登记」升级为「锚」）。
   */
  auditRows: { toolName: string; outcome: string; input: unknown }[];
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
    // W5 块2：治理位从语料声明取（缺省 = 既有硬编码，旧 59 条零漂移；dr50-cj 置 WRITE ⇒ writeMode 通道开）。
    sideEffect: s.sideEffect ?? "READ",
    approvalGate: s.approvalGate ?? "none",
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
    // F-1：dsh 臂钉 poc 档（生产档治理已切 http；govDeny 语料依赖 mock 模式 PLATFORM_GOV_DENY）。
    stub ? { providerDirectory: stubDirectory(stubProvider(`${stub.url}/v1`), STUB_FAKE_KEY) as never, env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" } } : {},
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
      // G2：expectsSchema 透传（engine.ts:225 opts 字段，两臂接线俱在：:605 setup/:620 reassemble/:695 loop）
      ...(task.expectsSchema ? { expectsSchema: task.expectsSchema } : {}),
    });
    // 镜像 orchestrator.ts:2187（G-9 逃生舱）：answer.final 整对象直发 result.answer（两臂同一行，N2 同形）。
    events.push({ event: "answer.final", payload: result.answer as Record<string, unknown> });
    // W5 块3（A4b）：审计行快照在臂内完成（repos 随 TestApp 存活；行序 = listByTask 的 createdAt 序，
    // 同毫秒并列时 V8 稳定排序保插入序——语料逐轮串行插入，次序即剧本序）。
    const auditRows = (await t.repos.toolCalls.listByTask(`task_${task.id}`)).map((r) => ({
      toolName: r.toolName,
      outcome: r.outcome,
      input: r.input,
    }));
    return {
      outcome: result.outcome,
      answer: result.answer as Record<string, unknown>,
      structured: (result as { structured?: unknown }).structured,
      degraded: (result as { degraded?: { reason: string } }).degraded,
      run: result.run,
      sketch: result.sketch,
      events,
      stubRequests: stub?.requests ?? [],
      auditRows,
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

function checkAuditFace(task: DualRunTask, x: ArmProducts, y: ArmProducts, flags: { x: "off" | "on"; y: "off" | "on" }): void {
  const div = task.expect.lengthDivergence;
  if (div) {
    // G3 分锚（RECONCILIATION §2 A4 分锚行 + §3 #9；team-lead 2026-08-21 裁决）：
    // budgetExhausted 两臂不互比、各锚各的声明值（先例 = A4 token 账两臂分锚）——
    // 从 scalar 尾剔出后逐臂锚定，其余 scalar 尾照常逐值等；全局断言对非 div 任务零放宽。
    const { budgetExhausted: _xb, ...xTail } = scalarTail(x.run);
    const { budgetExhausted: _yb, ...yTail } = scalarTail(y.run);
    expect(xTail).toEqual(yTail);
    // native 臂锚 = false（loop.ts:1027 软收尾不走 finishRun(true)）；dsh 臂锚 = 语料声明 true。
    expect(x.run.budgetExhausted, `${task.id} budgetExhausted 分锚（x 臂）`).toBe(flags.x === "on" ? div.dsh.budgetExhausted : false);
    expect(y.run.budgetExhausted, `${task.id} budgetExhausted 分锚（y 臂）`).toBe(flags.y === "on" ? div.dsh.budgetExhausted : false);
  } else {
    // scalar 尾逐值等 + kernel 两臂锚定字面量（⇒ 差集恰 = {kernel}，白名单零膨胀）
    expect(scalarTail(x.run)).toEqual(scalarTail(y.run));
  }
  expect(x.run.kernel).toBe(flags.x === "on" ? "EXTERNAL" : "NATIVE");
  expect(y.run.kernel).toBe(flags.y === "on" ? "EXTERNAL" : "NATIVE");
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
      // ⚠ 显式断言锚点存在，不用 `!` 抹掉 —— 上一行刚断言过 `its.length === nativeIterations.length`，
      //    但那是**另一个**命题：长度相等不保证逐个下标取得到（数组可含空洞）。
      //    锚点缺失时这里必须**当场红并指出是第几轮**，而不是在下一行报一个看不懂的 undefined。
      expect(anchor, `第 ${i} 轮缺锚点（nativeIterations 长度对得上但取不到该下标）`).toBeDefined();
      if (!anchor) return;
      expect(it.toolCalls.length).toBe(anchor.calls.length);
      it.toolCalls.forEach((c, j) => {
        const ec = anchor.calls[j];
        expect(ec, `第 ${i} 轮第 ${j} 个工具调用缺锚点`).toBeDefined();
        if (!ec) return;
        expect(c.toolName).toBe(ec.toolName);
        expect(c.outcome).toBe(ec.outcome);
        if (ec.input !== undefined) expect(c.input).toEqual(ec.input);
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

/**
 * EMPTY 空块类豁免谓词（发车哨兵第 3 条「answer 含任务 marker」的唯一条件位）。
 *
 * 为何豁免是安全的——哨兵本意是防「压根没发车」（蓝图 risks #3：native-vs-native 假绿），
 * 不是防「答案为空」。空答案 ≠ 没发车：EMPTY 类（blocks:[] / 空 markdown / 空白软收尾）
 * 的答案结构上不可能携带 marker，强留哨兵等于判这类任务死刑。豁免后发车事实由以下
 * 互补证据链锁定（缺一即红，不比 marker 哨兵弱）：
 *   dsh 臂  ① stub.requests.length === 剧本轮数（HTTP wire 实证子进程真 spawn 真走完）；
 *           ② run.kernel === "EXTERNAL"（engine 分叉真返回，A4 锚定字面量）；
 *           ③ answer.stats.sessionStats.turns/steps 锚（A4 stats 对齐，证明 harness 真跑了轮次）；
 *           ④ wire 首请求体含本任务 id（豁免任务的 prompt 必含 id——A0 闸强制，
 *              证明子进程消费的是**本任务**输入而非旁路，顶替 marker 的「剧本身份」职能）。
 *   native 臂 ⑤ token 锚 100/50 × 轮数（ScriptedLlmClient 只有真消费剧本才记账）+
 *             迭代锚逐轮对点。
 * 双恰护栏（A0 闸）：「豁免位置位 ⇔ expect.answer 序列化后确无本任务 id」——
 * 给有 marker 的任务误置豁免位会红（谓词第二析取不成立 ⇒ 哨兵照常跑），
 * 给纯空答案漏置豁免位也会红（哨兵必败）。豁免面被锁死在 EMPTY 类，不可外溢。
 */
const markerSentinelExempt = (task: DualRunTask): boolean =>
  task.expect.skipMarkerSentinel === true && !JSON.stringify(task.expect.answer).includes(task.id);

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
    if (markerSentinelExempt(task)) {
      // EMPTY 类：marker 哨兵豁免（安全性论证见 markerSentinelExempt 注释），
      // dsh 臂改锚 wire 级替代证据——首请求体必含本任务 id（剧本身份顶替位）。
      if (flag === "on") {
        expect(
          JSON.stringify(arm.stubRequests[0]?.body ?? null),
          `${task.id} 豁免位替代哨兵：dsh wire 首请求体须含本任务 id（prompt 锚定剧本身份）`,
        ).toContain(task.id);
      }
    } else {
      expect(JSON.stringify(arm.answer), `${task.id} 哨兵：${label} 臂 answer 须含任务 marker`).toContain(task.id);
    }
  }

  // ---- A1 · Answer 结构逐字节（剥 stats + provenance 归一）----
  const div = task.expect.lengthDivergence;
  if (div) {
    // G3 分锚（§3 #9 设计取向差）：两臂各锚各的声明产物，不互比——
    // native 臂锚 = expect.answer 本位（软收尾原文）；dsh 臂锚 = div.dsh.answer（摘要头 + 截断前文）。
    // A5 同臂复跑两臂同 flag ⇒ 锚同一份，比对器噪声检查不受影响。
    expect(normalizeAnswer(x.answer), `${task.id} A1 分锚（x 臂）`).toEqual(
      normalizeAnswer((flags.x === "on" ? div.dsh.answer : task.expect.answer) as unknown as Json),
    );
    expect(normalizeAnswer(y.answer), `${task.id} A1 分锚（y 臂）`).toEqual(
      normalizeAnswer((flags.y === "on" ? div.dsh.answer : task.expect.answer) as unknown as Json),
    );
  } else {
    expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(y.answer));
    expect(normalizeAnswer(x.answer)).toEqual(normalizeAnswer(task.expect.answer as unknown as Json));
  }

  // ---- A1b · structured 深等（G2 expectsSchema 任务对账面；非结构化任务两臂同 undefined 也逐值咬）----
  expect(x.structured, `${task.id} structured 双臂深等`).toEqual(y.structured);
  if (task.expect.structured !== undefined) {
    expect(x.structured, `${task.id} structured 须等于语料声明锚`).toEqual(task.expect.structured);
  }

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
  checkAuditFace(task, x, y, flags);
  checkArmAnchors(task, flags.x, x);
  checkArmAnchors(task, flags.y, y);

  // ---- A4b · audit 写入不变量（W5 块3：audit 写入不因内核选择而**隐性**分裂）----
  // 锚定形态（双向防漂）：
  //   native 臂 = 剧本里每个 load_skill tool_use 一行审计（toolName/outcome/input 逐点）；
  //   dsh 臂   = 恒零行（reassemble 零 IO，固有不对称 #4 的审计空壳维度——登记差异被锚成字面量，
  //              dsh 侧哪天开始写审计 = 未登记的语义变更 ⇒ 红；native 侧哪天丢行 = 审计丢失 ⇒ 红）；
  //   deny_prefork = 两臂恒零行（分叉前预检拒止 ⇒ 零执行痕迹——entitlement/治理拒止时点
  //              跨核一致的强形态：拒止早于一切可观测执行，kernel 选择不改变拒止时点）。
  {
    const expectedLoadSkillCalls: unknown[] = [];
    for (const turn of task.native.turns) {
      if (typeof turn !== "object" || !("content" in turn)) continue;
      for (const b of turn.content) {
        if (b.type === "tool_use" && b.name === "load_skill") expectedLoadSkillCalls.push(b.input);
      }
    }
    for (const { label, arm, flag } of arms) {
      if (flag === "on") {
        expect(arm.auditRows, `${task.id} A4b：dsh 臂 toolCalls 审计行恒零（reassemble 纯重组装零 IO）`).toEqual([]);
      } else {
        expect(
          arm.auditRows.length,
          `${task.id} A4b：native 臂审计行数 == 剧本 load_skill 轮数（每轮一行，不多不少）`,
        ).toBe(expectedLoadSkillCalls.length);
        arm.auditRows.forEach((row, i) => {
          expect(row.toolName, `${task.id} A4b：第 ${i} 行 toolName`).toBe("load_skill");
          expect(row.outcome, `${task.id} A4b：第 ${i} 行 outcome`).toBe("OK");
          expect(row.input, `${task.id} A4b：第 ${i} 行 input 与剧本 load_skill 入参逐值等`).toEqual(expectedLoadSkillCalls[i]);
        });
      }
      void label;
    }
  }

  // ---- sketch / outcome parity ----
  expect(x.sketch).toEqual(y.sketch);
  if (div) {
    // G3 分锚：outcome/degraded 两臂各锚各的（native 常量锚 ANSWERED/无 degraded；
    // dsh 锚语料声明 BUDGET_EXHAUSTED/degraded{BUDGET_EXHAUSTED}）。
    expect(x.outcome, `${task.id} outcome 分锚（x 臂）`).toBe(flags.x === "on" ? div.dsh.outcome : "ANSWERED");
    expect(y.outcome, `${task.id} outcome 分锚（y 臂）`).toBe(flags.y === "on" ? div.dsh.outcome : "ANSWERED");
    expect(x.degraded, `${task.id} degraded 分锚（x 臂）`).toEqual(flags.x === "on" ? div.dsh.degraded : undefined);
    expect(y.degraded, `${task.id} degraded 分锚（y 臂）`).toEqual(flags.y === "on" ? div.dsh.degraded : undefined);
  } else {
    expect(x.outcome).toBe(y.outcome);
  }
}

// ---------------------------------------------------------------------------
// 套件
// ---------------------------------------------------------------------------

describe("WO-DSH-E2E · §16.2 L1 双跑字节比对（63 任务）", () => {
  it("A0 语料自检：构成 / 四维覆盖 / gated 槽在册", () => {
    expect(DUALRUN_CORPUS.length).toBe(63);
    expect(new Set(DUALRUN_CORPUS.map((t) => t.id)).size).toBe(63);
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
    expect(DUALRUN_CORPUS.some((t) => t.native.turns.filter((tn) => typeof tn === "object" && tn.content.some((b) => b.type === "tool_use" && b.name === "load_skill")).length === 3)).toBe(true);
    // provenance 形态 + 多块形态
    expect(DUALRUN_CORPUS.some((t) => (t.expect.answer.provenance?.length ?? 0) > 0)).toBe(true);
    expect(DUALRUN_CORPUS.some((t) => t.expect.answer.blocks.some((b) => b.type === "table"))).toBe(true);
    // A5 子集 ∈ 语料
    for (const id of A5_SUBSET) expect(DUALRUN_CORPUS.some((t) => t.id === id)).toBe(true);
    // 答案块经生产 scanBlocks 零裸数（unverifiedNumerics:false 锚的单源护栏）
    for (const t of DUALRUN_CORPUS) {
      expect(scanBlocks(t.expect.answer.blocks), `${t.id} 答案块含裸数，unverifiedNumerics 锚会漂`).toBe(false);
    }
    // EMPTY 豁免位双恰护栏：「豁免位生效 ⇔ expect.answer 确无本任务 id」——
    // 给有 marker 的任务误置豁免位 ⇒ 谓词不成立 ⇒ 哨兵照常跑（此断言同红，双保险）；
    // 给纯空答案漏置豁免位 ⇒ 此断言红。豁免任务的 prompt 必含 id（wire 替代哨兵的前提）。
    for (const t of DUALRUN_CORPUS) {
      const carriesMarker = JSON.stringify(t.expect.answer).includes(t.id);
      expect(
        markerSentinelExempt(t),
        `${t.id} 豁免位双恰：有 marker 不得豁免、纯空答案必须置豁免位`,
      ).toBe(!carriesMarker);
      if (markerSentinelExempt(t)) {
        expect(t.prompt, `${t.id} 豁免任务的 prompt 必含本任务 id（wire 首请求替代哨兵的锚源）`).toContain(t.id);
      }
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

  // -------------------------------------------------------------------------
  // W5 块1 · A3c SSE 事件族覆盖矩阵
  //
  // 15 族 = KNOWN_EVENTS 十名（前端 useTaskStream.ts:28-39 订阅面，单源经 N2 字面量锚）
  // ∪ ALLOWED_PSEUDO_TYPES 五名（payload.type 伪步族，N2 单源）。矩阵每行声明一族在本
  // 驱动级（engine.runRegisteredAgent 双臂 + answer.final 镜像）的覆盖真相：
  //   triggered   —— 至少一条语料真触发（本 it 自跑声明任务实证，精确族集断言）；
  //   unreachable —— 本驱动级物理不可达，原因四类闭枚举，逐行登记进 REC §2-A3 补表
  //                  （本 it 文本锚 REC 防登记漂移），不冒充覆盖。
  // -------------------------------------------------------------------------

  /** 不可达原因闭枚举（加类须评审；中文标签须与 REC §2-A3 补表逐字一致）。 */
  const UNREACHABLE_REASONS = {
    /** 编排层事件：orchestrator 在 runRegisteredAgent 之外发射（task.accepted 等七名），本驱动级够不着。 */
    ORCHESTRATOR_LEVEL: "编排层事件·本驱动级不可达",
    /** 真工具步族：语料两臂同用 meta 剧本保 parity（固有不对称 #3），真工具 SSE 对拍物理不可达。 */
    REAL_TOOL_ONLY: "真工具步族·meta-only 语料不可达",
    /** harness 内部决策：压缩由子进程上下文压力触发，剧本面无确定性通道（mapper 分支由 N2 A6b/A3/A4 单测钉死）。 */
    HARNESS_INTERNAL: "harness 内部决策·剧本面无确定性触发通道",
    /** meta skip 销账项：D-7 双臂同不产 meta 步事件，绿态恒不出现；出现即差集反咬 + 收缩过滤后序列不等（M10 咬点）。 */
    META_SKIP_GREEN_ABSENT: "meta-skip 销账项·绿态恒不出现",
  } as const;
  type UnreachableReason = keyof typeof UNREACHABLE_REASONS;

  interface FamilyRow {
    /** 族名（KNOWN_EVENTS 事件名 或 ALLOWED_PSEUDO_TYPES 伪步类型名）。 */
    name: string;
    /** seqOf 族串（事件名:伪类型）——观测面对账单元。 */
    family: string;
    status:
      | { kind: "triggered"; taskId: string; expect: { off: string[]; on: string[] } }
      | { kind: "unreachable"; reason: UnreachableReason };
  }

  const EVENT_FAMILY_MATRIX: readonly FamilyRow[] = [
    { name: "task.accepted", family: "task.accepted:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "routing.completed", family: "routing.completed:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "clarification.required", family: "clarification.required:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "coordinator.planned", family: "coordinator.planned:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "step.started", family: "step.started:<真工具名>", status: { kind: "unreachable", reason: "REAL_TOOL_ONLY" } },
    { name: "step.completed", family: "step.completed:<真工具名>", status: { kind: "unreachable", reason: "REAL_TOOL_ONLY" } },
    {
      name: "answer.final",
      family: "answer.final:",
      status: {
        kind: "triggered",
        taskId: "dr50-aa",
        expect: { off: ["answer.final:"], on: ["step.completed:agent_narration", "answer.final:"] },
      },
    },
    { name: "action_draft.created", family: "action_draft.created:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "task.failed", family: "task.failed:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    { name: "task.cancelled", family: "task.cancelled:", status: { kind: "unreachable", reason: "ORCHESTRATOR_LEVEL" } },
    {
      name: "agent_narration",
      family: "step.completed:agent_narration",
      status: {
        kind: "triggered",
        taskId: "dr50-aa",
        expect: { off: ["answer.final:"], on: ["step.completed:agent_narration", "answer.final:"] },
      },
    },
    {
      name: "agent_think",
      family: "step.completed:agent_think",
      status: {
        kind: "triggered",
        taskId: "dr50-ck",
        expect: {
          off: ["answer.final:"],
          on: ["step.completed:agent_think", "step.completed:agent_narration", "answer.final:"],
        },
      },
    },
    { name: "compaction", family: "step.started:compaction|step.completed:compaction", status: { kind: "unreachable", reason: "HARNESS_INTERNAL" } },
    { name: "final_answer", family: "step.started:final_answer|step.completed:final_answer", status: { kind: "unreachable", reason: "META_SKIP_GREEN_ABSENT" } },
    { name: "load_skill", family: "step.started:load_skill|step.completed:load_skill", status: { kind: "unreachable", reason: "META_SKIP_GREEN_ABSENT" } },
  ];

  it("A3c 事件族覆盖矩阵：15 族每族真触发或登记不可达，不冒充覆盖", { timeout: 300_000 }, async () => {
    // ① 完备性：矩阵恰 = KNOWN_EVENTS ∪ ALLOWED_PSEUDO_TYPES（单源字面量漂移 ⇒ 此断言红）。
    const declared = EVENT_FAMILY_MATRIX.map((r) => r.name);
    expect(new Set(declared).size, "矩阵族名零重复").toBe(declared.length);
    expect([...declared].sort()).toEqual([...KNOWN_EVENTS, ...ALLOWED_PSEUDO_TYPES].sort());

    // ② 触发行真触发：按 taskId 分组自跑双臂，观测族集（Set 语义）与声明逐组精确等——
    //    「精确等」是双向咬：声明的族没出现 ⇒ 红（冒充触发）；出现声明外的族 ⇒ 红（事件面漂移）。
    const triggeredRows = EVENT_FAMILY_MATRIX.filter(
      (r): r is FamilyRow & { status: Extract<FamilyRow["status"], { kind: "triggered" }> } => r.status.kind === "triggered",
    );
    const byTask = new Map<string, typeof triggeredRows>();
    for (const r of triggeredRows) {
      const group = byTask.get(r.status.taskId) ?? [];
      group.push(r);
      byTask.set(r.status.taskId, group);
    }
    for (const [taskId, rows] of byTask) {
      for (const r of rows) {
        expect(r.status.expect, `矩阵同任务 ${taskId} 的各行 expect 声明必须一致`).toEqual(rows[0]!.status.expect);
        expect(r.status.expect.off.includes(r.family) || r.status.expect.on.includes(r.family),
          `矩阵行 ${r.name} 的族串 ${r.family} 须在其声明的观测集内`).toBe(true);
      }
      const task = DUALRUN_CORPUS.find((t) => t.id === taskId);
      expect(task, `矩阵触发任务 ${taskId} 须在语料内`).toBeDefined();
      const off = await runArm(task!, "off");
      const on = await runArm(task!, "on");
      expect([...new Set(seqOf(off.events))].sort(), `${taskId} native 臂观测族集 == 矩阵声明`).toEqual(
        [...rows[0]!.status.expect.off].sort(),
      );
      expect([...new Set(seqOf(on.events))].sort(), `${taskId} dsh 臂观测族集 == 矩阵声明`).toEqual(
        [...rows[0]!.status.expect.on].sort(),
      );
    }

    // ③ 不可达行登记锚：原因 ∈ 闭枚举 ∧ REC §2-A3 补表逐行登记（族名 + 原因中文标签文本锚）。
    const rec = readFileSync(fileURLToPath(new URL("./fixtures/dualrun-corpus/RECONCILIATION.md", import.meta.url)), "utf8");
    const a3Section = rec.slice(rec.indexOf("### A3"), rec.indexOf("### A4"));
    expect(a3Section.length, "REC §2-A3 节须存在").toBeGreaterThan(0);
    for (const r of EVENT_FAMILY_MATRIX) {
      if (r.status.kind !== "unreachable") continue;
      expect(
        a3Section.includes(r.name) && a3Section.includes(UNREACHABLE_REASONS[r.status.reason]),
        `REC §2-A3 补表须登记不可达族 ${r.name}（原因 ${r.status.reason} = ${UNREACHABLE_REASONS[r.status.reason]}）`,
      ).toBe(true);
    }

    // ④ META_SKIP 反咬机制锚（静态）：final_answer/load_skill 恒在全量白名单但恒不在收缩集——
    //    skip 破损时它们以差集出现（白名单内可过 diff 断言）但收缩过滤滤不掉 ⇒ 序列不等红（M10 咬点不动）。
    for (const meta of ["final_answer", "load_skill"]) {
      expect(ALLOWED_PSEUDO_TYPES).toContain(meta);
      expect(SHRUNK_PSEUDO_TYPES).not.toContain(meta);
    }
  });

  it("gated 槽鸣报：角色路/场景路 STALL_LOOP 覆盖维持 gated（缝已落线；缺口=编排层驱动级+触发通道缺，REC §3 #7 裁决口径）", () => {
    for (const g of GATED_SLOTS) {
      console.warn(`GATED ${g.id}（${g.path} ${g.scenario}）：${g.gate}`);
    }
    expect(GATED_SLOTS.map((g) => g.path)).toEqual(["runRolePathB", "runSceneAgent"]);
  });
});
