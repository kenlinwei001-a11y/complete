import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { checkedTree, factHits } from "./factlock";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-REFERENCES-FAMILY · **引用反查族的接缝门**（门 `befe-seam:check` 载体②·断点 `G-BE-FE-SEAM-DEAD`）
 *
 * ── 这张单为什么是一张、不是五张 ────────────────────────────────────────────
 * 后端注册的 `/references` 端点共 13 条，本单开工时前端零调用 9 条。
 * B 侧 7 条**全部**由同一个函数支撑（`apps/agentcore/src/resources.ts:186` `computeReferences`，
 * 路由 `server.ts:910/1259/1267/1273/1600/1969/3185` 逐条调它）。
 * 按「域」把它们切进 5 张单 ⇒ 大概率长出 5 份形态不同的引用面板 —— 同一概念多套实现。
 * 故收成一份：`fetchReferences(kind,id)` + `<ReferencesPanel>`。
 *
 * ── 本门咬什么（三层，缺一不可）──────────────────────────────────────────────
 *  ① **真链路**：从真 workspace 导航到挂载点 → 面板真发请求（MSW 拦真 URL/方法）→ 列表真上屏。
 *     只断言"组件在"是运输层，不是效果层。
 *  ② **同一份实现**：共享面板里的文案在**多个挂载点**逐字出现。
 *     ⚠ 断言里写的是**字面量**，不是 `import { REFERENCES_COPY }` —— 后者是恒真的同义反复
 *     （面板改文案，断言跟着改，永远绿）。写死字面量才能做到：**改共享件一处文案 ⇒ 多处一起红**。
 *  ③ **诚实位**：`count:0`（真没人引用）与「查不出来」（这次没查到）必须分得开；
 *     后者**不许**渲染任何计数 —— 渲染一个 0 就是把「我不知道」说成「没风险」。
 *
 * ── 诚实边界（本门做不到什么）──────────────────────────────────────────────
 * · 本门跑在 MSW 桩上，验的是「前端这半边接对了没有」。后端那半边的判据由
 *   `apps/agentcore/test/*` 与 `apps/datacore/test/*` 各自守；mock 判据照抄后端
 *   `computeReferences` 的分支（谁的哪个字段指向我），抄歪了这门验的就不是真链路。
 * · `scene-entry` 那条**故意没有挂载点**（后端 `resources.ts:278` 注释与实现都写死"入口是叶子 → 恒空"），
 *   见本文件末尾的「不许为消红而接」用例。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** 展开共享面板的第二层（第一层只有「N 处引用 ▸」这一个记号）。 */
async function expandPanel(user: ReturnType<typeof userEvent.setup>, testKey: string) {
  await user.click(await screen.findByTestId(`references-toggle-${testKey}`));
  return await screen.findByTestId(`references-body-${testKey}`);
}

describe("WO-REFERENCES-FAMILY ① 逐挂载点：真导航 → 真发请求 → 真上屏", () => {
  afterEach(() => cleanup());

  it("①-A 技能库：选中技能 → `GET /b/v1/skills/:id/references` → 挂了它的 Agent 真上屏", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const calls: string[] = [];
    server.use(
      http.get("*/b/v1/skills/:id/references", ({ request, params }) => {
        calls.push(request.url);
        expect(request.method).toBe("GET");
        void params;
        return HttpResponse.json({ references: [{ kind: "agent", id: "agt-explore", name: "探索分析 Agent", via: "skills" }], count: 1 });
      }),
    );
    renderApp("/admin/skills");
    await user.click(await screen.findByRole("button", { name: /产能分析方法论/ }));
    await screen.findByTestId("skill-editor");

    // 第一层：一个记号（数字来自响应，不是写死）。
    await waitFor(() => expect(screen.getByTestId("references-count-skill-skl-capacity").textContent).toContain("1 处引用"));
    await waitFor(() => expect(calls.length, "一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!, `打错端点：${calls[0]!}`).toContain("/b/v1/skills/skl-capacity/references");

    // 第二层：点开才有逐条明细。
    const body = await expandPanel(user, "skill-skl-capacity");
    expect(within(body).getByTestId("references-item-skill-skl-capacity-agent-agt-explore").textContent).toContain("探索分析 Agent");
  });

  it("①-B 流程库：`GET /b/v1/workflows/:id/references` —— 走默认桩（谁把它当工具挂着，与 db 对账）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/workflows");
    const select = await screen.findByLabelText("选择 workflow");
    await screen.findByRole("option", { name: /产能校核流程/ });
    await user.selectOptions(select, "wf-cap");
    await screen.findByTestId("workflow-editor");

    // 默认 mock 判据抄自后端：agent.tools 里 kind=WORKFLOW 且 workflowId==wf-cap ⇒ agt-explore。
    await waitFor(() => expect(screen.getByTestId("references-count-workflow-wf-cap").textContent).toContain("1 处引用"));
    const body = await expandPanel(user, "workflow-wf-cap");
    expect(body.textContent).toContain("tools[kind=WORKFLOW]");
  });

  it("①-C MCP：`GET /b/v1/mcp-configs/:id/references`（新建态无 id ⇒ 整块不渲染，不画空面板）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/mcp");
    await user.click(await screen.findByRole("button", { name: /示例 MCP 服务器/ }));
    await waitFor(() => expect(screen.getByTestId("references-count-mcp-config-mcp-demo").textContent).toContain("1 处引用"));
    const body = await expandPanel(user, "mcp-config-mcp-demo");
    expect(body.textContent).toContain("mcpServers");
  });

  it("①-D Agent 库：`GET /b/v1/agents/:id/references` —— 退役前看得到会打断谁（场景入口 + 场景）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await user.click(await screen.findByText("探索分析 Agent"));
    await screen.findByTestId("agent-editor");

    const body = await expandPanel(user, "agent-agt-explore");
    // 场景入口 scn-graph 的 defaultAgentId 就是它（fixtures.ts:1418）——这条不上屏，人只能撞上 409 才知道。
    expect(within(body).getByTestId("references-item-agent-agt-explore-scene-entry-scn-graph").textContent).toContain("defaultAgentId");
  });

  it("①-E 切片：`GET /a/v1/ontology/slices/:key/references` —— A 侧 `{refs,total}` 形状归一后照样上屏", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const calls: string[] = [];
    server.use(
      http.get("*/a/v1/ontology/slices/:key/references", ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json({ refs: [{ refKind: "plan", key: "capacity_check", version: "latest", where: "reportedRefs" }], total: 1 });
      }),
    );
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    await user.click(await screen.findByTestId("slice-row-model_capacity_network"));

    await waitFor(() => expect(calls.length, "展开切片后引用反查没发请求").toBe(1));
    expect(calls[0]!).toContain("/a/v1/ontology/slices/model_capacity_network/references");
    const body = await expandPanel(user, "slice-model_capacity_network");
    // `{refKind, key, where, version}` → 归一成 `{kind, ref, via}`：版本带在 via 上，不许丢。
    expect(within(body).getByTestId("references-item-slice-model_capacity_network-plan-capacity_check").textContent).toContain("reportedRefs@vlatest");
  });

  it("①-F 外部信号：`GET /a/v1/external-signals/:key/references` —— 第三种形状（因果因子）+ pending 诚实位不许抹平", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/external-signals");
    await user.click(await screen.findByTestId("series-toggle-li_carbonate_price"));

    const body = await expandPanel(user, "external-signal-li_carbonate_price");
    expect(within(body).getByTestId("references-item-external-signal-li_carbonate_price-causal-factor(root)-cf_material_cost").textContent).toContain("正极材料成本上行");
    // ★ 后端 `metricLinkage: "pending"` 是「归因还没接」，**不是**「不影响任何指标」。原样上屏。
    expect(within(body).getByTestId("references-note-external-signal-li_carbonate_price").textContent).toContain("pending");
  });

  it("①-G 规则：A/B 两条端点各打各的，**不许合成一个数**（两套事实源）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    const aCalls: string[] = [];
    const bCalls: string[] = [];
    server.use(
      http.get("*/a/v1/rules/:id/references", ({ request }) => {
        aCalls.push(request.url);
        return HttpResponse.json({ references: [], count: 0 });
      }),
      http.get("*/b/v1/rules/:key/references", ({ request }) => {
        bCalls.push(request.url);
        return HttpResponse.json({
          references: [
            { kind: "agent", id: "agt-explore", name: "探索分析 Agent", via: "ruleBindings=ALL_APPLICABLE" },
            { kind: "workflow", id: "wf-cap", name: "产能校核流程", via: "steps.evaluate_rules" },
          ],
          count: 2,
        });
      }),
    );
    renderApp("/admin/rules");
    await user.click(await screen.findByTestId("rule-C03"));

    // ★ 入参不同是后端签名的真实差异：A 吃 rule.id（rule-c03）、B 吃 rule.key（C03）。
    await waitFor(() => expect(aCalls.length).toBe(1));
    await waitFor(() => expect(bCalls.length).toBe(1));
    expect(aCalls[0]!).toContain("/a/v1/rules/rule-c03/references");
    expect(bCalls[0]!).toContain("/b/v1/rules/C03/references");

    // ★ 两个数各自成立，屏上是两个记号（0 与 2）——加起来或只留一个，都是拿一个数盖住两个事实。
    await waitFor(() => expect(screen.getByTestId("references-count-rule-rule-c03").textContent).toContain("0 处引用"));
    expect(screen.getByTestId("references-count-rule-orchestration-C03").textContent).toContain("2 处引用");

    // A 侧真 0 ⇒ 展开必须说出「今天没有引用方」，不许留一片空白让人猜是没查还是没有。
    const aBody = await expandPanel(user, "rule-rule-c03");
    expect(within(aBody).getByTestId("references-none-rule-rule-c03").textContent).toContain("今天没有引用方");
  });
});

describe("WO-REFERENCES-FAMILY ② 「同一份实现」的可证伪判据", () => {
  afterEach(() => cleanup());

  /**
   * ⚠ 下面两个字面量**故意写死**，与 `src/components/ReferencesPanel.tsx` 的 `REFERENCES_COPY` 逐字相同。
   * 把共享件里任意一处文案改掉（哪怕改一个字），本用例的**两处挂载点断言会同时红** ——
   * 这就是「它们真的是同一份实现」的机器证据。若哪天有人在某页自己复制一份面板，
   * 那一页的断言仍绿而另一页红，分歧当场暴露。
   */
  const SHARED_COUNT_SUFFIX = "处引用";
  const SHARED_NONE = "今天没有引用方（可以放心改）。";

  /**
   * ⚠ 两个挂载点**刻意拆成两个独立 `it`**，不写在一个用例里顺序断言。
   * 写在一个用例里，第一处断言一失败整个用例就中止 —— 屏幕上只有 **1 条红**，
   * 证明不了「两处同时变」（本单实测 MUT-3 时踩过：合并写法只红 1 条）。
   * 拆开后同一次变异必然打出 **2 条独立的红**，才是「同一份实现」的机器证据。
   */
  it("②-A1 挂载点甲（技能库）逐字用共享文案", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(http.get("*/b/v1/skills/:id/references", () => HttpResponse.json({ references: [], count: 0 })));
    renderApp("/admin/skills");
    await user.click(await screen.findByRole("button", { name: /产能分析方法论/ }));
    await screen.findByTestId("skill-editor");
    await waitFor(() => expect(screen.getByTestId("references-count-skill-skl-capacity").textContent).toContain(SHARED_COUNT_SUFFIX));
    const skillBody = await expandPanel(user, "skill-skl-capacity");
    // 逐字相等（不是 contain）：MUT-3 只在原句前后加字时，contain 会漏过去 —— 本单实测漏过一次。
    expect(within(skillBody).getByTestId("references-none-skill-skl-capacity").textContent).toBe(SHARED_NONE);
  });

  it("②-A2 挂载点乙（MCP）逐字用**同一句**共享文案", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(http.get("*/b/v1/mcp-configs/:id/references", () => HttpResponse.json({ references: [], count: 0 })));
    renderApp("/admin/mcp");
    await user.click(await screen.findByRole("button", { name: /示例 MCP 服务器/ }));
    await waitFor(() => expect(screen.getByTestId("references-count-mcp-config-mcp-demo").textContent).toContain(SHARED_COUNT_SUFFIX));
    const mcpBody = await expandPanel(user, "mcp-config-mcp-demo");
    expect(within(mcpBody).getByTestId("references-none-mcp-config-mcp-demo").textContent).toBe(SHARED_NONE);
  });

  it("②-B 结构证据：面板只有一份实现，各页只 import 不自持客户端", () => {
    /*
     * ⚠ 2026-08-16 WO-FACTLOCK-TRIAGE：「面板只有**一份**实现」这个命题，原写法用
     * 「`ReferencesPanel.tsx` 这个文件里有 `REFERENCES_COPY`」来代理 —— 它度量不了「只有一份」：
     * 有人复制一份到 `components/references/Panel2.tsx`，原写法照绿；
     * 反过来面板搬去子目录，原写法当场假红（`G-FACTLOCK-POSITION-ANCHOR` 两个方向）。
     * 现在直接扫整棵树数**份数**：`toHaveLength(1)` 才是「只有一份实现」这句话本身。
     */
    const fe = checkedTree("apps/frontend-shell/src", "REFERENCES_COPY", 100);
    expect(factHits(fe, "REFERENCES_COPY"), "共享文案不是恰好一份实现 ⇒ 同一概念又长出第二套").toHaveLength(1);
    expect(factHits(fe, SHARED_NONE), "共享空态文案零生产使用点").not.toEqual([]);

    for (const page of [
      "../src/pages/admin/SkillsPage.tsx",
      "../src/pages/admin/McpPage.tsx",
      "../src/pages/admin/AgentsPage.tsx",
      "../src/pages/admin/WorkflowsPage.tsx",
      "../src/pages/admin/RulesPage.tsx",
      "../src/pages/admin/SolversPage.tsx",
      "../src/pages/admin/SlicesPage.tsx",
      "../src/pages/admin/ExternalSignalsPage.tsx",
    ]) {
      const src = readRepoFile(page);
      expect(src.length, `${page} 读到了空内容——路径漂了`).toBeGreaterThan(500);
      expect(src, `${page} 没挂共享面板`).toContain("<ReferencesPanel kind=");
      // 各页**不许**自己再拼一条 /references URL —— 那就是同一概念第二套实现。
      // 判据咬的是**模板串插值紧接 `/references`**（真 URL 的形状），不是注释里提一嘴端点路径
      // （`GET /b/v1/skills/:id/references` 这种写法满页都是，把它算进来这条判据就恒红）。
      expect(src, `${page} 自己拼了 /references URL ⇒ 绕开了共享客户端`).not.toContain("}/references`");
    }

    /*
     * 同上，四条一并整树化。这里整树化让**否定**那两条变得更强而不是更弱：
     * 原写法只看 `endpoints.ts` 一个文件 —— 有人把 `export const fetchRuleReferences`
     * 写进 `api/rules.ts`，原写法照绿；整树扫才真的是「全族只有一个客户端」。
     * 而它们的金丝雀（`fetchReferences`）也随之整树化，与否定结论**同扫描面** ——
     * 金丝雀扫 A 面、结论扫 B 面，正是 CLAUDE.md 铁律 0.6 的原形态。
     */
    expect(
      factHits(fe, /(?:queryFn|mutationFn):\s*fetchReferences\b|\bfetchReferences\s*\(/),
      "fetchReferences 零生产调用方（只有声明/只有 import = 没接线）",
    ).not.toEqual([]);
    // 全族只有一个客户端：不许再出现 `fetchXxxReferences` 这种一 kind 一函数的写法。
    expect(factHits(fe, "export const fetchRuleReferences"), "又长出了单 kind 专用客户端").toEqual([]);
    expect(factHits(fe, "export const fetchSolverReferences"), "又长出了单 kind 专用客户端").toEqual([]);
    // URL 必须是模板串（`+` 拼接会被 befe-seam 抽取器切碎 ⇒ 接了线仍报零调用）。
    expect(factHits(fe, "/b/v1/agents/${encodeURIComponent(id)}/references`"), "agent 引用反查 URL 没接").not.toEqual([]);
    expect(
      factHits(fe, "/a/v1/ontology/slices/${encodeURIComponent(id)}/references`"),
      "本体切片引用反查 URL 没接",
    ).not.toEqual([]);
  });
});

describe("WO-REFERENCES-FAMILY ③ 诚实位：「查不出来」不许塌成「没人引用」", () => {
  afterEach(() => cleanup());

  it("③-A 500 → 说明这次没查到，且**不渲染任何计数**", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    server.use(
      http.get("*/b/v1/skills/:id/references", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "反查炸了", requestId: "req_r" } }, { status: 500 }),
      ),
    );
    renderApp("/admin/skills");
    await user.click(await screen.findByRole("button", { name: /产能分析方法论/ }));
    await screen.findByTestId("skill-editor");

    await waitFor(() => expect(screen.getByTestId("references-toggle-skill-skl-capacity").textContent).toContain("引用未查出"));
    const body = await expandPanel(user, "skill-skl-capacity");
    expect(within(body).getByTestId("references-error-skill-skl-capacity").textContent).toContain("不等于");
    // ★ 反证核心：查不出来却渲染计数 = 把风险藏起来。
    expect(screen.queryByTestId("references-count-skill-skl-capacity"), "查不出来却渲染了计数").toBeNull();
  });
});

describe("WO-REFERENCES-FAMILY ④ 不许为消红而接：scene-entry 故意留在基线", () => {
  it("④-A 后端实现写死恒空 ⇒ 前端接上去也只是一块永远 0 的面板，故不接（判据在后端源码，不是我说的）", () => {
    /*
     * ⚠ 2026-08-16 WO-FACTLOCK-TRIAGE：判据从两个写死文件搬到**两棵源码树**（`./factlock`，剥注释）。
     * 要锁的是「**后端至今没有 scene-entry 分支**」与「**前端至今没有它的客户端**」——
     * 两句话都与代码住在哪个文件无关，而整树扫让这两条**否定结论**变得更强：
     * 原写法只看 `resources.ts` / `endpoints.ts` 各一个文件，分支挪去同包别的文件就查不到了。
     * 金丝雀随之同扫描面（`checkedTree` 内建四条），不再是「金丝雀扫 A 面、结论扫 B 面」。
     *
     * ⚠ 诚实位：原先还有一条 `expect(backend).toContain("scene-entry：无被引用方")`。
     * 实测那句话**只存在于注释里**（`apps/agentcore/src/resources.ts:279` 的行注释），
     * 原写法不剥注释所以是绿的 —— 剥注释后它在可执行代码里 0 命中。
     * 那是「命中注释当成命中代码」的老坑，不是本条要锁的事实，故撤掉；
     * 「后端没有该分支」由下面那条否定断言承担，比它硬。
     */
    const backend = checkedTree("apps/agentcore/src", "export async function computeReferences", 50);
    // 判据：`computeReferences` 里**没有** `kind === "scene-entry"` 的分支 —— 它落到函数末尾直接返回空数组。
    expect(factHits(backend, 'kind === "scene-entry"'), "后端补了 scene-entry 分支 ⇒ 本条豁免作废，该接上了").toEqual([]);

    // 因此前端**不许**有它的客户端分支（有 = 造了一个死函数把红消掉）。
    const fe = checkedTree("apps/frontend-shell/src", "REFERENCE_SOURCES", 100);
    expect(
      factHits(fe, "/b/v1/scene-entries/${encodeURIComponent(id)}/references"),
      "给恒空端点造了个死客户端 ⇒ 把死端点换成死函数",
    ).toEqual([]);
  });
});
