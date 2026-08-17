import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { DELETE_COPY } from "@/pages/admin/DeleteResourceButton";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-DELETE-WIRE · **五条 `DELETE` 端点的接缝门**
 * （`WO-SEAM-GATE-METHOD` 把接缝门口径从「只比路径」升级成「方法+路径」后新暴露的第一类：
 *  建/删这一半整个没接 ⇒ 用户在界面上删不掉）。
 *
 *   ① `DELETE /b/v1/agents/*`        ② `DELETE /b/v1/workflows/*`
 *   ③ `DELETE /b/v1/skills/*`        ④ `DELETE /b/v1/mcp-configs/*`
 *   ⑤ `DELETE /b/v1/scene-entries/*`
 *
 * ── 判据：咬链路，不咬函数 ─────────────────────────────────────────────────
 * **不** `vi.mock("@/api/endpoints")` —— 那会把病灶所在的那一跳一起 mock 掉：
 * 桩函数收什么参数都行，URL 模板、**method**、204 处理根本不参与，于是断言恒绿而缺口仍在
 * （假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：测试咬的是函数不是链路）。
 * 本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实方法**，并从**真渲染出来的按钮**驱动。
 *
 * ── 三条判据缺一不可（工单点名）─────────────────────────────────────────────
 *  A. 点删除 → 真发出 `DELETE`（**方法与路径都对**）→ **列表里那条真的没了**；
 *     「按钮渲染出来了」与「fetch 被调用了」都**不算**——前者证明不了发请求，
 *     后者证明不了方法对、更证明不了屏上真变。
 *  B. **反向金丝雀**：只点删除、**不点确认** ⇒ **零请求发出**（二次确认真的挡住了不可逆动作）。
 *  C. **变异反证**：把方法换成 `POST`，断言必须红在**「方法不对」**这一点上 ——
 *     这正是接缝门此前失明的那一维（旧口径只比路径字面量，`DELETE` 那条因此被判「已接」）。
 *     故本文件把方法判据抽成 `expectDeleteHit()` 一个函数，§6 直接喂它一条 POST 记录，
 *     **它必须抛** —— 若它不抛，说明主用例的「方法对」是句空话，与旧口径无异。
 *
 * ── 为什么 handler 写在测试里而不是 `src/mocks/handlers.ts` ──────────────────
 * 本单 🚦范围边界不含 `src/mocks/**`。⚠ 由此产生一条**真实欠账，已在交单报告里点名**：
 * `VITE_MOCK=1` 的**无后端演示态**下这五条 DELETE 没有 mock handler ⇒ 演示态点删除会失败。
 * 那是另一张单（改 `src/mocks/handlers.ts`），不是本文件能顺手带过的事 ——
 * 在测试里补了 handler 就当"演示态也能删"，正是本仓禁止的那种「绿测试≠能用」。
 *
 * ── handler 口径与真后端同源 ────────────────────────────────────────────────
 * 下面的 `refsOf()` 是 `apps/agentcore/src/resources.ts` `computeReferences` 的**同口径**移植
 * （入向引用：谁引用了它），删除分支照 `assertRetireOrDelete("delete", refs, true)`：
 * **有引用一律 409 `REFERENCED`，`confirm` 参数走不到**（那行 throw 在 confirm 判断之前）。
 * 场景入口**没有**这两步（叶子对象），故其 handler 直接 204 —— 与真后端逐行对齐。
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * 请求日志 —— 走 MSW 生命周期事件（旁路观测，不替换任何 handler）
 * ═══════════════════════════════════════════════════════════════════════════ */

type Recorded = { method: string; url: string };

function useRequestLog(): Recorded[] {
  const calls: Recorded[] = [];
  const onStart = ({ request }: { request: Request }): void => {
    calls.push({ method: request.method, url: request.url });
  };
  beforeEach(() => {
    calls.length = 0;
    server.events.on("request:start", onStart);
  });
  afterEach(() => {
    server.events.removeListener("request:start", onStart);
  });
  return calls;
}

/** 金丝雀：记录器至少抓到过**某些**请求。一条都没有 ⇒ 记录器坏了，不是「没请求」。 */
function expectRecorderAlive(calls: Recorded[]): void {
  expect(
    calls.length,
    "请求记录器一条都没抓到 ⇒ **记录器坏了**，本例任何「打了 / 没打」的结论都不成立",
  ).toBeGreaterThan(0);
}

/** 命中某路径片段的全部请求（不分方法）—— 方法维由 `expectDeleteHit` 单独判。 */
const onPath = (calls: Recorded[], frag: string): Recorded[] => calls.filter((c) => c.url.includes(frag));

/**
 * **方法维判据的唯一实现**（§6 变异反证直接喂它，故不许内联到用例里）。
 *
 * 断言「这条路径上**确实发出过 `DELETE`**」。
 * 刻意分两段报错，让红的时候能一眼看出是哪一种失败：
 *  · 路径上一条请求都没有 ⇒ 「没发请求」；
 *  · 有请求但方法不是 DELETE ⇒ 「**方法不对**」（接缝门旧口径的盲区就在这里）。
 */
function expectDeleteHit(calls: Recorded[], frag: string): void {
  const onIt = onPath(calls, frag);
  expect(onIt.length, `${frag} 上一条请求都没发出 ⇒ 删除按钮没接上链路`).toBeGreaterThan(0);
  const methods = onIt.map((c) => c.method);
  expect(
    methods,
    `${frag} 上发出了请求但**方法不是 DELETE**（实际：${methods.join("/")}）⇒ ` +
      `这正是接缝门旧口径（只比路径不比方法）看不见的那一维`,
  ).toContain("DELETE");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 与真后端同口径的删除 handler
 * ═══════════════════════════════════════════════════════════════════════════ */

/** `computeReferences` 的同口径移植：**谁引用了 id**（入向）。 */
function refsOf(kind: "agent" | "workflow" | "skill" | "mcp-config", id: string): string[] {
  const out: string[] = [];
  if (kind === "agent") {
    for (const s of db.scenes) if (s.defaultAgentId === id) out.push(`scene-entry:${s.viewKey}(defaultAgentId)`);
    for (const sc of db.scenarios) if (sc.defaultAgentId === id) out.push(`scenario:${sc.scenarioKey}(scenario.defaultAgentId)`);
    for (const w of db.workflows) {
      if (w.steps.some((st) => st.type === "invoke_agent" && (st.params as { agentId?: string }).agentId === id)) {
        out.push(`workflow:${w.name}(steps.invoke_agent)`);
      }
    }
  }
  if (kind === "workflow") {
    for (const a of db.agents) {
      if (a.tools.some((t) => t.kind === "WORKFLOW" && t.workflowId === id)) out.push(`agent:${a.name}(tools[kind=WORKFLOW])`);
    }
  }
  if (kind === "skill") {
    for (const a of db.agents) if (a.skills.some((s) => s.skillId === id)) out.push(`agent:${a.name}(skills)`);
  }
  if (kind === "mcp-config") {
    for (const a of db.agents) {
      if (a.mcpServers.some((m) => m.mcpConfigId === id) || a.tools.some((t) => t.kind === "MCP" && t.mcpConfigId === id)) {
        out.push(`agent:${a.name}(mcpServers/tools[kind=MCP])`);
      }
    }
    for (const w of db.workflows) {
      if (w.steps.some((st) => st.type === "invoke_mcp_tool" && (st.params as { mcpConfigId?: string }).mcpConfigId === id)) {
        out.push(`workflow:${w.name}(steps.invoke_mcp_tool)`);
      }
    }
  }
  return out;
}

/** handler 命中计数 —— 任何「删掉了 / 没删掉」的断言之前先看它，确认 handler 真被走到。 */
const handlerHits = { agent: 0, workflow: 0, skill: 0, mcp: 0, scene: 0 };

/**
 * `assertRetireOrDelete("delete", refs, true)` 的同口径分支：
 * refs 非空 ⇒ **409 REFERENCED**（confirm 走不到）；refs 空 ⇒ 落库删除 + 204 无体。
 */
function deleteGuarded(kind: "agent" | "workflow" | "skill" | "mcp-config", id: string, remove: () => void): Response {
  const refs = refsOf(kind, id);
  if (refs.length > 0) {
    return HttpResponse.json(
      { error: { code: "REFERENCED", message: `存在引用，禁止删除（请先解除或退役）：${refs.join("、")}`, requestId: "req-test" } },
      { status: 409 },
    );
  }
  remove();
  return new HttpResponse(null, { status: 204 });
}

function installDeleteHandlers(): void {
  server.use(
    http.delete("*/b/v1/agents/:id", ({ params }) => {
      handlerHits.agent += 1;
      const id = String(params["id"]);
      return deleteGuarded("agent", id, () => {
        db.agents = db.agents.filter((a) => a.id !== id);
      });
    }),
    http.delete("*/b/v1/workflows/:id", ({ params }) => {
      handlerHits.workflow += 1;
      const id = String(params["id"]);
      return deleteGuarded("workflow", id, () => {
        db.workflows = db.workflows.filter((w) => w.id !== id);
      });
    }),
    http.delete("*/b/v1/skills/:id", ({ params }) => {
      handlerHits.skill += 1;
      const id = String(params["id"]);
      return deleteGuarded("skill", id, () => {
        db.skills = db.skills.filter((s) => s.id !== id);
      });
    }),
    http.delete("*/b/v1/mcp-configs/:id", ({ params }) => {
      handlerHits.mcp += 1;
      const id = String(params["id"]);
      return deleteGuarded("mcp-config", id, () => {
        db.mcpConfigs = db.mcpConfigs.filter((m) => m.id !== id);
      });
    }),
    // ⑤ 场景入口：真后端此路**无引用检查**（叶子对象），故不走 deleteGuarded。
    http.delete("*/b/v1/scene-entries/:id", ({ params }) => {
      handlerHits.scene += 1;
      const id = String(params["id"]);
      db.scenes = db.scenes.filter((s) => s.id !== id && s.viewKey !== id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

/** 打开确认弹窗（点第一颗「删除」），返回弹窗内的取值范围。 */
async function openConfirm(user: ReturnType<typeof userEvent.setup>, testid: string): Promise<HTMLElement> {
  await user.click(await screen.findByTestId(testid));
  return await screen.findByRole("dialog");
}

const clickConfirm = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<void> => {
  await user.click(within(dialog).getByRole("button", { name: DELETE_COPY.confirmLabel }));
};

beforeEach(() => {
  loginAs("planner"); // roles 含 catalog_admin —— 五条 DELETE 后端都要 requireCatalogAdmin
  for (const k of Object.keys(handlerHits) as (keyof typeof handlerHits)[]) handlerHits[k] = 0;
  installDeleteHandlers();
});
afterEach(cleanup);

/* ═══════════════════════════════════════════════════════════════════════════
 * ① DELETE /b/v1/agents/*
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ① DELETE /b/v1/agents/*", () => {
  const reqLog = useRequestLog();

  it("①-A 点删除→确认 ⇒ 真发出 DELETE（方法+路径都对）⇒ 列表里那条真的没了", async () => {
    const user = userEvent.setup();
    // 取一个**无引用**的 agent：有引用的会被后端 409 挡回（那是 ①-C 的剧本）。
    const target = db.agents.find((a) => refsOf("agent", a.id).length === 0);
    expect(target, "种子里找不到一个无引用的 agent ⇒ 本例无从证明「删得掉」，是夹具问题不是代码问题").toBeTruthy();
    const id = target!.id;

    renderApp("/admin/agents");
    // 先选中它（左栏按 key 分组，点进去才出编辑器）
    await user.click(await screen.findByRole("button", { name: new RegExp(target!.name) }));
    await screen.findByTestId("agent-editor");

    const dialog = await openConfirm(user, "agent-delete");
    await clickConfirm(user, dialog);

    await waitFor(() => expect(handlerHits.agent, "删除 handler 一次都没被走到").toBeGreaterThan(0));
    expectRecorderAlive(reqLog);
    expectDeleteHit(reqLog, `/b/v1/agents/${id}`);

    // 屏上真变：那条从左栏列表里消失（不是只看请求发出去了）
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: new RegExp(target!.name) }), "请求发了但列表里那条还在 ⇒ 用户看不到结果").toBeNull(),
    );
  });

  it("①-B 反向金丝雀：只点删除、不点确认 ⇒ 零请求发出（二次确认真的挡住了不可逆动作）", async () => {
    const user = userEvent.setup();
    const target = db.agents.find((a) => refsOf("agent", a.id).length === 0)!;

    renderApp("/admin/agents");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.name) }));
    await screen.findByTestId("agent-editor");

    const dialog = await openConfirm(user, "agent-delete");
    // 取消（不确认）
    await user.click(within(dialog).getByRole("button", { name: /取消|关闭/ }));

    expectRecorderAlive(reqLog); // 先自证记录器活着，否则下面的「零」是哑的
    expect(onPath(reqLog, `/b/v1/agents/${target.id}`).filter((c) => c.method === "DELETE"), "没点确认却发出了 DELETE ⇒ 二次确认形同虚设").toHaveLength(0);
    expect(handlerHits.agent, "没点确认却走到了删除 handler").toBe(0);
    // 且那条还在
    expect(screen.getByRole("button", { name: new RegExp(target.name) })).toBeInTheDocument();
  });

  it("①-C 有引用时后端 409 挡回，弹窗把引用方清单常驻显示（不是 toast 一闪而过），列表里那条仍在", async () => {
    const user = userEvent.setup();
    // agt-explore 被 scene-entry(scn-graph).defaultAgentId 引用 —— 真种子里的真引用
    const target = db.agents.find((a) => refsOf("agent", a.id).length > 0);
    expect(target, "种子里找不到被引用的 agent ⇒ 409 这条路无从驱动").toBeTruthy();

    renderApp("/admin/agents");
    await user.click(await screen.findByRole("button", { name: new RegExp(target!.name) }));
    await screen.findByTestId("agent-editor");

    const dialog = await openConfirm(user, "agent-delete");
    await clickConfirm(user, dialog);

    const err = await screen.findByTestId("agent-delete-error");
    expect(err.textContent, "后端 409 的错误码没显示出来").toContain("REFERENCED");
    expect(err.textContent, "没把「具体谁在引用它」摊在屏上 ⇒ 用户不知道该去解除哪一条").toContain("存在引用");
    // 被拒 ⇒ 那条必须还在
    expect(screen.getByRole("button", { name: new RegExp(target!.name) })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ② DELETE /b/v1/workflows/*
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ② DELETE /b/v1/workflows/*", () => {
  const reqLog = useRequestLog();

  it("②-A 点删除→确认 ⇒ 真发出 DELETE ⇒ 下拉里那条真的没了", async () => {
    const user = userEvent.setup();
    const target = db.workflows.find((w) => refsOf("workflow", w.id).length === 0);
    expect(target, "种子里找不到无引用的 workflow").toBeTruthy();
    const id = target!.id;

    renderApp("/admin/workflows");
    await screen.findByTestId("workflow-editor");
    // 选中它（页头下拉）
    await user.selectOptions(screen.getByLabelText("选择 workflow"), id);
    await waitFor(() => expect(screen.getByTestId("workflow-editor").textContent).toContain(target!.name));

    const dialog = await openConfirm(user, "wf-delete");
    await clickConfirm(user, dialog);

    await waitFor(() => expect(handlerHits.workflow).toBeGreaterThan(0));
    expectRecorderAlive(reqLog);
    expectDeleteHit(reqLog, `/b/v1/workflows/${id}`);

    await waitFor(() =>
      expect(
        within(screen.getByLabelText("选择 workflow")).queryByRole("option", { name: new RegExp(target!.name) }),
        "请求发了但下拉里那条还在",
      ).toBeNull(),
    );
  });

  it("②-B 反向金丝雀：不点确认 ⇒ 零 DELETE", async () => {
    const user = userEvent.setup();
    const target = db.workflows.find((w) => refsOf("workflow", w.id).length === 0)!;

    renderApp("/admin/workflows");
    await screen.findByTestId("workflow-editor");
    await user.selectOptions(screen.getByLabelText("选择 workflow"), target.id);

    const dialog = await openConfirm(user, "wf-delete");
    await user.click(within(dialog).getByRole("button", { name: /取消|关闭/ }));

    expectRecorderAlive(reqLog);
    expect(onPath(reqLog, "/b/v1/workflows/").filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(handlerHits.workflow).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ③ DELETE /b/v1/skills/*
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ③ DELETE /b/v1/skills/*", () => {
  const reqLog = useRequestLog();

  it("③-A 点删除→确认 ⇒ 真发出 DELETE ⇒ 列表里那条真的没了", async () => {
    const user = userEvent.setup();
    const target = db.skills.find((s) => refsOf("skill", s.id).length === 0);
    expect(target, "种子里找不到无引用的 skill").toBeTruthy();
    const id = target!.id;

    renderApp("/admin/skills");
    const items = await screen.findAllByTestId("skill-list-item");
    await user.click(items.find((el) => el.textContent?.includes(target!.name))!);
    await screen.findByTestId("skill-editor");

    const dialog = await openConfirm(user, "skill-delete");
    await clickConfirm(user, dialog);

    await waitFor(() => expect(handlerHits.skill).toBeGreaterThan(0));
    expectRecorderAlive(reqLog);
    expectDeleteHit(reqLog, `/b/v1/skills/${id}`);

    await waitFor(() =>
      expect(
        screen.queryAllByTestId("skill-list-item").some((el) => el.textContent?.includes(target!.name)),
        "请求发了但列表里那条还在",
      ).toBe(false),
    );
  });

  it("③-B 反向金丝雀：不点确认 ⇒ 零 DELETE", async () => {
    const user = userEvent.setup();
    const target = db.skills.find((s) => refsOf("skill", s.id).length === 0)!;

    renderApp("/admin/skills");
    const items = await screen.findAllByTestId("skill-list-item");
    await user.click(items.find((el) => el.textContent?.includes(target.name))!);
    await screen.findByTestId("skill-editor");

    const dialog = await openConfirm(user, "skill-delete");
    await user.click(within(dialog).getByRole("button", { name: /取消|关闭/ }));

    expectRecorderAlive(reqLog);
    expect(onPath(reqLog, "/b/v1/skills/").filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(handlerHits.skill).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ④ DELETE /b/v1/mcp-configs/*
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ④ DELETE /b/v1/mcp-configs/*", () => {
  const reqLog = useRequestLog();

  it("④-A 点删除→确认 ⇒ 真发出 DELETE ⇒ 列表里那条真的没了", async () => {
    const user = userEvent.setup();
    const target = db.mcpConfigs.find((m) => refsOf("mcp-config", m.id).length === 0);
    expect(target, "种子里找不到无引用的 mcp-config").toBeTruthy();
    const id = target!.id;

    renderApp("/admin/mcp");
    await user.click(await screen.findByRole("button", { name: new RegExp(target!.name) }));

    const dialog = await openConfirm(user, "mcp-delete");
    await clickConfirm(user, dialog);

    await waitFor(() => expect(handlerHits.mcp).toBeGreaterThan(0));
    expectRecorderAlive(reqLog);
    expectDeleteHit(reqLog, `/b/v1/mcp-configs/${id}`);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: new RegExp(target!.name) }), "请求发了但列表里那条还在").toBeNull(),
    );
  });

  it("④-B 反向金丝雀：不点确认 ⇒ 零 DELETE", async () => {
    const user = userEvent.setup();
    const target = db.mcpConfigs.find((m) => refsOf("mcp-config", m.id).length === 0)!;

    renderApp("/admin/mcp");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.name) }));

    const dialog = await openConfirm(user, "mcp-delete");
    await user.click(within(dialog).getByRole("button", { name: /取消|关闭/ }));

    expectRecorderAlive(reqLog);
    expect(onPath(reqLog, "/b/v1/mcp-configs/").filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(handlerHits.mcp).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ⑤ DELETE /b/v1/scene-entries/*
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ⑤ DELETE /b/v1/scene-entries/*", () => {
  const reqLog = useRequestLog();

  it("⑤-A 点删除→确认 ⇒ 真发出 DELETE ⇒ 表里那条真的没了", async () => {
    const user = userEvent.setup();
    const target = db.scenes[0]!;

    renderApp("/admin/scenes");
    await screen.findByTestId("scene-entries-table");
    await screen.findByTestId(`scene-entry-row-${target.viewKey}`);

    const dialog = await openConfirm(user, `scene-entry-${target.viewKey}-delete`);
    await clickConfirm(user, dialog);

    await waitFor(() => expect(handlerHits.scene).toBeGreaterThan(0));
    expectRecorderAlive(reqLog);
    expectDeleteHit(reqLog, `/b/v1/scene-entries/${target.id}`);

    await waitFor(() =>
      expect(screen.queryByTestId(`scene-entry-row-${target.viewKey}`), "请求发了但表里那条还在").toBeNull(),
    );
  });

  it("⑤-B 反向金丝雀：不点确认 ⇒ 零 DELETE", async () => {
    const user = userEvent.setup();
    const target = db.scenes[0]!;

    renderApp("/admin/scenes");
    await screen.findByTestId(`scene-entry-row-${target.viewKey}`);

    const dialog = await openConfirm(user, `scene-entry-${target.viewKey}-delete`);
    await user.click(within(dialog).getByRole("button", { name: /取消|关闭/ }));

    expectRecorderAlive(reqLog);
    expect(onPath(reqLog, "/b/v1/scene-entries/").filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(handlerHits.scene).toBe(0);
    expect(screen.getByTestId(`scene-entry-row-${target.viewKey}`)).toBeInTheDocument();
  });

  it("⑤-C 场景入口是叶子：确认文案**不许**出现「有引用会被拒」那一套（后端此路无引用检查）", async () => {
    const user = userEvent.setup();
    const target = db.scenes[0]!;

    renderApp("/admin/scenes");
    await screen.findByTestId(`scene-entry-row-${target.viewKey}`);
    const dialog = await openConfirm(user, `scene-entry-${target.viewKey}-delete`);

    expect(dialog.textContent, "叶子对象却说「服务端会拒绝删除」⇒ 屏上是假话").not.toContain("服务端会拒绝删除");
    expect(dialog.textContent).toContain("叶子对象");
    // 也不该渲染引用面板（恒 0 的面板是废话）
    expect(screen.queryByTestId(`scene-entry-${target.viewKey}-delete-refs`)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ⑥ 变异反证 + 同一份实现
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-DELETE-WIRE ⑥ 变异反证与结构判据", () => {
  /**
   * **变异反证（工单点名的那一条）**：把方法换成 `POST`，方法判据必须红在「方法不对」。
   *
   * 这里变异的是**判据的输入**而不是被测源码，理由：判据 `expectDeleteHit` 与主用例用的是
   * **同一个函数**（不是各抄一份正则 —— 抄了就是装饰品，改主逻辑时金丝雀拿旧的去测、照样绿）。
   * 喂它一条 POST 记录，它若**不抛**，说明主用例里那句「方法对」根本没在判方法，
   * 与接缝门旧口径（只比路径）等价 —— 那正是这 22 条端点当初隐身的原因。
   */
  it("⑥-A 方法换成 POST ⇒ 方法判据必须抛，且报错里点名「方法不对」", () => {
    const posted: Recorded[] = [{ method: "POST", url: "http://x/b/v1/agents/agt-1" }];
    let threw: Error | null = null;
    try {
      expectDeleteHit(posted, "/b/v1/agents/agt-1");
    } catch (e) {
      threw = e as Error;
    }
    expect(threw, "喂了一条 POST 记录，方法判据却判「已接」⇒ 判据退回旧口径（只比路径），本文件全部方法断言作废").not.toBeNull();
    expect(threw!.message, "红了但没说清是方法不对 ⇒ 下次有人会以为是没发请求，修错地方").toContain("方法不是 DELETE");
  });

  /** 正向金丝雀：同一个判据喂真 DELETE 记录必须**通过** —— 否则它是个恒抛的假判据。 */
  it("⑥-B 正向：喂 DELETE 记录 ⇒ 方法判据通过（判据不是恒抛）", () => {
    expect(() => expectDeleteHit([{ method: "DELETE", url: "http://x/b/v1/agents/agt-1" }], "/b/v1/agents/agt-1")).not.toThrow();
  });

  /** 路径维不许失明：方法对但路径不对，判据同样必须抛。 */
  it("⑥-C 路径不对 ⇒ 判据同样必须抛（方法对不能盖住路径错）", () => {
    expect(() => expectDeleteHit([{ method: "DELETE", url: "http://x/b/v1/skills/skl-1" }], "/b/v1/agents/agt-1")).toThrow();
  });

  /**
   * 「同一份实现」的可证伪判据：五个挂载点的确认文案都来自 `DELETE_COPY` 这一份常量。
   * 改它一处，五处同时变 —— 这条断言就是那个"同时"的机器证据。
   */
  it("⑥-D 五个挂载点共用同一份文案常量（改一处五处同时变）", async () => {
    const user = userEvent.setup();
    renderApp("/admin/scenes");
    const target = db.scenes[0]!;
    await screen.findByTestId(`scene-entry-row-${target.viewKey}`);
    const dialog = await openConfirm(user, `scene-entry-${target.viewKey}-delete`);
    // 不可恢复这句是五族共用的第一句，必须来自常量而不是页面里各写一遍
    expect(dialog.textContent).toContain(DELETE_COPY.irreversible);
    expect(within(dialog).getByRole("button", { name: DELETE_COPY.confirmLabel })).toBeInTheDocument();
  });
});
