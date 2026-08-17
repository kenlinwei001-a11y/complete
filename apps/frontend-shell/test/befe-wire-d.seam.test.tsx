import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ApproverResolutionSchema, DecisionGraphSchema, type SandboxViewConfig } from "@platform/contracts";
import { fetchOrgAuthorities, fetchOrgChart, fetchOrgDelegations, launchScenario } from "@/api/endpoints";
import SandboxView from "@/views/sim/SandboxView";
import { db } from "@/mocks/db";
import { checkedTree, factHits } from "./factlock";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-D · **13 条「后端注册了、前端零调用方」端点的接缝门**
 * （门 `befe-seam:check` 载体② 照出来的；断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * 分四组：org 5 · causal-graphs 2 · growth 3 · scenarios 3。
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：桩函数收什么参数都行，URL 模板、method、body 序列化
 * 根本不参与，于是断言恒绿而缺口仍在。本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**
 * ——咬的是链路，不是函数（假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 就死在这上面）。
 *
 * ── 判据「用户点得到」而不是「API 层有函数」──────────────────────────────────
 * 每条端点都从**真实渲染出来的可见控件**驱动：真 route 渲染 → 找到那个按钮/开关 → 点它 →
 * 断言请求真发出（URL+method+body）**且屏上真变**。只断言"请求发出了"不够 —— 那证明不了用户看得见结果。
 *
 * ── entitlement 前置（这一条是本单最容易踩空的地方）────────────────────────────
 * `org.world` 是**真暗发**（同时列进后端 `WORLD_DARK_LAUNCH_FEATURES` ⇒ battery 模板 all-on 也跳过它）
 * ⇒ 对 demo 租户默认**关**，`/admin/org` 默认 404。故 org 组每条用例先开租户 override ——
 * 这与真实开通动作（`POST /a/v1/tenants/:id/features`）等价，不是测试作弊。
 * 反过来 `decision.causal-graph` **不在**任何暗发集合里 ⇒ 被模板 all-on 顶开 ⇒ 默认就是开的，无需 override。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * 在整个 `src/` 里找**生产调用点**，返回命中的文件相对路径（按路径排序，全给出）。
 *
 * ⚠ 为什么不是 `readRepoFile("<写死的文件>")`（2026-08-14 WO-FE-RED-7 实测的坑）：
 * 原写法把探针钉死在 `src/views/DecisionPlayView.tsx` 上。WO-ORDER-JOURNEY 把 5 区推演
 * **整体搬进** `src/views/DecisionPlayPanel.tsx`（`DecisionPlayView.tsx` 只剩 40 行的壳），
 * 于是这条断言当场变红 —— 而**代码一点毛病没有，搬家而已**。
 * 「读源码找字符串」的探针天生会被搬家打断：它守的命题是
 * **「这个组件有生产调用方（不是只有 test 引用）」**，
 * 而**文件名并不度量这件事** —— 又一次「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 * 改成全 `src/` 扫描后，搬到哪个文件都照样咬得住，只有真变成死代码才红。
 *
 * 复验命令（与本函数同义）：
 *   grep -rn '<CausalGraphPanel source={{ kind: "decision"' apps/frontend-shell/src
 *
 * ── 2026-08-16 WO-FACTLOCK-TRIAGE 改：**扫描/剥注释/命中判据一律下沉到 `./factlock`** ──────
 * 原实现自己走了一遍 `readdirSync` + 裸 `includes`，与 `./factlock` 是**同一概念的第二套实现**，
 * 且缺了关键一步：**不剥注释**。于是它只堵住了「搬家假红」，没堵住「注释假绿」——
 * 在源码里留一句 `// TODO: 接 publishScenarioChain` 就能把删掉的接线盖成绿的，
 * 而那正是 `./factlock` 顶注记的 `buildCadenceGates` 病样（命中的是注释与 import 行）。
 * 现在两者共用一份实现：改判据只有一处可改，金丝雀（`checkedTree` 内建四条）也就不会变成装饰品。
 */
function findInSrc(fragment: string | RegExp): string[] {
  /*
   * `checkedTree` 自带四条金丝雀（扫描面下界 / 已知必中 / 注释不算代码 / 代码没被当注释吃掉），
   * 任何一条挂了当场红的是「工具坏了」，不是「事实没了」—— 见 `./factlock` 顶注。
   * knownHit 取本文件必用的 `<CausalGraphPanel`：它同时是下面那条金丝雀断言的探针，
   * 一处坏两处一起红，不会出现「金丝雀绿而主判据瞎」。
   */
  return factHits(checkedTree("apps/frontend-shell/src", "<CausalGraphPanel", 100), fragment);
}

/** 正则版（用法形探针要它：`queryFn: fn` 与 `fn(` 两种形态一次收）。 */
const findInSrcRe = (re: RegExp): string[] => findInSrc(re);

/**
 * 请求日志 —— 走 **MSW 生命周期事件**（`server.events.on("request:start")`），**不**替换任何 handler。
 *
 * 这一点是刻意的：本文件第一版用的是「注册一个只记账、返回 undefined 让它落回默认 handler」的 spy，
 * 而「返回 undefined 会不会真的落回下一个 handler」是我**没实测过**的假设。
 * 假设若错，被观测的那条链就被我自己的 spy 顶掉了 —— 断言从此在测 spy，不在测链路。
 * 生命周期事件是**旁路观测**：默认 handler 照常跑，我只在旁边记账，不改变被测对象。
 *
 * ⚠ 用它下「这条 URL 打了 / 没打」结论之前先跑 `expectRecorderAlive()` 金丝雀 ——
 * 记录器自己坏了（事件没订阅上）会让每条**否定**断言恒真（铁律 0.6：报否定结论先自证工具）。
 */
type Recorded = { method: string; url: string; body?: unknown };
function useRequestLog(): Recorded[] {
  const calls: Recorded[] = [];
  const onStart = ({ request }: { request: Request }): void => {
    const rec: Recorded = { method: request.method, url: request.url };
    calls.push(rec);
    // body 从**克隆**里读（原 Request 留给 handler，绝不消费它）；异步落位，故断言侧一律 waitFor。
    if (request.method !== "GET" && request.method !== "HEAD") {
      request
        .clone()
        .text()
        .then((t) => {
          rec.body = t ? (JSON.parse(t) as unknown) : null;
        })
        .catch(() => {
          rec.body = null;
        });
    }
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
/** 金丝雀：记录器至少抓到过**某些**请求。一条都没有 ⇒ 记录器坏了，不是"没请求"。 */
function expectRecorderAlive(calls: Recorded[]): void {
  expect(calls.length, "请求记录器一条都没抓到 ⇒ **记录器坏了**，本例任何「打了/没打」的结论都不成立").toBeGreaterThan(0);
}
/** 命中某片段的那些请求（片段取自被测端点的真实路径）。 */
const hits = (calls: Recorded[], frag: string): Recorded[] => calls.filter((c) => c.url.includes(frag));

/* ═══════════════════════════════════════════════════════════════════════════
 * ① 组织世界 —— 5 条：chart / authorities / delegations / availability / approvers.resolve
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-D ① 组织世界（/a/v1/org 五条）", () => {
  const reqLog = useRequestLog();

  beforeEach(() => {
    loginAs("planner"); // roles = planner+admin+catalog_admin+tenant_admin ⇒ 写面（availability）够权
    db.tenantOverrides["org.world"] = true; // 真暗发：不开就是 404（见文件顶注）
  });
  afterEach(() => {
    delete db.tenantOverrides["org.world"];
    cleanup();
  });

  it("①-A 用户点得到：/admin/org 三个只读区的每一行都来自那三条端点的响应（再打一次真 API 逐条对账）", async () => {
    renderApp("/admin/org");
    const page = await screen.findByTestId("org-world-page");
    await waitFor(() => expect(page.getAttribute("data-ready"), "三条查询没全落地 ⇒ 下面的断言在空表上恒真").toBe("1"));

    // 三条端点真的被打了（旁路观测；先自证记录器活着）
    expectRecorderAlive(reqLog);
    for (const frag of ["/a/v1/org/chart", "/a/v1/org/authorities", "/a/v1/org/delegations"]) {
      expect(hits(reqLog, frag).length, `页面渲染了却没打 ${frag} ⇒ 那一区的数据是编的`).toBeGreaterThan(0);
    }

    // 期望值 = 拿同一条 api 层**再打一次真端点**（未 mock）。屏上若与它不符，就是页面在编。
    const [chart, auth, del] = await Promise.all([fetchOrgChart(), fetchOrgAuthorities(), fetchOrgDelegations()]);
    // 金丝雀：三份数据都非空，否则下面「逐条相等」是空胜。
    expect(chart.persons.length, "组织里一个人都没有 ⇒ 这条用例证明不了任何事").toBeGreaterThan(0);
    expect(auth.authorities.length, "一条职权都没有 ⇒ 空胜").toBeGreaterThan(0);
    expect(del.delegations.length, "一条代理都没有 ⇒ 代理链断言无从谈起").toBeGreaterThan(0);

    // ① chart：三层各自的行数与 orgKey 逐条对上
    expect(within(screen.getByTestId("org-departments")).getAllByTestId(/^org-node-/)).toHaveLength(chart.departments.length);
    expect(within(screen.getByTestId("org-roles")).getAllByTestId(/^org-node-/)).toHaveLength(chart.roles.length);
    for (const p of chart.persons) expect(screen.getByTestId(`org-person-${p.orgKey}`)).toBeInTheDocument();

    // ② authorities：升级序这个**数**必须来自响应（它是"上浮到谁"的排序依据，写死了就全错）
    for (const a of auth.authorities) {
      expect(screen.getByTestId(`org-rank-${a.authorityKey}`).textContent).toBe(String(a.escalationRank));
    }
    // 「不设限」与「上限为 0」不许混：销售经理那条有金额上限，屏上必须是那个真数
    expect(screen.getByTestId("org-limits-auth_sales_order").textContent ?? "").toContain((5_000_000).toLocaleString("zh-CN"));

    // ③ delegations：被代理人/代理人显示成**中文名**（页面拿 chart 解 id），不是裸 principalId
    for (const d of del.delegations) {
      expect(
        screen.getByTestId(`org-delegation-${d.delegationKey}`).textContent,
        "代理行仍显示裸 principalId ⇒ 没跟 chart 对上",
      ).not.toContain(d.fromPrincipalRef);
    }
  });

  it("①-B 在岗开关真打 PATCH（真 URL + 真 method + 真 body），且屏上徽标当场翻转", async () => {
    renderApp("/admin/org");
    await waitFor(() => expect(screen.getByTestId("org-world-page").getAttribute("data-ready")).toBe("1"));

    expect(screen.getByTestId("org-available-p_zhang_ming").getAttribute("data-available")).toBe("1");
    fireEvent.click(screen.getByTestId("org-availability-toggle-p_zhang_ming"));

    // ⚠ 这里**刻意不覆盖 handler**（第一版覆盖了，结果：PATCH 桩不改 mock 的组织态 ⇒
    //   失效后重取 chart 拿回的还是 available:true，屏上永远翻不过来。桩把被测的那条链自己掐了）。
    //   旁路记账 + 真 handler ⇒ 「请求真发出」与「屏上真变」两件事同时可断言。
    await waitFor(() => expect(hits(reqLog, "/a/v1/org/principals/prin-p-zhangming/availability").length, "点了开关一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    const patched = hits(reqLog, "/a/v1/org/principals/prin-p-zhangming/availability")[0]!;
    expect(patched.method).toBe("PATCH");
    await waitFor(() => expect(patched.body, "body 没带上 available（或带成了字符串）").toEqual({ available: false }));
    await waitFor(() =>
      expect(screen.getByTestId("org-available-p_zhang_ming").getAttribute("data-available"), "请求发了但屏上没变 = 只发不显").toBe("0"),
    );
  });

  it("①-C 解析审批人：body 逐字段是用户在表单里填的那些，屏上 eligible/blockers 全来自响应", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("*/a/v1/org/approvers/resolve", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        // 刻意与默认桩**完全不同**的一组数：屏上若还显默认答案，就是写死的。
        return HttpResponse.json(
          ApproverResolutionSchema.parse({
            matter: body,
            eligible: [{
              principalId: "prin-probe", orgKey: "p_probe", name: "探针甲", title: "探针职务",
              authorityKey: "auth_probe", authorityName: "探针职权", scope: "order", escalationRank: 77,
              via: "delegated", delegatedFrom: "prin-p-zhangming", available: true, workload: 41, platformRoles: [],
            }],
            blockers: [{ authorityKey: "auth_blocked", authorityName: "被挡职权", principalId: "prin-x", name: "探针乙", escalationRank: 88, reasons: ["探针原因一"] }],
            stuck: false,
            diagnosis: "",
          }),
        );
      }),
    );
    renderApp("/admin/org");
    await waitFor(() => expect(screen.getByTestId("org-world-page").getAttribute("data-ready")).toBe("1"));

    fireEvent.change(screen.getByTestId("org-matter-scope"), { target: { value: "investment" } });
    fireEvent.change(screen.getByTestId("org-matter-amount"), { target: { value: "12345678" } });
    fireEvent.change(screen.getByTestId("org-matter-margin"), { target: { value: "3.5" } });
    fireEvent.change(screen.getByTestId("org-matter-importance"), { target: { value: "strategic" } });
    fireEvent.click(screen.getByTestId("org-matter-crossbase"));
    fireEvent.click(screen.getByTestId("org-matter-capex"));
    fireEvent.change(screen.getByTestId("org-matter-asof"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByTestId("org-resolve-run"));

    await waitFor(() => expect(bodies.length, "点了「解析审批人」一个请求都没发").toBe(1));
    // ★ 七个字段全部来自表单，一个都不许是写死的默认值。
    expect(bodies[0]).toEqual({
      scope: "investment", amount: 12345678, marginPct: 3.5, customerImportance: "strategic",
      crossBase: true, capitalExpenditure: true, asOf: "2026-07-01",
    });
    expect(hits(reqLog, "/a/v1/org/approvers/resolve").length).toBe(1);

    await screen.findByTestId("org-resolution");
    expect(screen.getByTestId("org-eligible-p_probe").textContent).toContain("探针甲");
    // `via=delegated` 必须在屏上分得出来 —— 「本人有权」与「代理顶上」是两件事
    expect(screen.getByTestId("org-eligible-via-p_probe").textContent).toContain("代理自");
    expect(screen.getByTestId("org-blocker-auth_blocked").textContent).toContain("探针原因一");
  });

  it("①-D ★接缝驱动（3 条端点串成一条链）：置为不在岗 → 重新解析 → 代理人以 via=delegated 顶上", async () => {
    const user = userEvent.setup();
    renderApp("/admin/org");
    await waitFor(() => expect(screen.getByTestId("org-world-page").getAttribute("data-ready")).toBe("1"));

    // ① 初态：张明（销售经理）在岗 ⇒ 直接有权批 100 万的订单（额度上限 500 万）
    fireEvent.change(screen.getByTestId("org-matter-scope"), { target: { value: "order" } });
    fireEvent.change(screen.getByTestId("org-matter-amount"), { target: { value: "1000000" } });
    await user.click(screen.getByTestId("org-resolve-run"));
    await screen.findByTestId("org-resolution");
    expect(screen.getByTestId("org-eligible-p_zhang_ming")).toBeInTheDocument();
    expect(screen.getByTestId("org-eligible-via-p_zhang_ming").textContent).toContain("本人职权");
    expect(screen.queryByTestId("org-eligible-p_zhao_min"), "初态赵敏就顶上了 ⇒ 代理分支被无条件走，测不出东西").toBeNull();

    // ② PATCH availability：把张明置为不在岗（**代理链在生产里的唯一触发源**）
    await user.click(screen.getByTestId("org-availability-toggle-p_zhang_ming"));
    await waitFor(() => expect(screen.getByTestId("org-available-p_zhang_ming").getAttribute("data-available")).toBe("0"));
    // 上一次的解析结果必须被清掉 —— 留着就是拿旧答案冒充新答案
    expect(screen.queryByTestId("org-resolution"), "改了在岗状态却留着上一轮的审批人清单 = 静默错答").toBeNull();

    // ③ 重新解析：赵敏（销售副经理）经 dlg_sales_zhang_to_zhao 顶上，且标成 delegated
    await user.click(screen.getByTestId("org-resolve-run"));
    await screen.findByTestId("org-resolution");
    expect(await screen.findByTestId("org-eligible-p_zhao_min")).toBeInTheDocument();
    const via = screen.getByTestId("org-eligible-via-p_zhao_min").textContent ?? "";
    expect(via).toContain("代理自");
    expect(via, "代理来源没解成中文名 ⇒ 用户看到的是一串 id").toContain("张明");
    expect(screen.queryByTestId("org-eligible-p_zhang_ming"), "不在岗的人还留在可批清单里").toBeNull();
  });

  it("①-E 卡住时不许静默：无人有权批 → stuck 徽标 + 一句话诊断 + 逐条落选原因", async () => {
    const user = userEvent.setup();
    renderApp("/admin/org");
    await waitFor(() => expect(screen.getByTestId("org-world-page").getAttribute("data-ready")).toBe("1"));
    // ⚠ 这组数是**实测选出来的**，不是想当然：第一版用「5 亿的订单」，结果经营委员会那条
    //   `lim_exec_order` 的 `maxOrderValue` 是 `null`（= 金额不设限，**不是**上限为 0），孙伟照样有权批。
    //   —— 「null = 不设限」与「null = 批不了」在契约里是**方向相反**的两类维度（黑名单 vs 白名单），
    //   拿错一边这条用例就变成"可批 1 人"。真正谁都过不去的是**资本投入**：
    //   总经理上限 1000 万、经营委员会上限 10 亿，故取 20 亿 + capitalExpenditure。
    fireEvent.change(screen.getByTestId("org-matter-scope"), { target: { value: "investment" } });
    fireEvent.change(screen.getByTestId("org-matter-amount"), { target: { value: "2000000000" } });
    fireEvent.click(screen.getByTestId("org-matter-capex"));
    await user.click(screen.getByTestId("org-resolve-run"));
    await screen.findByTestId("org-resolution");

    expect(screen.getByTestId("org-resolution-stuck").textContent).toContain("卡住");
    // 「为什么卡住」必须写出来 —— 空白比错答更容易被当成"没问题"
    expect(screen.getByTestId("org-resolution-diagnosis").textContent!.length, "卡住了却不说为什么").toBeGreaterThan(6);
    expect(screen.getAllByTestId(/^org-blocker-/).length, "无人可批却一条落选原因都没有").toBeGreaterThan(0);
  });

  it("①-F ⛔R4 红线：整页零真值写入 —— 全程不打任何 action-drafts 端点，源码里也没有审批调用", async () => {
    const user = userEvent.setup();
    renderApp("/admin/org");
    await waitFor(() => expect(screen.getByTestId("org-world-page").getAttribute("data-ready")).toBe("1"));
    await user.click(screen.getByTestId("org-resolve-run"));
    await screen.findByTestId("org-resolution");
    await user.click(screen.getByTestId("org-availability-toggle-p_zhang_ming"));
    await waitFor(() => expect(screen.getByTestId("org-available-p_zhang_ming").getAttribute("data-available")).toBe("0"));

    // 旁路观测全量请求：整页跑完一圈，S2 审批链上的写端点一次都不许出现。
    expectRecorderAlive(reqLog); // ← 先自证记录器活着，否则下面这条否定断言恒真
    expect(hits(reqLog, "/a/v1/action-drafts").map((c) => `${c.method} ${c.url}`), "组织世界页打了审批链端点 = 绕过 R4").toEqual([]);

    // 源码侧的补充判据：**没有 import 任何审批写函数**。
    // ⚠ 判据落在函数名上，**不是**落在字符串 "action-drafts" 上 —— 那个串在本页的
    //   R4 说明注释里就有（写着"真值写入仍只有 POST /a/v1/action-drafts 这条路"）。
    //   拿注释里的提及当"有调用"的证据，正是本仓「提及 ≠ 读取」那条老坑。
    const src = readRepoFile("../src/pages/admin/OrgWorldPage.tsx");
    expect(src, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("resolveApprovers");
    for (const fn of ["createActionDraft", "decideActionDraft", "fetchActionDrafts", "useActionDraft"]) {
      expect(src, `组织世界页 import 了审批写函数 ${fn}`).not.toContain(fn);
    }
    // 也不许自己用 api.a 绕过 endpoints 层直接打审批端点
    expect(src).not.toContain('api.a("/a/v1/action-drafts');
  });

  it("①-G entitlement 关（org.world 真暗发）→ 页面不存在（R3 不泄露功能存在性）", async () => {
    delete db.tenantOverrides["org.world"];
    renderApp("/admin/org");
    // 给守卫足够时间加载 workspace 后再判定；页面本体出现 = featureKey 守卫没接上
    await waitFor(() => expect(screen.queryByText("加载中…")).toBeNull(), { timeout: 5000 }).catch(() => undefined);
    await waitFor(() => expect(screen.queryByTestId("org-world-page")).toBeNull());
    expect(screen.queryByTestId("org-chart-panel")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ② 决策因果图 —— 2 条：causal-graphs/sim/:sessionId · causal-graphs/decision/:decisionId
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 抽象占位配置（R14 零行业实体名）——沙盘挂载所需，本节不依赖它的任何数值。 */
const CFG: SandboxViewConfig = {
  tenantId: "tenant-seam",
  nodeTypes: ["TypeA"],
  nodeObjectIds: { TypeA: ["obj_a1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load"],
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

/** 决策推演页的 5 区来自真求解器；本节只关心 commit 之后那颗因果图按钮，故给一份最小可用产物。 */
const DP_MIN = {
  rootCause: { factorId: "cf-probe", label: "探针根因", metricKey: "probe_metric", gap: 12.5, unit: "%" },
  options: [{
    optionId: "opt-probe", factorId: "cf-probe", label: "探针方案", sourceKind: "solver",
    closesGap: 3.2, cost: 100, cycleDays: 30, risk: 0.2, exposure: 0.1, reversibility: 0.8,
    provenance: { kind: "求解器", basis: "probe.basis", drillType: "ProbeType", drillId: "probe-1", drillValue: 1 },
  }],
  matrix: [{ optionId: "opt-probe", label: "探针方案", dims: { closesGap: 3.2, cost: 100, cycleDays: 30, risk: 0.2, exposure: 0.1, reversibility: 0.8 } }],
  triggers: [],
  recommendedPlan: { planId: "plan-probe", optionIds: ["opt-probe"], steps: [{ phase: "即刻", action: "探针方案", optionRef: "opt-probe" }], totalClosesGap: 3.2, totalCost: 100 },
  sandboxNarrowing: { beforeGap: 12.5, afterGap: 9.3, narrowedPct: 25.6, ticks: 0 },
  summary: "探针摘要",
};

describe("WO-BEFE-D ② 决策因果图（causal-graphs 两源）", () => {
  const reqLog = useRequestLog();

  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("②-A 沙盘源：右栏展开「因果图（本会话）」→ 真打 /a/v1/causal-graphs/sim/<后端返回的 sessionId>，五段真渲染", async () => {
    const user = userEvent.setup();
    mountSandbox();
    const sec = await screen.findByTestId("sc-rail-causal-graph");
    await user.click(within(sec).getByText("因果图（本会话）"));

    const panel = await screen.findByTestId("sandbox-causal-graph");
    expectRecorderAlive(reqLog);
    // ★ URL 里的 sessionId 必须是**后端建会话时返回的那个**，不是前端编的字符串。
    const sessionId = panel.getAttribute("data-graph-id")!.replace(/^cg_sim_/, "");
    expect(sessionId.length, "sessionId 为空 ⇒ 下面那条 URL 断言是空胜").toBeGreaterThan(3);
    expect(hits(reqLog, `/a/v1/causal-graphs/sim/${sessionId}`).length, "展开了却没打因果图端点 ⇒ 入口仍是死的").toBe(1);
    expect(panel.getAttribute("data-source-kind")).toBe("sim_session");

    // 有真值的两段出节点；没接线的三段出**缺席原因**（不是空白、不是 0）
    expect(Number(screen.getByTestId("sandbox-causal-graph-count-CAUSE").textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("sandbox-causal-graph-count-IMPACT").textContent)).toBeGreaterThan(0);
    for (const seg of ["DECISION", "ACTION", "RESULT"]) {
      const gap = screen.getByTestId(`sandbox-causal-graph-gap-${seg}`);
      expect(gap.getAttribute("data-gap-reason"), `${seg} 段缺席原因被压成了笼统一句`).toBe("NO_SOURCE_WIRED");
      expect(gap.textContent).toContain("缺：");
      expect(gap.textContent).toContain("补：");
    }
  }, 30000);

  it("②-B 沙盘源零写死反证：桩换一组完全不同的数 → 屏上跟着变（不跟着变就是页面在编）", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/a/v1/causal-graphs/sim/:sessionId", ({ params }) =>
        HttpResponse.json(
          DecisionGraphSchema.parse({
            graphId: "cg_probe", tenantId: "demo",
            source: { kind: "sim_session", refId: String(params.sessionId) },
            nodes: [{
              nodeId: "probe-node-1", segment: "CAUSE", label: "探针扰动标签",
              anchor: { objectId: "probe-obj", stateVar: "probe-var" }, value: -4242, unit: "探针单位", tick: 9,
              provenance: { kind: "perturbation", refId: "probe-pert", producedBy: null, detail: "探针 detail" },
            }],
            edges: [],
            segmentCounts: { CAUSE: 1, IMPACT: 0, DECISION: 0, ACTION: 0, RESULT: 0 },
            // ★ 三种缺席原因在同一张图里同时出现 —— 它们必须在屏上分得开
            segmentGaps: [
              { segment: "IMPACT", reason: "SOURCE_EMPTY", missing: "探针缺 IMPACT", needs: "探针补 IMPACT" },
              { segment: "DECISION", reason: "NO_SOURCE_WIRED", missing: "探针缺 DECISION", needs: "探针补 DECISION" },
              { segment: "ACTION", reason: "NO_SOURCE_WIRED", missing: "探针缺 ACTION", needs: "探针补 ACTION" },
              { segment: "RESULT", reason: "NOT_YET_REALIZED", missing: "探针缺 RESULT", needs: "探针补 RESULT" },
            ],
            caveats: ["探针 caveat"],
          }),
        ),
      ),
    );
    mountSandbox();
    const sec = await screen.findByTestId("sc-rail-causal-graph");
    await user.click(within(sec).getByText("因果图（本会话）"));
    await screen.findByTestId("sandbox-causal-graph");

    const node = await screen.findByTestId("sandbox-causal-graph-node-probe-node-1");
    expect(node.textContent).toContain("探针扰动标签");
    expect(node.textContent).toContain("-4242");
    expect(screen.getByTestId("sandbox-causal-graph-prov-probe-node-1").textContent).toContain("perturbation");
    expect(screen.getByTestId("sandbox-causal-graph-gap-IMPACT").getAttribute("data-gap-reason")).toBe("SOURCE_EMPTY");
    expect(screen.getByTestId("sandbox-causal-graph-gap-RESULT").getAttribute("data-gap-reason")).toBe("NOT_YET_REALIZED");
    expect(screen.getByTestId("sandbox-causal-graph-gap-IMPACT").textContent).toContain("接了线没数据");
    expect(screen.getByTestId("sandbox-causal-graph-gap-RESULT").textContent).toContain("时点未到");
    expect(screen.getByTestId("sandbox-causal-graph-caveats").textContent).toContain("探针 caveat");
  }, 30000);

  it("②-C 台账源：决策推演页提交决策 → 「看因果图」→ 真打 /a/v1/causal-graphs/decision/<真 decisionId>", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: DP_MIN, snapshotVersion: "ov-dp" })),
      http.post("*/a/v1/decisions", () => HttpResponse.json({ id: "dec_seam_1", status: "PROPOSED" }, { status: 201 })),
      http.post("*/a/v1/decisions/dec_seam_1/commit", () => HttpResponse.json({ id: "dec_seam_1", status: "COMMITTED" })),
    );
    renderApp("/v/decision-play");

    // 因果图入口**只在提交之后**出现（COMMITTED 才有台账 id / actionDraftIds）
    expect(screen.queryByTestId("dp-causal-toggle"), "还没提交就给了因果图入口 ⇒ 它拿不到 decisionId").toBeNull();
    await user.click(await screen.findByTestId("dp-commit"));
    await screen.findByTestId("dp-commit-result");

    await user.click(await screen.findByTestId("dp-causal-toggle"));
    const panel = await screen.findByTestId("dp-causal-graph");
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/a/v1/causal-graphs/decision/dec_seam_1").length, "点了「看因果图」却没打台账源端点").toBe(1);
    expect(panel.getAttribute("data-source-kind")).toBe("decision");

    // ★「为什么这个决策被触发」这条边的两端（IMPACT → DECISION）都得有节点
    expect(Number(screen.getByTestId("dp-causal-graph-count-IMPACT").textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("dp-causal-graph-count-DECISION").textContent)).toBeGreaterThan(0);
    // RESULT 段未回填 ⇒ NOT_YET_REALIZED（**不是** SOURCE_EMPTY，两者修法不同）
    expect(screen.getByTestId("dp-causal-graph-gap-RESULT").getAttribute("data-gap-reason")).toBe("NOT_YET_REALIZED");
  }, 30000);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ③ 自成长发动机 —— 3 条：growth/probe · growth/tickets/:id/submit · …/verify
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-D ③ 自成长发动机（probe / submit / verify）", () => {
  const reqLog = useRequestLog();

  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("③-A 只探针（不补）：真打 /b/v1/growth/probe，屏上结论来自响应，且**一张工单都没动**", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("*/b/v1/growth/probe", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          question: "探针问句", taskId: "task_probe_seam", verdict: "BOUNDARY", path: "AGENT",
          findings: [{ gapCode: "NO_SLICE", evidence: "探针证据串", suggestedFill: "补切片", blocking: true }],
          generatedAt: "2026-06-17T00:00:00Z",
        });
      }),
    );
    renderApp("/admin/growth");
    await waitFor(() => expect(screen.getByTestId("growth-cockpit-page").getAttribute("data-ready")).toBe("1"));
    const before = screen.getAllByTestId(/^ticket-/).map((r) => r.textContent);
    expect(before.length, "一张工单都没有 ⇒「工单没变」是空胜").toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId("growth-query"), { target: { value: "探针问句" } });
    await user.click(screen.getByTestId("growth-probe"));

    await waitFor(() => expect(bodies.length, "点了「只探针」一个请求都没发").toBe(1));
    expect((bodies[0] as { query: string }).query).toBe("探针问句");
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/b/v1/growth/probe").length).toBe(1);
    // ★ 探针的定义就是"不动数据"：LOOP 端点一次都不许被顺手打上
    expect(hits(reqLog, "/b/v1/growth/run").length, "探针顺手打了 LOOP ⇒「只诊断不动数据」是假的").toBe(0);

    await screen.findByTestId("growth-probe-report");
    expect(screen.getByTestId("growth-probe-verdict").textContent).toBe("BOUNDARY");
    expect(screen.getByTestId("growth-probe-finding-NO_SLICE").textContent).toContain("探针证据串");
    expect(screen.getAllByTestId(/^ticket-/).map((r) => r.textContent), "探针跑完工单表变了 ⇒ 它写了东西").toEqual(before);
  });

  it("③-B ★接缝驱动：提交复核 → 重跑验证，状态一跳一跳真推进（gtk_2 重跑可答 ⇒ VERIFIED）", async () => {
    const user = userEvent.setup();
    renderApp("/admin/growth");
    await waitFor(() => expect(screen.getByTestId("growth-cockpit-page").getAttribute("data-ready")).toBe("1"));

    // gtk_2 种子态是 IN_PROGRESS（已认领）—— 见 handlers.ts 那段注释：
    // 多一张 OPEN 会改掉「开放工单 1 张」这个既有断言度量的东西。
    const row = () => screen.getByTestId("ticket-gtk_2");
    expect(row().textContent).toContain("IN_PROGRESS");

    await user.click(await screen.findByTestId("submit-gtk_2"));
    await waitFor(() => expect(row().textContent, "提交复核之后状态没动 ⇒ 那颗按钮是装饰").toContain("IN_REVIEW"));

    await user.click(await screen.findByTestId("verify-gtk_2"));
    await waitFor(() => expect(row().textContent).toContain("VERIFIED"));
    expect(screen.getByTestId("verify-result-gtk_2").textContent).toContain("重跑可答");

    // ★ 两条端点真的都被打了，URL 里带的是这张单的 id
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/b/v1/growth/tickets/gtk_2/submit").length).toBe(1);
    expect(hits(reqLog, "/b/v1/growth/tickets/gtk_2/verify").length).toBe(1);
    expect(hits(reqLog, "/b/v1/growth/tickets/gtk_2/submit")[0]!.method).toBe("POST");
  });

  it("③-C 「还没好」不许塌成「失败」：gtk_1 重跑仍答不出 ⇒ 停 IN_REVIEW + 屏上写明还缺什么", async () => {
    const user = userEvent.setup();
    renderApp("/admin/growth");
    await waitFor(() => expect(screen.getByTestId("growth-cockpit-page").getAttribute("data-ready")).toBe("1"));

    await user.click(screen.getByTestId("claim-gtk_1"));
    await waitFor(() => expect(screen.getByTestId("ticket-gtk_1").textContent).toContain("IN_PROGRESS"));
    await user.click(await screen.findByTestId("submit-gtk_1"));
    await waitFor(() => expect(screen.getByTestId("ticket-gtk_1").textContent).toContain("IN_REVIEW"));
    await user.click(await screen.findByTestId("verify-gtk_1"));

    const badge = await screen.findByTestId("verify-result-gtk_1");
    expect(badge.textContent).toContain("仍缺");
    expect(badge.textContent).toContain("NO_CAPABILITY"); // 回带的**具体**缺口码，不是一句"失败"
    expect(screen.getByTestId("ticket-gtk_1").textContent, "答不出却标成 VERIFIED").toContain("IN_REVIEW");
    expect(screen.getByTestId("ticket-gtk_1").textContent).not.toContain("VERIFIED");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ④ 场景 —— 3 条：scenarios/:key/launch · …/closure · …/publish-chain
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-D ④ 场景（launch / closure / publish-chain）", () => {
  const reqLog = useRequestLog();

  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("④-A ★接了线接错地方的修正：点▶启动 打的是 /b/v1/scenarios/:key/launch，**不再**是通用 /b/v1/queries", async () => {
    const user = userEvent.setup();
    const userQuery = "4680-NCM 加 20% 1天交付能不能接？";
    renderApp("/scenarios");
    await screen.findByTestId("scenario-launcher");
    // 用户在卡上**改写**问句（后端据此跑归一化；前端拼装那条路根本没有这一步）
    fireEvent.change(await screen.findByTestId("launcher-query-S01"), { target: { value: userQuery } });
    await user.click(screen.getByTestId("launcher-launch-S01"));

    await waitFor(() => expect(hits(reqLog, "/b/v1/scenarios/S01/launch").length, "点了▶启动却没打 launch 端点 ⇒ 仍走的是老路").toBe(1));
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/b/v1/scenarios/S01/launch")[0]!.method).toBe("POST");
    // ★ 反面判据：通用 queries 端点**一次都不许**被打（打了就是两条路都走 = 改了个寂寞）
    expect(
      hits(reqLog, "/b/v1/queries").filter((c) => c.method === "POST").map((c) => c.url),
      "场景卡启动仍在打通用 /b/v1/queries ⇒ 接线没换过来",
    ).toEqual([]);
    // ★ 用户改写的问句真的进了 body（不是被 triggerQuestion 顶掉）—— 由服务端落到任务上证明
    const launched = [...db.tasks.values()].find((t) => (t.context as { scenarioKey?: string }).scenarioKey === "S01");
    expect(launched, "launch 打了但后端没落任务 ⇒ 这条链只走了一半").toBeTruthy();
    expect(launched!.query, "用户改写的问句被丢了").toBe(userQuery);
  });

  it("④-A2 归一化槽位由**服务端**回填（前端做不了这一步）：launch 之后任务上下文带 _normalizedSlots", async () => {
    // 直接验那一跳的契约：前端只交「哪张卡 + 用户问句」，槽位归一化是服务端的活。
    const res = await launchScenario("S01", "4680-NCM 加 20% 1天交付能不能接？");
    expect(res.scenario).toBe("S01");
    expect(res.query).toContain("1天交付");
    const ctx = db.tasks.get(res.taskId)!.context as { presetSlots: Record<string, unknown> };
    // 卡上的预置是 weeks 6；用户说"1天" ⇒ 服务端归一成 1 周。
    expect(ctx.presetSlots.weeks, "用户改写了问句，槽位却还是卡上的旧值 ⇒ 归一化没发生").toBe(1);
    expect(ctx.presetSlots._normalizedSlots, "R13 留痕缺失：归一化过程没留下可校验的痕迹").toBeTruthy();
  });

  it("④-A3 发布态闸（前端自己拼那条路完全没有的一道）：未发布的卡 → 409，不产生任何任务", async () => {
    db.scenarios.push({ ...db.scenarios[0]!, id: "scn-DRAFTONLY", scenarioKey: "DRAFTONLY", name: "未发布卡", status: "DRAFT", version: 1 });
    const before = db.tasks.size;
    await expect(launchScenario("DRAFTONLY")).rejects.toThrow(/未发布|INVALID_STATE/);
    expect(db.tasks.size, "未发布的卡竟然也建出了任务 ⇒ 发布态闸没生效").toBe(before);
  });

  it("④-B 单场景闭包复检：真打 /b/v1/scenarios/:key/closure，断链条目**摊在屏上**（不再只挂 title）", async () => {
    const user = userEvent.setup();
    // 造一张引用未发布意图的 DRAFT 卡（= 真实的 scaffold 产物形态）
    db.intents.push({ ...db.intents[0]!, id: "int-seam-draft", key: "seam_draft_intent", status: "DRAFT" });
    db.scenarios.push({
      ...db.scenarios[0]!, id: "scn-SEAM", scenarioKey: "SEAM", name: "接缝探针场景",
      intentKey: "seam_draft_intent", status: "DRAFT", version: 1,
    });
    renderApp("/admin/scenes");
    await screen.findByTestId("scenario-row-SEAM");
    await user.click(screen.getByTestId("scenario-recheck-SEAM"));

    const result = await screen.findByTestId("scenario-recheck-result-SEAM");
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/b/v1/scenarios/SEAM/closure").length, "点了「复检」一个请求都没发").toBe(1);
    expect(result.getAttribute("data-ready")).toBe("0");
    // 具体缺什么必须看得见（这几个字来自响应的 issues，不是前端编的一句"有问题"）
    expect(result.textContent).toContain("seam_draft_intent");
    expect(result.textContent).toContain("未发布");
  });

  it("④-C 发布全链：真打 /b/v1/scenarios/:key/publish-chain，意图与场景**按依赖序**一起转 PUBLISHED", async () => {
    const user = userEvent.setup();
    db.intents.push({ ...db.intents[0]!, id: "int-seam-draft2", key: "seam_draft_intent2", status: "DRAFT" });
    db.scenarios.push({
      ...db.scenarios[0]!, id: "scn-SEAM2", scenarioKey: "SEAM2", name: "接缝探针场景二",
      intentKey: "seam_draft_intent2", status: "DRAFT", version: 1,
    });
    renderApp("/admin/scenes");
    await screen.findByTestId("scenario-row-SEAM2");
    // 单发「发布」这颗按钮此时是**禁用**的（闭包不 ready）——正是「发布全链」存在的理由。
    expect((screen.getByTestId("scenario-publish-SEAM2") as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId("scenario-publish-chain-SEAM2"));

    await waitFor(() => expect(screen.getByTestId("scenario-status-SEAM2").textContent).toBe("PUBLISHED"));
    expectRecorderAlive(reqLog);
    expect(hits(reqLog, "/b/v1/scenarios/SEAM2/publish-chain").length, "点了「发布全链」一个请求都没发").toBe(1);
    // ★ 链上那一跳（意图）也真的被发布了 —— 只发场景不发意图 = 又一条死路
    expect(db.intents.find((i) => i.key === "seam_draft_intent2")!.status).toBe("PUBLISHED");
  });

  it("④-D 不是死代码：所有新 URL 真在 endpoints.ts 里，且被真组件引用（金丝雀先证读法没坏）", () => {
    const eps = readRepoFile("../src/api/endpoints.ts");
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/a/v1/twin/enterprise-states");
    for (const frag of [
      "/launch", "/closure", "/publish-chain",
      "/a/v1/org/chart", "/a/v1/org/authorities", "/a/v1/org/delegations", "/a/v1/org/approvers/resolve", "/availability",
      "/a/v1/causal-graphs/sim/", "/a/v1/causal-graphs/decision/",
      "/b/v1/growth/probe", "/submit", "/verify",
    ]) {
      expect(eps, `endpoints.ts 里没有 ${frag}`).toContain(frag);
    }
    // 有 api 函数 ≠ 有人调它（只有 test 引用 = 已排练，不是已实现）——逐个指出生产调用方。
    // ⚠ 这几条原本写死 `readRepoFile("<某个文件>")`，与下面 `findInSrc` 的顶注自相矛盾：
    //    同一个 it 里一半按文件扫、一半按文件名钉。按文件名钉的那一半会被搬家打断（假红），
    //    而 `readRepoFile` 不剥注释、注释里提一嘴就当作有调用（假绿）。现全部改走 `findInSrc`。
    expect(findInSrc("launchScenario(card.sNo"), "场景卡启动零生产调用方").not.toHaveLength(0);
    expect(findInSrc("publishScenarioChain("), "发布全链零生产调用方").not.toHaveLength(0);
    expect(findInSrc("fetchScenarioClosure("), "链路闭合查询零生产调用方").not.toHaveLength(0);
    /*
     * ⚠ 这两条**按文件扫，不按文件名钉**（见 `findInSrc` 的注释：写死路径会被搬家打断）。
     * 金丝雀先证扫描法没坏：一个必中的片段命中非空 ⇒ 下面的「没有生产调用方」才可信。
     * 另注：这两条只证「有生产调用方」；**渲染层的咬合另有其人**且更硬 ——
     * `②-B`（sim：桩换一组数 → 屏上跟着变）与 `②-C`（decision：提交 → 点开 → 真打台账源端点）
     * 都是端到端真跑。故此处保留静态盘点即可，不必再复制一遍渲染断言。
     */
    expect(findInSrc("<CausalGraphPanel"), "金丝雀未中 ⇒ src 扫描坏了，下面的「没有生产调用方」全部不可信").not.toHaveLength(0);
    expect(findInSrc('<CausalGraphPanel source={{ kind: "sim"'), "沙盘因果图没有任何生产调用方（只有 test 引用 = 已排练，不是已实现）").not.toHaveLength(0);
    expect(findInSrc('<CausalGraphPanel source={{ kind: "decision"'), "决策台账因果图没有任何生产调用方（只有 test 引用 = 已排练，不是已实现）").not.toHaveLength(0);
    /*
     * 同上：改走 `findInSrc`。探针取**用法形**不取裸名 —— 裸名咬不掉 `export const probeGrowth = (`
     * 这个**声明**，于是「有声明」被读作「有调用」（只有声明 = 没接线）；`import { … }` 那行同理。
     * 两种用法都收：react-query 传引用（本仓 `queryFn: fetchOrgChart` 实测就是这个形态，
     * 裸调用形 `fetchOrgChart(` 全仓 **0 命中**，只按调用形写会得到一条恒红断言）与直接调用。
     */
    const wired = (fn: string): string[] =>
      findInSrcRe(new RegExp(`(?:queryFn|mutationFn):\\s*${fn}\\b|\\b${fn}\\s*\\(`));
    for (const fn of ["probeGrowth", "submitGrowthTicket", "verifyGrowthTicket"]) {
      expect(wired(fn), `${fn} 零生产调用方（只有声明/只有 import = 没接线）`).not.toHaveLength(0);
    }
    for (const fn of ["fetchOrgChart", "fetchOrgAuthorities", "fetchOrgDelegations", "setOrgAvailability", "resolveApprovers"]) {
      expect(wired(fn), `${fn} 零生产调用方（只有声明/只有 import = 没接线）`).not.toHaveLength(0);
    }
    // 路由与导航都得有它，否则页面只能手敲 URL（G-NAV-FALLBACK-BUCKET 的形态）
    expect(readRepoFile("../src/App.tsx")).toContain('path: "admin/org"');
    expect(readRepoFile("../src/pages/adminRegistry.ts")).toContain('path: "org"');
    expect(readRepoFile("../src/pages/ShellLayout.tsx")).toContain('"actions", "org"');
  });
});
