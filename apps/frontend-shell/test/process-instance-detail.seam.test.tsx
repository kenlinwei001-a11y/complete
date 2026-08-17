import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  AdvanceProcessInstanceRequestSchema,
  CreateProcessInstanceRequestSchema,
  ProcessInstanceDetailSchema,
  ProcessInstanceSchema,
  evaluateGate,
  isWaitState,
  processInstanceId,
  processInstanceKey,
  type ProcessGateContext,
  type ProcessInstance,
  type ProcessInstanceDetail,
  type ProcessTask,
} from "@platform/contracts";
import { api } from "@/api/apiClient";
import { db } from "@/mocks/db";
import { queryClient } from "@/store/queryClient";
import { routes } from "@/App";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-PROCESS-INSTANCE-UI · 流程实例详情/推进 **驱动接缝** 测试。
 *
 * 咬的是整条链，不是各半：
 *   建实例（POST create，站在未来创建入口的位置）→ **深链 URL 带 id** → 刷新（清缓存重挂载）
 *   → 经 GET 详情端点**读回**（不许拿 create 响应当证据）→ 推进按钮 → **确认弹窗**（不许一点就推）
 *   → POST advance → 再经 GET 读回 → **状态真的变了**。
 *
 * ══ MSW 迷你运行时 —— 逻辑不重写 ══════════════════════════════════════════════
 * 内联 handler 里的 gate 判定**直接调契约 `evaluateGate`**，不另造一份「测试版状态机」——
 * 另造一份就是第二真相源：契约改了判定序，这份测试照样绿，而页面在真后端上是错的。
 * 请求/响应逐次过契约 schema（`CreateProcessInstanceRequestSchema` 等）—— mock 与契约分家
 * 是本仓栽过的形态（「测试咬 mock 恒绿」）。
 *
 * ══ 金丝雀先行（铁律 0.6）══════════════════════════════════════════════════════
 * 任何「状态没变 / 按钮不在」这类**否定**断言之前，先证明 handler 命中计数在涨 ——
 * 命中计数不涨，说明 MSW 链断了，此时一切断言都是哑的。
 *
 * ══ 变异反证（工单点名）═══════════════════════════════════════════════════════
 * 拆掉 advance 的**写入**（handler 照收请求、照返详情，就是不落库）⇒ 整条 UI 点击链
 * （按钮 → 弹窗 → 确认 → 200）依然全活，但主测试 §2 必须红在**「状态没变」**那一点 ——
 * 证明主测试咬的是「写入真发生了」，不是「按钮点得动」。
 */

const TENANT = "demo";
const NOW = new Date("2026-08-16T08:00:00.000Z");
const NOW_ISO = NOW.toISOString();

/** 流程定义夹具（真后端从 65 条种子里查；这里只取本测试用到的两条，字段即种子同名字段）。 */
const DEFS: Record<string, { key: string; name: string; carrierTypeKey: string; ownerFunctionKey: string }> = {
  P34: { key: "P34", name: "来料检验", carrierTypeKey: "IncomingInspection", ownerFunctionKey: "quality" },
};

interface Row {
  instance: ProcessInstance;
  tasks: ProcessTask[];
}

/** handler 命中计数 —— 一切否定断言的金丝雀。 */
const hits = { create: 0, detail: 0, advance: 0 };
let store: Map<string, Row>;
/** 变异开关：false 时 advance 不落库（见 §6 变异反证）。 */
let advanceWrites = true;

function detailOf(row: Row): ProcessInstanceDetail {
  const current = row.tasks.find((t) => t.id === row.instance.currentTaskId);
  const stuck =
    current && isWaitState(current.status)
      ? {
          instanceId: row.instance.id,
          processKey: row.instance.processKey,
          definitionName: DEFS[row.instance.processKey]?.name,
          subjectRef: { typeKey: row.instance.carrierTypeKey, objectId: row.instance.carrierObjectId },
          taskId: current.id,
          taskName: current.name,
          taskSeq: current.seq,
          waitState: current.status,
          ...(current.waitRef ? { waitRef: current.waitRef } : {}),
          ownerFunctionKey: current.ownerFunctionKey,
          ...(current.waitingSince
            ? { waitingSince: current.waitingSince, waitedMs: Math.max(0, NOW.getTime() - Date.parse(current.waitingSince)) }
            : {}),
        }
      : undefined;
  // 每次响应过一遍契约 —— mock 载荷不合法当场红，不许把坏数据喂给页面再猜。
  return ProcessInstanceDetailSchema.parse({
    instance: row.instance,
    tasks: [...row.tasks].sort((a, b) => a.seq - b.seq),
    ...(stuck ? { stuck } : {}),
  });
}

/** 与 `apps/datacore/src/process/runtime.ts` 同一套入场/推进语义（compact 版），判定用契约 evaluateGate。 */
function enter(row: Row, i: number, ctx: ProcessGateContext): void {
  const task = row.tasks[i]!;
  const verdict = evaluateGate(task.gate, ctx);
  if (verdict.waitState) {
    const sameWait = task.status === verdict.waitState && task.waitRef === verdict.waitRef;
    const blocked: ProcessTask = {
      ...task,
      status: verdict.waitState,
      startedAt: task.startedAt ?? NOW_ISO,
      waitingSince: sameWait ? (task.waitingSince ?? NOW_ISO) : NOW_ISO,
      ...(verdict.waitRef ? { waitRef: verdict.waitRef } : {}),
    };
    // 与真引擎同一笔：换了成因但没 waitRef 时，旧 waitRef 不许留着（契约不变量会当场拒收）。
    if (!verdict.waitRef) delete (blocked as Partial<ProcessTask>).waitRef;
    row.tasks[i] = blocked;
    const next: ProcessInstance = {
      ...row.instance,
      status: "WAITING",
      currentTaskId: task.id,
      waitState: verdict.waitState,
      waitStateOrigin: "TASK_GATE",
      ...(verdict.waitRef ? { waitRef: verdict.waitRef } : {}),
    };
    if (!verdict.waitRef) delete (next as Partial<ProcessInstance>).waitRef;
    row.instance = next;
    return;
  }
  // gate 已满足 ⇒ 开工。与真引擎同一笔：清掉等待痕迹（不再卡着了）——
  // 留着 waitRef/waitingSince 会让 detail 响应过不了契约不变量（superRefine 拒收 ⇒ 400）。
  const running: ProcessTask = { ...task, status: "RUNNING", startedAt: task.startedAt ?? NOW_ISO };
  delete (running as Partial<ProcessTask>).waitingSince;
  delete (running as Partial<ProcessTask>).waitRef;
  row.tasks[i] = running;
  const next: ProcessInstance = { ...row.instance, status: "RUNNING", currentTaskId: task.id, waitState: null, waitStateOrigin: null };
  delete (next as Partial<ProcessInstance>).waitRef;
  row.instance = next;
}

function createInstance(body: unknown): ProcessInstanceDetail {
  const req = CreateProcessInstanceRequestSchema.parse(body);
  const def = DEFS[req.definitionKey];
  if (!def || def.carrierTypeKey !== req.subjectRef.typeKey) {
    throw Object.assign(new Error("VALIDATION_ERROR"), { statusCode: 400 });
  }
  const id = processInstanceId("MANAGED", TENANT, def.key, req.subjectRef.objectId);
  const tasks: ProcessTask[] = req.tasks.map((t, i) => ({
    id: `${id}_t${i + 1}`,
    tenantId: TENANT,
    instanceId: id,
    seq: i + 1,
    name: t.name,
    ownerFunctionKey: t.ownerFunctionKey,
    status: "PENDING" as const,
    ...(t.gate ? { gate: t.gate } : {}),
    ...(t.input ? { input: t.input } : {}),
  }));
  const row: Row = {
    instance: ProcessInstanceSchema.parse({
      id,
      tenantId: TENANT,
      key: processInstanceKey(def.key, req.subjectRef.objectId),
      processKey: def.key,
      carrierObjectId: req.subjectRef.objectId,
      carrierTypeKey: def.carrierTypeKey,
      flowKey: id,
      stationIndex: 0,
      enteredAt: NOW_ISO,
      exitedAt: null,
      waitState: null,
      waitStateOrigin: null,
      ownerRef: { functionKey: def.ownerFunctionKey, partyField: null, partyValue: null },
      status: "RUNNING",
      currentTaskId: tasks[0]!.id,
      origin: "MANAGED",
      sourceDocuments: [],
      scopeObjectTypes: [def.carrierTypeKey],
    }),
    tasks,
  };
  // 引擎同款：建完立刻对首步入场判一次 gate。
  enter(row, 0, { now: NOW });
  store.set(id, row);
  return detailOf(row);
}

function advanceInstance(id: string, body: unknown): ProcessInstanceDetail {
  const req = AdvanceProcessInstanceRequestSchema.parse(body ?? {});
  const row = store.get(id);
  if (!row) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });
  if (!advanceWrites) {
    // §6 变异：照收请求、照返详情，**就是不落库**。主测试必须红在「状态没变」。
    return detailOf(row);
  }
  if (row.tasks.length === 0) throw Object.assign(new Error("VALIDATION_ERROR"), { statusCode: 400 });
  if (row.instance.status === "DONE" || row.instance.status === "CANCELLED") return detailOf(row);
  const ctx: ProcessGateContext = {
    now: NOW,
    availableDataKeys: req.availableDataKeys,
    externalAcks: req.externalAcks,
    approvals: req.approvals,
    userActionsDone: req.userActionsDone,
  };
  let cursor = row.tasks.findIndex((t) => t.id === row.instance.currentTaskId);
  if (cursor < 0) cursor = row.tasks.findIndex((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  if (cursor >= 0 && cursor < row.tasks.length) {
    const task = row.tasks[cursor]!;
    if (task.status === "RUNNING") {
      const startedAt = task.startedAt ?? NOW_ISO;
      const done: ProcessTask = {
        ...task,
        status: "DONE",
        startedAt,
        endedAt: NOW_ISO,
        durationMs: Math.max(0, NOW.getTime() - Date.parse(startedAt)),
        ...(req.output ? { output: req.output } : {}),
        ...(req.decision ? { decision: req.decision } : {}),
      };
      // 收工即清等待痕迹（与真引擎同一笔）：留着 waitingSince 会让已完成的步看起来还在等。
      delete (done as Partial<ProcessTask>).waitingSince;
      delete (done as Partial<ProcessTask>).waitRef;
      row.tasks[cursor] = done;
      cursor += 1;
      if (cursor >= row.tasks.length) {
        const next: ProcessInstance = { ...row.instance, status: "DONE", exitedAt: NOW_ISO, waitState: null, waitStateOrigin: null };
        delete (next as Partial<ProcessInstance>).currentTaskId;
        delete (next as Partial<ProcessInstance>).waitRef;
        row.instance = next;
      } else {
        enter(row, cursor, ctx);
      }
    } else {
      enter(row, cursor, ctx);
    }
  }
  return detailOf(row);
}

const errJson = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, requestId: "req_test" } }, { status });

/** 暗发闸（对齐真后端 `requireProcessRuntime`：关 = 404 FEATURE_NOT_FOUND，先于一切）。 */
const featureOff = () => db.tenantOverrides["process.runtime"] !== true;

function runtimeHandlers() {
  return [
    http.post("*/a/v1/process-instances", async ({ request }) => {
      if (featureOff()) return errJson(404, "FEATURE_NOT_FOUND", "feature process.runtime not enabled");
      hits.create += 1;
      try {
        return HttpResponse.json(createInstance(await request.json()));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 400;
        return errJson(status, status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR", String(e));
      }
    }),
    // ⚠ 刻意用 RegExp 路径**排除 "stuck"**：`*/a/v1/process-instances/:id` 会把 `…/stuck` 也捕进来，
    //   而 server.use 的运行时 handler 优先级高于全局 mock ⇒ 全局 stuck handler 被整个影子掉
    //   （真后端没这问题：app.ts 里 /stuck 注册在 /:id 之前，Fastify 先中先赢；MSW 是后到先赢）。
    http.get(/.*\/a\/v1\/process-instances\/(?!stuck$)([^/]+)$/, ({ params }) => {
      if (featureOff()) return errJson(404, "FEATURE_NOT_FOUND", "feature process.runtime not enabled");
      hits.detail += 1;
      const id = decodeURIComponent(String(params[0]));
      const row = store.get(id);
      if (!row) return errJson(404, "NOT_FOUND", `ProcessInstance ${id} 不存在`);
      return HttpResponse.json(detailOf(row));
    }),
    http.post("*/a/v1/process-instances/:id/advance", async ({ params, request }) => {
      if (featureOff()) return errJson(404, "FEATURE_NOT_FOUND", "feature process.runtime not enabled");
      hits.advance += 1;
      try {
        return HttpResponse.json(advanceInstance(String(params.id), await request.json()));
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 400;
        return errJson(status, status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR", String(e));
      }
    }),
  ];
}

/** 一条反推实例夹具（产地 DERIVED_FROM_DOCUMENT · 无步骤 · 带 R13 溯源）。 */
function derivedFixture(): Row {
  const instance = ProcessInstanceSchema.parse({
    id: processInstanceId("DERIVED_FROM_DOCUMENT", TENANT, "P34", "iq_5001"),
    tenantId: TENANT,
    key: processInstanceKey("P34", "iq_5001"),
    processKey: "P34",
    carrierObjectId: "iq_5001",
    carrierTypeKey: "IncomingInspection",
    flowKey: "flow_inbound::po_77",
    stationIndex: 2,
    enteredAt: "2026-08-01",
    exitedAt: null,
    waitState: "WAITING_DATA",
    waitStateOrigin: "DEFINITION_TEMPLATE",
    ownerRef: { functionKey: "quality", partyField: "inspectorTeam", partyValue: "IQC-理化组" },
    status: "WAITING",
    origin: "DERIVED_FROM_DOCUMENT",
    sourceDocuments: [
      { objectId: "iq_5001", typeKey: "IncomingInspection", field: "arrivedDay", rawValue: 12, unit: "DAY_OFFSET", resolvedAt: "2026-08-01", role: "ENTERED" },
    ],
    scopeObjectTypes: ["IncomingInspection"],
  });
  return { instance, tasks: [] };
}

/** 站上未来创建入口的位置：经 HTTP 建一条 MANAGED 实例，返回它的 id（深链的钥匙）。 */
async function createViaApi(): Promise<string> {
  const res = await api.a<ProcessInstanceDetail>("/a/v1/process-instances", {
    method: "POST",
    body: {
      definitionKey: "P34",
      subjectRef: { typeKey: "IncomingInspection", objectId: "iq_9001" },
      tasks: [
        { name: "到货核对", ownerFunctionKey: "quality", gate: { requiresUserAction: "review" } },
        { name: "理化检验", ownerFunctionKey: "lab" },
      ],
    },
  });
  // create 响应只用来拿 id —— 实例状态一律经 GET 读回断言（工单：别拿 create 响应当证据）。
  return res.instance.id;
}

beforeEach(() => {
  store = new Map();
  advanceWrites = true;
  hits.create = 0;
  hits.detail = 0;
  hits.advance = 0;
  server.use(...runtimeHandlers());
  db.tenantOverrides["process.runtime"] = true;
  loginAs("planner");
});

describe("WO-PROCESS-INSTANCE-UI · 流程实例详情/推进接缝", () => {
  it("§0 结构守卫：深链路由在路由表里（参数化、非 v/ 前缀），金丝雀：解析得出已知路由 tasks/:taskId", () => {
    const shell = routes.find((r) => r.path === "/");
    const paths = (shell?.children ?? []).map((c) => c.path ?? "");
    // 金丝雀：已知存在的参数化路由必须在 —— 它若不在，是解析器坏了不是路由没了。
    expect(paths).toContain("tasks/:taskId");
    expect(paths).toContain("process-instances/:instanceId");
    // 防回归：不许被谁改回 v/ 前缀（f61 dedicatedRouteKeys 会捕它进「效果层」⇒ 恒红，见 App.tsx 注释）。
    expect(paths).not.toContain("v/process-instances/:instanceId");
  });

  it("§1 端到端：建实例 → 深链刷新仍找回（GET 读回）→ 确认推进 → 状态真变", async () => {
    const user = userEvent.setup();
    const id = await createViaApi();
    expect(id).toBe(processInstanceId("MANAGED", TENANT, "P34", "iq_9001"));
    // 金丝雀：创建 handler 真被打了 —— 它若 0，后面全是哑断言。
    expect(hits.create).toBe(1);

    // ── 第一面：建完直接打开深链 ──────────────────────────────────────────
    const first = renderApp(`/process-instances/${id}`);
    const task1 = await screen.findByTestId("pi-task-1", {}, { timeout: 15000 });
    expect(task1).toHaveAttribute("data-status", "WAITING_USER");
    expect(screen.getByTestId("pi-task-name-1")).toHaveTextContent("到货核对");
    expect(screen.getByTestId("pi-status")).toHaveTextContent("等待中");
    // 诚实位：这一格是 gate 现场判的，不是模板抄的。
    expect(screen.getByTestId("pi-wait-origin")).toHaveTextContent("现场判定");
    expect(hits.detail).toBeGreaterThanOrEqual(1);

    // ── 刷新（卸载 + 清缓存 + 重挂载）：实例必须仍在 —— 本单的核心断言 ──────
    // 读回走的是 GET 详情端点，不是 create 响应；缓存清掉 ⇒ 命中计数必须再涨。
    first.unmount();
    queryClient.clear();
    const detailBefore = hits.detail;
    renderApp(`/process-instances/${id}`);
    expect(await screen.findByTestId("pi-task-1", {}, { timeout: 15000 })).toHaveAttribute("data-status", "WAITING_USER");
    expect(hits.detail, "刷新后没有重新打 GET 详情端点 —— 「找回」是缓存假象").toBeGreaterThan(detailBefore);

    // ── 推进①：不填事实直接确认 ⇒ 引擎重判仍卡着（诚实：推不动就是推不动）──
    await user.click(await screen.findByTestId("pi-advance-open"));
    await user.click(await screen.findByRole("button", { name: "确认推进" }));
    await waitFor(() => expect(hits.advance).toBe(1));
    expect(await screen.findByTestId("pi-task-1")).toHaveAttribute("data-status", "WAITING_USER");

    // ── 推进②：填报「人工已完成 review」→ 确认 → 当前步开工 ────────────────
    await user.click(screen.getByTestId("pi-fact-user-check"));
    await user.click(screen.getByTestId("pi-advance-open"));
    await user.click(await screen.findByRole("button", { name: "确认推进" }));
    await waitFor(() => expect(hits.advance).toBe(2));
    // 状态变化经「invalidate → GET 重读」到达（不是 advance 响应直接上屏）—— 等它落地。
    await waitFor(() => expect(screen.getByTestId("pi-task-1")).toHaveAttribute("data-status", "RUNNING"));
    expect(screen.getByTestId("pi-status")).toHaveTextContent("进行中");

    // ── 推进③：办结当前步 ⇒ 第 1 步 DONE、第 2 步随即入场开工 ─────────────
    await user.click(await screen.findByTestId("pi-advance-open"));
    await user.click(await screen.findByRole("button", { name: "确认推进" }));
    await waitFor(() => expect(hits.advance).toBe(3));
    await waitFor(() => expect(screen.getByTestId("pi-task-1")).toHaveAttribute("data-status", "DONE"));
    expect(screen.getByTestId("pi-task-2")).toHaveAttribute("data-status", "RUNNING");
    expect(screen.getByTestId("pi-task-status-1")).toHaveTextContent("已完成");
  });

  it("§2 确认纪律：点开推进不调端点；取消则不推（不许一点就推）", async () => {
    const user = userEvent.setup();
    const id = await createViaApi();
    renderApp(`/process-instances/${id}`);
    await screen.findByTestId("pi-advance-open", {}, { timeout: 15000 });
    const before = hits.advance;

    await user.click(screen.getByTestId("pi-advance-open"));
    // 弹窗出现了，但端点一次都没被打 —— 「一点就推」在这条断言下当场红。
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(hits.advance, "未点确认就调了 advance —— 一点就推").toBe(before);

    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hits.advance).toBe(before);
    expect(screen.getByTestId("pi-task-1")).toHaveAttribute("data-status", "WAITING_USER");
  });

  it("§3 反推实例：详情可读、无推进按钮、诚实说明与溯源一块不少", async () => {
    const row = derivedFixture();
    store.set(row.instance.id, row);
    renderApp(`/process-instances/${row.instance.id}`);
    expect(await screen.findByTestId("pi-status", {}, { timeout: 15000 })).toHaveTextContent("等待中");
    // 诚实位：模板抄来的平均值，必须标开。
    expect(screen.getByTestId("pi-wait-origin")).toHaveTextContent("抄自流程模板");
    // 没有步骤 ⇒ 明说，不画空表。
    expect(screen.getByTestId("pi-no-tasks")).toHaveTextContent("没有步骤时间线");
    // 不给必失败的按钮（后端对零步骤实例的 advance 恒 400）。
    expect(screen.queryByTestId("pi-advance")).toBeNull();
    // R13 溯源：字段 + 原值都在屏上。
    const sources = screen.getByTestId("pi-sources");
    expect(sources).toHaveTextContent("arrivedDay");
    expect(sources).toHaveTextContent("12");
  });

  it("§4 暗发：process.runtime 关 ⇒ 「功能没开」态，不与「请求失败」混", async () => {
    db.tenantOverrides["process.runtime"] = false;
    renderApp("/process-instances/pinst_mg_demo_P34_iq_9001");
    expect(await screen.findByTestId("pi-disabled", {}, { timeout: 15000 })).toHaveTextContent("未开通");
    expect(screen.queryByTestId("pi-error")).toBeNull();
  });

  it("§5 实例不存在 ⇒ 「找不到」态（不是泛泛的加载失败）", async () => {
    renderApp("/process-instances/pinst_mg_demo_P34_nope");
    expect(await screen.findByTestId("pi-notfound", {}, { timeout: 15000 })).toHaveTextContent("找不到流程实例");
    expect(screen.queryByTestId("pi-error")).toBeNull();
  });

  it("§6 变异反证：拆掉 advance 的写入 ⇒ 主测试红在「状态没变」，不是「按钮点不动」", async () => {
    const user = userEvent.setup();
    const id = await createViaApi();
    renderApp(`/process-instances/${id}`);
    await screen.findByTestId("pi-task-1", {}, { timeout: 15000 });

    // 变异：advance 不落库（请求照收、200 照返）。此后的点击链必须**整条活着** ——
    // 按钮点得开、弹窗出得来、确认点得下、请求打得到；只有「状态没变」。
    advanceWrites = false;
    await user.click(screen.getByTestId("pi-fact-user-check"));
    await user.click(screen.getByTestId("pi-advance-open"));
    await user.click(await screen.findByRole("button", { name: "确认推进" }));
    await waitFor(() => expect(hits.advance, "变异 handler 没被调到 —— 本用例哑了").toBe(1));
    // 弹窗随 200 关闭（点击链活的证据），而状态原地不动（写入被拆的证据）。
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("pi-task-1")).toHaveAttribute("data-status", "WAITING_USER");
    // 主测试 §1 推进② 在同一点断言 RUNNING —— 换这个变异 handler，它会红在那一行，
    // 红因是「状态没变」（本行上面的点击链全绿），不是「按钮点不动」。
  });

  it("§7 入口①：卡点卡片带深链到详情页", async () => {
    // 全局 mock 的 stuck 端点（handlers.ts）下发两条卡点，卡片必须各带一条 /process-instances/<id> 链接。
    renderApp("/v/process-stuck");
    const card = (await screen.findAllByTestId("stuck-card", {}, { timeout: 15000 }))[0]!;
    const link = within(card).getByTestId("stuck-detail-pinst_demo_P17_ord_9001");
    expect(link).toHaveAttribute("href", "/process-instances/pinst_demo_P17_ord_9001");
  });
});
