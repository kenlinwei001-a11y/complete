import { describe, expect, it } from "vitest";
import {
  PROCESS_GATE_PRECEDENCE,
  PROCESS_TASK_STATUSES,
  PROCESS_TASK_WAIT_STATES,
  PROCESS_WAIT_KINDS,
  ProcessStuckResponseSchema,
  ProcessTaskSchema,
  evaluateGate,
  isWaitState,
  type ProcessInstanceDetail,
  type ProcessStuckResponse,
  type ProcessTaskWaitState,
} from "@platform/contracts";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemoProcessLayer, DEMO_TENANT } from "../src/seed.js";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-PROCESS-INSTANCE · 流程运行时层的**效果层**断言。
 *
 * 需求原文（`docs/PRD-enterprise-decision-twin.md` §4.5）要的是一句话的答案：
 * **「为什么这个流程现在卡住了」**。所以本文件的头号断言不是「组件渲染了」、
 * 也不是「函数返回了对象」，而是**指名道姓那几个字段**：
 * 卡在哪一步（`taskName`）· 为什么（`waitState`）· 等谁（`ownerFunctionKey`）· 等多久（`waitedMs`）。
 *
 * ── 为什么时钟是注入的 ────────────────────────────────────────────────────
 * 「等了多久」若拿真实时钟测，要么让测试睡三天，要么容忍误差 ——
 * 欠账 #141 的原话是「挂在墙钟上的断言并发时必假红」。注入之后，
 * 「已等 3 天」是一个可以断言到**毫秒**的确定值（R6）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 可拨动的假时钟。测试全程只经它取时间，绝不 `Date.now()`。 */
function fakeClock(startIso: string) {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    advanceMs: (ms: number) => {
      t += ms;
    },
  };
}

const T0 = "2026-03-01T00:00:00.000Z";

/** 开暗发门（`process.runtime` defaultOn:false ⇒ 不开则全部 404 FEATURE_NOT_FOUND）。 */
async function enableRuntime(t: TestApp) {
  await t.repos.featureConfigs.put({
    id: `fcfg_${DEMO_TENANT}`,
    tenantId: DEMO_TENANT,
    overrides: { "process.runtime": true },
    configVersion: 1,
    updatedBy: "test",
    updatedAt: T0,
  });
}

async function bootstrap(clock?: () => Date) {
  const t = await makeApp(clock ? { processClock: clock } : undefined);
  await seedDemoProcessLayer(t.repos);
  await enableRuntime(t);
  return t;
}

/** 建一条「销售订单评审接单」(P17·承载物 Order) 实例。步骤与 gate 由用例给。 */
async function createInstance(t: TestApp, tasks: unknown[], objectId = "ord_1") {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/process-instances",
    headers: ADMIN,
    payload: { definitionKey: "P17", subjectRef: { typeKey: "Order", objectId }, tasks },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ProcessInstanceDetail;
}

async function advance(t: TestApp, id: string, body: Record<string, unknown>) {
  const res = await t.app.inject({
    method: "POST",
    url: `/a/v1/process-instances/${id}/advance`,
    headers: ADMIN,
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ProcessInstanceDetail;
}

// ══════════════════════════════════════════════════════════════════════════
// ① 词表单源：五值是**派生**的，不是手抄
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE · 词表单源（五值 = 模板四值派生 + 审批）", () => {
  it("运行时五值的**前四位**逐字等于模板层 PROCESS_WAIT_KINDS —— 手抄一份必红", () => {
    expect(PROCESS_TASK_WAIT_STATES.length).toBe(PROCESS_WAIT_KINDS.length + 1);
    // 前缀逐字相等：模板层将来增删一个值，这里自动跟随；若有人把五值写成字面量数组，此断言立刻红。
    expect(PROCESS_TASK_WAIT_STATES.slice(0, PROCESS_WAIT_KINDS.length)).toEqual([...PROCESS_WAIT_KINDS]);
    expect(PROCESS_TASK_WAIT_STATES.at(-1)).toBe("WAITING_APPROVAL");
  });

  it("需求 §4.5 点名的五个态**一个不少**（这是需求原文的逐字对账）", () => {
    for (const s of [
      "WAITING_USER",
      "WAITING_APPROVAL",
      "WAITING_DATA",
      "WAITING_EXTERNAL_SYSTEM",
      "WAITING_SCHEDULE",
    ]) {
      expect(PROCESS_TASK_WAIT_STATES as readonly string[], `需求 §4.5 要的 ${s} 缺席`).toContain(s);
    }
  });

  it("模板层 PROCESS_WAIT_KINDS **仍是四值、仍不含 WAITING_APPROVAL**（仓主裁决未被本单推翻）", () => {
    // 这条是**防我自己**的：运行时加第五值，很容易顺手把模板层也"补齐"，
    // 那就推翻了仓主「流程审批不体现」的裁决。两层必须分开，故在此再钉一次。
    expect(PROCESS_WAIT_KINDS.length).toBe(4);
    expect(PROCESS_WAIT_KINDS as readonly string[]).not.toContain("WAITING_APPROVAL");
  });

  it("status 全集 = 4 推进态 + 5 等待态，且 isWaitState 只对后者为真", () => {
    expect(PROCESS_TASK_STATUSES.length).toBe(9);
    for (const s of PROCESS_TASK_WAIT_STATES) expect(isWaitState(s)).toBe(true);
    for (const s of ["PENDING", "RUNNING", "DONE", "CANCELLED"] as const) expect(isWaitState(s)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ② 五个等待态**各一条**：能进入、能被区分（工单 §5 点名）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 每个态一条真链路：建实例 → 引擎判 gate → 停在该态 → 读端如实报出成因。
 * 用**端到端**（HTTP inject）而不是直接调 `evaluateGate`：后者只证明函数对，
 * 不证明这个态能从生产路径进入 —— 本仓 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的教训
 * 正是「测试咬的是函数不是链路」。
 */
const WAIT_CASES: {
  state: ProcessTaskWaitState;
  gate: Record<string, unknown>;
  /** 期望的 waitRef —— 「卡在哪个具体对象上」，不是只报个类型。 */
  waitRef: string;
  /** 解除它需要的外部事实。 */
  release: Record<string, unknown>;
}[] = [
  {
    state: "WAITING_SCHEDULE",
    gate: { notBeforeAt: "2026-03-10T00:00:00.000Z" },
    waitRef: "2026-03-10T00:00:00.000Z",
    release: {}, // 只能靠时间走到（下面用假时钟拨过去）
  },
  {
    state: "WAITING_DATA",
    gate: { requiresDataKeys: ["credit_score", "stock_on_hand"] },
    waitRef: "credit_score", // 报**第一个**缺的 key，序稳定
    release: { availableDataKeys: ["credit_score", "stock_on_hand"] },
  },
  {
    state: "WAITING_EXTERNAL_SYSTEM",
    gate: { requiresExternalAck: { system: "supplier_portal", ref: "PO-8891" } },
    waitRef: "supplier_portal:PO-8891",
    release: { externalAcks: ["supplier_portal:PO-8891"] },
  },
  {
    state: "WAITING_APPROVAL",
    gate: { requiresApprovalOf: "adraft_credit_override_1" },
    waitRef: "adraft_credit_override_1",
    release: { approvals: { adraft_credit_override_1: "APPROVED" } },
  },
  {
    state: "WAITING_USER",
    gate: { requiresUserAction: "review" },
    waitRef: "review",
    release: { userActionsDone: ["review"] },
  },
];

describe("WO-PROCESS-INSTANCE · 五个等待态各一条：能进入且能被区分", () => {
  for (const c of WAIT_CASES) {
    it(`${c.state} 能从生产路径进入，且卡点如实报出 waitRef=${c.waitRef}`, async () => {
      const clock = fakeClock(T0);
      const t = await bootstrap(clock.now);

      const detail = await createInstance(t, [
        { name: "订单评审", ownerFunctionKey: "sales", gate: c.gate },
        { name: "下达排产", ownerFunctionKey: "production_planning" },
      ]);

      // ── 进入：实例卡住，且卡在这一个态上（能被区分 = 不是"卡住了"这么笼统） ──
      expect(detail.instance.status).toBe("WAITING");
      expect(detail.stuck, `${c.state} 应产生卡点投影`).toBeDefined();
      expect(detail.stuck!.waitState).toBe(c.state);
      expect(detail.stuck!.waitRef).toBe(c.waitRef);
      expect(detail.stuck!.taskName).toBe("订单评审");
      expect(detail.stuck!.ownerFunctionKey).toBe("sales");
      expect(detail.stuck!.ownerDisplayName).toBe("销售");
      // 定义名来自 ProcessDefinition（P17），证明运行时确实接到了模板层
      expect(detail.stuck!.definitionName).toBe("销售订单评审接单");

      // ── 出口：给足外部事实后必须真的解除 ──
      if (c.state === "WAITING_SCHEDULE") {
        // 窗口态的出口是**时间**，不是外部事实 —— 拨钟过去即可。
        clock.advanceMs(10 * DAY);
      }
      const after = await advance(t, detail.instance.id, c.release);
      expect(after.stuck, `${c.state} 给足条件后应不再卡在此态`).toBeUndefined();
      // 解除 = **开工**（不是直接完成）：gate 是「能不能开工」的前置条件，
      // 「做完了没」得由调用方明说。故第一步此刻 RUNNING，等待痕迹已清。
      expect(after.tasks[0]!.status).toBe("RUNNING");
      expect(after.tasks[0]!.waitingSince).toBeUndefined();
      expect(after.tasks[0]!.waitRef).toBeUndefined();
      expect(after.instance.status).toBe("RUNNING");

      // 再推一次 = 第一步收工、第二步入场（第二步无 gate ⇒ 直接 RUNNING）。
      const after2 = await advance(t, detail.instance.id, {});
      expect(after2.tasks[0]!.status).toBe("DONE");
      expect(after2.tasks[1]!.status).toBe("RUNNING");
      // 末步再推一次，整条流程收工。
      const after3 = await advance(t, detail.instance.id, {});
      expect(after3.instance.status).toBe("DONE");
      expect(after3.stuck).toBeUndefined();
    });
  }

  it("五个态在同一租户里可以**同时并存**且分别计数（byWaitState 是可区分的证据）", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);
    // 五条实例，各卡一个态。
    for (const [i, c] of WAIT_CASES.entries()) {
      await createInstance(t, [{ name: `步骤-${c.state}`, ownerFunctionKey: "sales", gate: c.gate }], `ord_${i}`);
    }
    const res = await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProcessStuckResponse;
    // 契约自校验（响应形状不是我说了算）。
    ProcessStuckResponseSchema.parse(body);
    expect(body.stuck).toHaveLength(5);
    for (const c of WAIT_CASES) {
      expect(body.byWaitState[c.state], `${c.state} 应各计到 1 条`).toBe(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 头号接缝断言：端到端「在等审批 + 等谁 + 等了多久」，推进后**真的变**
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE · SEAM 端到端：停在 WAITING_APPROVAL → 推进 → 显示真的变", () => {
  it("卡住时四问皆有据；批复后卡点消失、耗时落定（指名道姓到字段）", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);

    const created = await createInstance(t, [
      { name: "信用超额审批", ownerFunctionKey: "finance", gate: { requiresApprovalOf: "adraft_credit_1" } },
      { name: "下达排产", ownerFunctionKey: "production_planning" },
    ]);
    const id = created.instance.id;

    // ── 等了三天 ──（假时钟，不是墙钟）
    clock.advanceMs(3 * DAY);

    const stuckRes = await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN });
    const stuckBody = ProcessStuckResponseSchema.parse(stuckRes.json());
    expect(stuckBody.stuck).toHaveLength(1);
    const r = stuckBody.stuck[0]!;

    // ⓵ 卡在哪一步
    expect(r.taskName).toBe("信用超额审批");
    expect(r.taskSeq).toBe(1);
    // ⓶ 为什么
    expect(r.waitState).toBe("WAITING_APPROVAL");
    expect(r.waitRef).toBe("adraft_credit_1"); // 具体是哪张审批单
    // ⓷ 等谁
    expect(r.ownerFunctionKey).toBe("finance");
    expect(r.ownerDisplayName).toBe("财务");
    // ⓸ 等多久 —— **毫秒级确定值**，这是时钟注入换来的
    expect(r.waitedMs).toBe(3 * DAY);
    expect(r.waitingSince).toBe(T0);

    // ── 再等两天，那个数字必须**真的长**（防「每次刷新把等待起点重置成 now」的静默错误）──
    clock.advanceMs(2 * DAY);
    const stillRes = await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN });
    const still = ProcessStuckResponseSchema.parse(stillRes.json());
    expect(still.stuck[0]!.waitedMs, "等待时长必须随时间增长，起点不许被重置").toBe(5 * DAY);
    expect(still.stuck[0]!.waitingSince).toBe(T0);

    // 期间反复 advance（模拟前端轮询）也不许重置起点 —— 这是最容易犯的那个错。
    await advance(t, id, {});
    const afterPoll = ProcessStuckResponseSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN })).json(),
    );
    expect(afterPoll.stuck[0]!.waitedMs, "重复 advance 不得把等待时长清零").toBe(5 * DAY);

    // ── 批了 ── 先解除阻塞（开工）
    const unblocked = await advance(t, id, { approvals: { adraft_credit_1: "APPROVED" } });
    // 显示**真的变**了：卡点没了
    expect(unblocked.stuck).toBeUndefined();
    expect(unblocked.instance.status).toBe("RUNNING");
    expect(unblocked.tasks[0]!.status).toBe("RUNNING");

    // ── 这一步做完，落 Output/Decision ──
    const advanced = await advance(t, id, {
      approvals: { adraft_credit_1: "APPROVED" },
      decision: { choice: "同意超额", decidedBy: "usr_cfo", decidedAt: "2026-03-06T00:00:00.000Z" },
      output: { approvedAmount: 1_200_000 },
    });
    const step1 = advanced.tasks[0]!;
    expect(step1.status).toBe("DONE");
    // 八字段里的 Duration/End Time/Output/Decision 全部落定。
    // durationMs = **该步总停留时长（含等待的 5 天）**，不是「批完之后干活用了多久」——
    // 这是 §4.5 想要的「这一步花了多久」，等待本身就是流程耗时的大头。
    expect(step1.endedAt).toBe("2026-03-06T00:00:00.000Z");
    expect(step1.durationMs).toBe(5 * DAY);
    expect(step1.output).toEqual({ approvedAmount: 1_200_000 });
    expect(step1.decision!.choice).toBe("同意超额");
    // 收工即清等待痕迹（已完成的步不许看起来还在等）
    expect(step1.waitingSince).toBeUndefined();
    expect(step1.waitRef).toBeUndefined();
    // 第二步已入场（无 gate ⇒ RUNNING），整条流程仍在跑。
    expect(advanced.tasks[1]!.status).toBe("RUNNING");
    expect(advanced.stuck).toBeUndefined();
    // 全租户卡点清空
    const finalStuck = ProcessStuckResponseSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN })).json(),
    );
    expect(finalStuck.stuck).toHaveLength(0);
    expect(finalStuck.byWaitState.WAITING_APPROVAL).toBe(0);
  });

  it("需求 §4.5 八字段在任务上**逐条**有位置（Start/End/Duration/Owner/Status/Input/Output/Decision）", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);
    // 无 gate 的步：创建即入场 → RUNNING（**不是** DONE —— 初版就错在这，见 runtime.ts advance() 注释）。
    const created = await createInstance(t, [
      { name: "订单评审", ownerFunctionKey: "sales", input: { orderId: "ord_1", qty: 500 } },
    ]);
    expect(created.tasks[0]!.status, "无前置条件的步应开工，而不是瞬间完成").toBe("RUNNING");
    expect(created.instance.status).toBe("RUNNING");

    clock.advanceMs(2 * HOUR);
    const done = await advance(t, created.instance.id, {
      output: { accepted: true },
      decision: { choice: "接单", decidedBy: "usr_sales", decidedAt: "2026-03-01T02:00:00.000Z" },
    });
    const task = ProcessTaskSchema.parse(done.tasks[0]);
    expect(task.startedAt).toBe(T0); // Start Time
    expect(task.endedAt).toBe("2026-03-01T02:00:00.000Z"); // End Time
    expect(task.durationMs).toBe(2 * HOUR); // Duration
    expect(task.ownerFunctionKey).toBe("sales"); // Owner
    expect(task.status).toBe("DONE"); // Status
    expect(task.input).toEqual({ orderId: "ord_1", qty: 500 }); // Input
    expect(task.output).toEqual({ accepted: true }); // Output
    expect(task.decision!.choice).toBe("接单"); // Decision
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 诚实缺席：没有的数据**不下发**，不许填「未知/-/N/A」
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE · 诚实缺席（缺就不下发，不是填占位符）", () => {
  it("自定义 ownerFunctionKey 查不到中文名 ⇒ ownerDisplayName **字段缺席**，而不是 '未知'", async () => {
    const t = await bootstrap(fakeClock(T0).now);
    const d = await createInstance(t, [
      { name: "特殊评审", ownerFunctionKey: "tenant_custom_dept", gate: { requiresUserAction: "sign" } },
    ]);
    expect(d.stuck!.ownerFunctionKey).toBe("tenant_custom_dept"); // 原值照给，前端可退回显示 key
    expect(Object.hasOwn(d.stuck!, "ownerDisplayName"), "查不到就不该有这个字段").toBe(false);
    for (const bad of ["未知", "-", "N/A", "null", ""]) {
      expect(JSON.stringify(d.stuck)).not.toContain(`"ownerDisplayName":"${bad}"`);
    }
  });

  it("未开工的步 **没有** startedAt/durationMs 字段（不是 0，也不是空串）", async () => {
    const t = await bootstrap(fakeClock(T0).now);
    const d = await createInstance(t, [
      { name: "第一步", ownerFunctionKey: "sales", gate: { requiresUserAction: "sign" } },
      { name: "第二步", ownerFunctionKey: "production_planning" },
    ]);
    const step2 = d.tasks[1]!;
    expect(step2.status).toBe("PENDING");
    expect(Object.hasOwn(step2, "startedAt")).toBe(false);
    expect(Object.hasOwn(step2, "durationMs")).toBe(false);
    expect(Object.hasOwn(step2, "endedAt")).toBe(false);
  });

  it("进行中的步**不写** durationMs（会静默失真的字段一律不落库）", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);
    const d = await createInstance(t, [
      { name: "等审批", ownerFunctionKey: "finance", gate: { requiresApprovalOf: "adraft_x" } },
    ]);
    clock.advanceMs(DAY);
    const cur = (await advance(t, d.instance.id, {})).tasks[0]!;
    expect(cur.status).toBe("WAITING_APPROVAL");
    expect(Object.hasOwn(cur, "durationMs"), "没结束的步不许有 Duration").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 确定性 · 优先序 · 隔离 · 门禁
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE · 确定性与不变量", () => {
  it("多重阻塞取**最外层**成因（PRECEDENCE 定序 ⇒ 同数据必得同一个答案）", () => {
    // 五个条件同时不满足：窗口最外层，应报 WAITING_SCHEDULE。
    const gate = {
      notBeforeAt: "2026-03-10T00:00:00.000Z",
      requiresDataKeys: ["k1"],
      requiresExternalAck: { system: "s", ref: "r" },
      requiresApprovalOf: "a1",
      requiresUserAction: "u1",
    };
    const now = new Date(T0);
    expect(evaluateGate(gate, { now }).waitState).toBe("WAITING_SCHEDULE");
    // 逐层剥掉，应严格按 PRECEDENCE 顺序退让 —— 这条把那张优先序表钉死。
    const peeled: Record<string, unknown> = { ...gate };
    const seen: string[] = [];
    for (const _ of PROCESS_GATE_PRECEDENCE) {
      const v = evaluateGate(peeled as never, { now });
      if (!v.waitState) break;
      seen.push(v.waitState);
      // 移除刚报出的那一层
      if (v.waitState === "WAITING_SCHEDULE") delete peeled.notBeforeAt;
      else if (v.waitState === "WAITING_DATA") delete peeled.requiresDataKeys;
      else if (v.waitState === "WAITING_EXTERNAL_SYSTEM") delete peeled.requiresExternalAck;
      else if (v.waitState === "WAITING_APPROVAL") delete peeled.requiresApprovalOf;
      else if (v.waitState === "WAITING_USER") delete peeled.requiresUserAction;
    }
    expect(seen).toEqual([...PROCESS_GATE_PRECEDENCE]);
  });

  it("stuck 列表按等待时长降序（等最久的排最前），同值按 instanceId —— 全定序", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);
    await createInstance(t, [{ name: "早", ownerFunctionKey: "sales", gate: { requiresUserAction: "a" } }], "ord_early");
    clock.advanceMs(DAY);
    await createInstance(t, [{ name: "晚", ownerFunctionKey: "sales", gate: { requiresUserAction: "a" } }], "ord_late");
    clock.advanceMs(HOUR);
    const body = ProcessStuckResponseSchema.parse(
      (await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN })).json(),
    );
    expect(body.stuck.map((s) => s.taskName)).toEqual(["早", "晚"]);
    expect(body.stuck[0]!.waitedMs).toBe(DAY + HOUR);
    expect(body.stuck[1]!.waitedMs).toBe(HOUR);
  });

  it("R6 幂等：同数据同时钟连查两次，响应字节级一致", async () => {
    const clock = fakeClock(T0);
    const t = await bootstrap(clock.now);
    await createInstance(t, [{ name: "步", ownerFunctionKey: "sales", gate: { requiresUserAction: "a" } }]);
    const a = (await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN })).body;
    const b = (await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN })).body;
    expect(a).toBe(b);
  });

  it("R2 租户隔离：别的租户读不到，且是 404 不是 403（不泄漏存在性）", async () => {
    const t = await bootstrap(fakeClock(T0).now);
    const d = await createInstance(t, [{ name: "步", ownerFunctionKey: "sales" }]);
    const res = await t.app.inject({
      method: "GET",
      url: `/a/v1/process-instances/${d.instance.id}`,
      headers: { "x-debug-user": "other_tenant:someone:admin" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("R3 暗发：feature 关着时四个端点全 404 FEATURE_NOT_FOUND（先于 authz）", async () => {
    // 刻意**不**调 enableRuntime —— defaultOn:false 的默认态。
    const t = await makeApp();
    await seedDemoProcessLayer(t.repos);
    for (const [method, url] of [
      ["GET", "/a/v1/process-instances/stuck"],
      ["GET", "/a/v1/process-instances/pinst_x"],
      ["POST", "/a/v1/process-instances"],
      ["POST", "/a/v1/process-instances/pinst_x/advance"],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: ADMIN, payload: {} });
      expect(res.statusCode, `${method} ${url} 未开通应 404`).toBe(404);
      expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
    }
  });

  it("实例必须挂在**已定义**的流程上，且承载物类型须一致（不许凭空建）", async () => {
    const t = await bootstrap(fakeClock(T0).now);
    const noDef = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: "P99", // 65 条里没有
        subjectRef: { typeKey: "Order", objectId: "o1" },
        tasks: [{ name: "步", ownerFunctionKey: "sales" }],
      },
    });
    expect(noDef.statusCode).toBe(404);

    const wrongCarrier = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: "P17", // carrierTypeKey = Order
        subjectRef: { typeKey: "Supplier", objectId: "s1" },
        tasks: [{ name: "步", ownerFunctionKey: "sales" }],
      },
    });
    expect(wrongCarrier.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ R9 四处同改对账（migration ↔ pg.ts 字面量）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE · R9 仓储四处同改", () => {
  it("migration 里的表名与 pg.ts 的字面量对得上（写错这里不编译报错、memory 单测也测不到）", async () => {
    const sql = await readFile(join(REPO_APP, "migrations/033_process_instances.sql"), "utf8");
    const pg = await readFile(join(REPO_APP, "src/repo/pg.ts"), "utf8");

    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);
    // 金丝雀：抽取器必须真的抽到东西。抽到 0 条要报「工具坏了」，不许报「表名都对」。
    expect(created.length, "金丝雀：CREATE TABLE 抽取器抽到 0 条 ⇒ 是抽取器坏了，不是 SQL 干净").toBeGreaterThan(0);
    expect(created).toEqual(["process_instances", "process_tasks"]);

    for (const table of created) {
      expect(pg.includes(`"${table}"`), `pg.ts 缺 PgStore(pool, "${table}")`).toBe(true);
    }
  });

  it("memory 与 pg 两个仓储都声明了这两个 store（R9 三处同改之二、之三）", async () => {
    const mem = await readFile(join(REPO_APP, "src/repo/memory.ts"), "utf8");
    const iface = await readFile(join(REPO_APP, "src/repo/repo.ts"), "utf8");
    for (const key of ["processInstances", "processTasks"]) {
      expect(mem.includes(`${key}: new MemStore()`), `memory.ts 缺 ${key}`).toBe(true);
      expect(iface.includes(`${key}: Store<`), `repo.ts 接口缺 ${key}`).toBe(true);
    }
  });
});
