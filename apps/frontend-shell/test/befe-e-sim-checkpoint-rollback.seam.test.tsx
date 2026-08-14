import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SandboxViewConfig } from "@platform/contracts";
import SandboxView from "@/views/sim/SandboxView";
import { fetchSimCheckpoints, fetchSimSessions, simWorld } from "@/api/endpoints";
import { loginAs } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ① · **沙盘存档「存得进 · 看不见 · 回不去」的接缝门**
 * （门 `befe-seam:check` 载体② 把这两条列作「后端注册了·前端零调用」；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `GET  /a/v1/sim/sessions/:id/checkpoints`   后端 `apps/datacore/src/app.ts:1825`
 *     `POST /a/v1/sim/sessions/:id/rollback`      后端 `apps/datacore/src/app.ts:1832`
 *
 * ── 病灶不是"少了两个 API"，是那颗按钮此前是**单向**的 ───────────────────────────
 * `SandboxView.onCheckpoint` 存完只 toast 一句「检查点已存」，此外再无出口：
 * 清单没有、回滚没有；`simBranch` 虽吃 `checkpointId`，用的却是**当场新存的**那一个
 * （先 `simCheckpoint` 再 `simBranch`），历史存档一个都用不上。
 * 后端 `app.ts:1808` 的注释白纸黑字写着「前端 useQuery 属 WO-1/WO-4 边界，不在本单」——
 * 那张单从没落地，读端就在后端躺了一整程。**接缝断在这一跳，不在任何一半内部。**
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ──────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：桩收什么参数都行，URL 模板/body 序列化根本不参与，
 * 断言恒绿而缺口仍在（本仓假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。
 * 本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**，咬的是链路不是函数。
 *
 * ── MSW 桩与后端为何不会漂移 ──────────────────────────────────────────────────
 * 默认 handler（`src/mocks/handlers.ts`）镜像后端**已有语义**且共用同一把排序尺
 * （`tick → createdAt → id`，后端 app.ts:1826）；回滚照后端 `deleteTicksAfter` 删该 tick 之后的态、
 * 回**当时**那一份世界态（不是把当前态原样回一遍 —— 图省事那样写，回滚断言会恒绿而缺口仍在）。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 抽象占位配置（R14 零行业实体名）—— 沙盘挂载所需，本文件不依赖它的任何数值。 */
const CFG: SandboxViewConfig = {
  tenantId: "tenant-befe-e",
  nodeTypes: ["TypeA"],
  nodeObjectIds: { TypeA: ["obj_a1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["s1"],
  radarDims: [
    { key: "structure", label: "结构" },
    { key: "knowledge", label: "知识" },
    { key: "behavior", label: "行为" },
  ],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function mountSandbox() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 展开右栏「存档与回滚」（rail 默认折叠 —— 判据是「用户点得到」，故真点一次）。 */
async function openCheckpointRail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const sec = await screen.findByTestId("sc-rail-checkpoints");
  await user.click(within(sec).getByText("存档与回滚"));
}

/**
 * 沙盘挂载后 `init()` 会自建一条会话（`SandboxView.tsx:643`）。
 * 会话 id 从**真端点**读（`GET /a/v1/sim/sessions`），不从别的 WO 的 UI 里抠 ——
 * 抠了就把本门的成败绑在一块与本单无关的界面上（那块一改，本门红在错误的地方）。
 */
async function mountedSandboxSessionId(): Promise<string> {
  await screen.findByTestId("sandbox-view");
  let id = "";
  await waitFor(async () => {
    const r = await fetchSimSessions();
    expect(r.items.length, "沙盘挂载后没有建出会话 ⇒ 后面全是空胜").toBeGreaterThan(0);
    id = r.items[0]!.id;
  });
  return id;
}

describe("WO-BEFE-E ① 沙盘存档清单 + 回滚（GET …/checkpoints · POST …/rollback）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("①-A 用户点得到：存两档 → 右栏真出现两行，tick 来自后端不是前端猜的", async () => {
    const user = userEvent.setup();
    mountSandbox();
    const sid = await mountedSandboxSessionId();

    await openCheckpointRail(user);
    // 空态先诚实说「还没有存档」——不是画一张空表让人以为清单坏了。
    expect((await screen.findByTestId("sandbox-checkpoints-empty")).textContent).toContain("还没有存档");

    // 存第一档（tick 0）→ 推进 → 存第二档（tick 更大）。全部走屏上的真按钮。
    await user.click(screen.getByTestId("sandbox-checkpoint-btn"));
    await waitFor(() => expect(screen.getByTestId("sandbox-checkpoints-count").textContent).toContain("1 个存档"));
    await user.click(screen.getByTestId("sandbox-tick-btn"));
    // `ptl-now` 是屏上那根时间轴当前 tick 的读数（来自组件 state ← tick 回包）。
    await waitFor(() => expect(Number(screen.getByTestId("ptl-now").textContent)).toBeGreaterThan(0));
    await user.click(screen.getByTestId("sandbox-checkpoint-btn"));
    await waitFor(() => expect(screen.getByTestId("sandbox-checkpoints-count").textContent).toContain("2 个存档"));

    // 期望值 = 拿同一条 api 层**再打一次真端点**（未 mock），逐条与屏上对齐。
    const truth = await fetchSimCheckpoints(sid);
    // 金丝雀：清单非空，否则下面「逐条相等」是空胜。
    expect(truth.items.length, "存档清单为空 ⇒ 这条用例证明不了任何事").toBe(2);

    const rows = within(screen.getByTestId("sandbox-checkpoints-list")).getAllByTestId(/^sandbox-checkpoint-simcp/);
    expect(rows.length).toBe(2);
    // ★ 顺序是**语义**：用户按它挑回滚点。屏上顺序必须与后端全序一致，不是前端自己排的。
    expect(rows.map((r) => r.getAttribute("data-testid")!.replace(/^sandbox-checkpoint-/, ""))).toEqual(
      truth.items.map((c) => c.id),
    );
    // ★ 每行的 tick 来自响应（第二档的 tick 严格大于第一档 ⇒ 不是写死的 1）。
    expect(rows.map((r) => r.getAttribute("data-tick"))).toEqual(truth.items.map((c) => String(c.tick)));
    expect(Number(rows[1]!.getAttribute("data-tick"))).toBeGreaterThan(Number(rows[0]!.getAttribute("data-tick")));
  });

  it("①-B 真 URL + 真 body：点「回到这一刻」→ POST …/rollback，body.checkpointId = 那一行的 id", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    mountSandbox();
    const sid = await mountedSandboxSessionId();
    await openCheckpointRail(user);
    await user.click(screen.getByTestId("sandbox-checkpoint-btn"));
    await waitFor(() => expect(screen.getByTestId("sandbox-checkpoints-count").textContent).toContain("1 个存档"));

    const cp = (await fetchSimCheckpoints(sid)).items[0]!;
    server.use(
      http.post("*/a/v1/sim/sessions/:id/rollback", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        // 刻意与默认桩**完全不同**的一组数：屏上若还显旧值，就是没投影响应。
        return HttpResponse.json({ curTick: 3, state: { "TypeA#0": { s1: 777 } } });
      }),
    );

    await user.click(screen.getByTestId(`sandbox-rollback-${cp.id}`));
    await waitFor(() => expect(calls.length, "点了按钮一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain(
      `/a/v1/sim/sessions/${encodeURIComponent(sid)}/rollback`,
    );
    // ★ body 是那一行的 id（不是写死的字符串、不是当场新存的那一个）。
    expect(calls[0]!.body).toEqual({ checkpointId: cp.id });
  });

  it("①-C 效果层（本门的要害）：推进后回滚 → 世界态真的退回存档那一刻，且后端侧真被截断", async () => {
    const user = userEvent.setup();
    mountSandbox();
    const sid = await mountedSandboxSessionId();
    await openCheckpointRail(user);

    // 存档（tick 0）→ 推进（世界态变）→ 回滚 → 世界态必须回到存档那一刻。
    await user.click(screen.getByTestId("sandbox-checkpoint-btn"));
    await waitFor(() => expect(screen.getByTestId("sandbox-checkpoints-count").textContent).toContain("1 个存档"));
    const cp = (await fetchSimCheckpoints(sid)).items[0]!;
    const atCheckpoint = await simWorld(sid);

    await user.click(screen.getByTestId("sandbox-tick-btn"));
    await waitFor(async () => {
      const now = await simWorld(sid);
      // 金丝雀：推进真的改变了世界态，否则「回滚把它改回去了」是空胜。
      expect(now.tick, "推进后 tick 没变 ⇒ 下面的回滚断言证明不了任何事").toBeGreaterThan(atCheckpoint.tick);
    });

    await user.click(screen.getByTestId(`sandbox-rollback-${cp.id}`));

    // ★ 后端侧真被拨回（读的是真 `GET …/world`，不是读组件 state）。
    await waitFor(async () => {
      const after = await simWorld(sid);
      expect(after.tick, "回滚后世界 tick 没退回去 ⇒ 回滚只改了屏，没改世界").toBe(atCheckpoint.tick);
      expect(JSON.stringify(after.state)).toBe(JSON.stringify(atCheckpoint.state));
    });
    // ★ 屏上的 tick 轴也跟着退（用的是后端回包里的 curTick，不是前端按 checkpoint.tick 猜的）。
    await waitFor(() => expect(screen.getByTestId("ptl-now").textContent).toBe(String(atCheckpoint.tick)));
  });

  it("①-D 零写死反证：rollback 打成 500 → 屏上存档清单还在、世界态一个字节没动（没有乐观改屏）", async () => {
    const user = userEvent.setup();
    mountSandbox();
    const sid = await mountedSandboxSessionId();
    await openCheckpointRail(user);
    await user.click(screen.getByTestId("sandbox-checkpoint-btn"));
    await waitFor(() => expect(screen.getByTestId("sandbox-checkpoints-count").textContent).toContain("1 个存档"));
    await user.click(screen.getByTestId("sandbox-tick-btn"));

    const cp = (await fetchSimCheckpoints(sid)).items[0]!;
    const before = await simWorld(sid);
    server.use(
      http.post("*/a/v1/sim/sessions/:id/rollback", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "回滚炸了", requestId: "req_r" } }, { status: 500 }),
      ),
    );

    await user.click(screen.getByTestId(`sandbox-rollback-${cp.id}`));
    // 失败后按钮回到可点（不卡在「回滚中…」），且世界态未被前端乐观改写。
    await waitFor(() => expect(screen.getByTestId(`sandbox-rollback-${cp.id}`).textContent).toContain("回到这一刻"));
    const after = await simWorld(sid);
    expect(JSON.stringify(after), "端点 500 了世界态却变了 ⇒ 前端在乐观改屏（那是编出来的数）").toBe(
      JSON.stringify(before),
    );
  });

  it("①-E 不是死组件：「存档与回滚」这一栏真的挂在沙盘右栏，两条 URL 真在 endpoints.ts 里", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view.length, "SandboxView.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(view).toContain(`id: "checkpoints"`);
    expect(view).toContain(`fetchSimCheckpoints`);
    expect(view).toContain(`simRollback`);

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：同样的读法先抓一个**已知必在**的 URL；抓不到说明是读法坏了，而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/checkpoint`");
    expect(eps).toContain("/checkpoints`");
    expect(eps).toContain("/rollback`");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ② GET /a/v1/sim/propagation-rules —— 「有个数、没有内容」
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-E ② 传导规则清单（GET /a/v1/sim/propagation-rules）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  /**
   * 病灶：沙盘顶栏写着「{propagationCount} 传导规则」，就绪面板甚至会警告
   * 「已发布 N 条传导规则，本次一条都没触发」（`SimReadinessPanel.tsx:278`）——
   * 而**哪 N 条**在界面上问不出来 ⇒ 那句警告没有可操作的下一步。
   */
  /**
   * 「本体派生」这一块住在**诊断抽屉**里（`SandboxConsole.tsx:580` 的 `diagOpen`），入口是
   * `sc-diag-toggle`（那颗按钮折叠时也常驻可见）。传导规则清单放这里是对的：它回答的是
   * 「这一屏的骨架从哪来」这类**读数**，不是用户要做的动作 —— 与它解释的那个计数同处一块。
   */
  async function openDiagnostics(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByTestId("sc-diag-toggle"));
    await screen.findByTestId("sc-diag-derived");
  }

  it("②-A 用户看得到：逐条规则来自 `GET /a/v1/sim/propagation-rules`（源→链路→靶 + 系数 + 延迟）", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(
      http.get("*/a/v1/sim/propagation-rules", ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json({
          items: [
            {
              id: "simpr_probe", tenantId: "demo", key: "pr_probe",
              sourceTypeKey: "ProbeSrc", sourceStateVar: "sv_a", viaLinkKey: "PROBE_LINK",
              targetTypeKey: "ProbeTgt", targetStateVar: "sv_b", coefficient: 0.42, delayTicks: 3,
              combine: "sum", decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null,
            },
          ],
        });
      }),
    );
    mountSandbox();
    await mountedSandboxSessionId();
    await openDiagnostics(user);

    await waitFor(() => expect(calls.length, "沙盘挂载后一个规则请求都没发 ⇒ 入口仍是死的").toBeGreaterThan(0));
    expect(calls[0]!, `打错端点：${calls[0]!}`).toContain("/a/v1/sim/propagation-rules");

    // ★ 屏上逐字段来自响应（源/链路/靶/系数/延迟），零写死。
    const row = await screen.findByTestId("sandbox-propagation-pr_probe");
    expect(row.textContent).toContain("ProbeSrc.sv_a");
    expect(row.textContent).toContain("PROBE_LINK");
    expect(row.textContent).toContain("ProbeTgt.sv_b");
    expect(row.textContent).toContain("0.42");
    expect(row.textContent).toContain("3 tick");
  });

  it("②-B 「查不出来」不许塌成「没有规则」：端点 500 → 明说这次没查出来", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/a/v1/sim/propagation-rules", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "规则表炸了", requestId: "req_p" } }, { status: 500 }),
      ),
    );
    mountSandbox();
    await mountedSandboxSessionId();
    await openDiagnostics(user);

    const box = await screen.findByTestId("sandbox-propagation-error");
    expect(box.textContent).toContain("不是");
    expect(screen.queryByTestId("sandbox-propagation-empty"), "读不出来被渲染成「没有规则」⇒ 把「我没找到」说成了「它不存在」").toBeNull();
    expect(screen.queryByTestId("sandbox-propagation-list")).toBeNull();
  });

  it("②-C 真空态与错误态分得开：0 条 → 明写「tick 只会推进时间，状态不会传导」", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/a/v1/sim/propagation-rules", () => HttpResponse.json({ items: [] })));
    mountSandbox();
    await mountedSandboxSessionId();
    await openDiagnostics(user);

    const empty = await screen.findByTestId("sandbox-propagation-empty");
    // 空态必须说清**后果**（tick 推进但不传导），不是一句"暂无数据"。
    expect(empty.textContent).toContain("不会沿链路传导");
    expect(screen.queryByTestId("sandbox-propagation-error"), "空态被渲染成错误态 ⇒ 两件事混了").toBeNull();
  });

  it("②-D 不是死组件：URL 真在 endpoints.ts 里，清单真的挂在沙盘的「本体派生」块", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view).toContain("fetchSimPropagationRules");
    expect(view).toContain(`data-testid="sandbox-propagation-rules"`);
    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：先抓一个**已知必在**的同族 URL。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/a/v1/sim/view-config");
    expect(eps).toContain("/a/v1/sim/propagation-rules");
  });
});
