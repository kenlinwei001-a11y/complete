import { describe, expect, it } from "vitest";
import { PageContextSchema } from "@platform/contracts";
import {
  AGENT_SYSTEM_CORE,
  CEO_DEEP_QUESTION_SYSTEM,
  ROLE_SYSTEM_FRAGMENTS,
  pageContextSummary,
} from "../src/agent/prompts.js";

/**
 * WO-HARNESS-PROMPT · 系统提示词升级到企业级七要素 Harness 标准（叠加式）。
 *
 * SEAM：不测各半（不只 grep 一个短语），而是断言 agent **实际看到的系统提示词**
 *（AGENT_SYSTEM_CORE 本体 + pageContextSummary 注入的状态段）七要素齐 + §6 求解纪律段在，
 * 并复验旧红线短语一字不删（叠加改造的头号回归护栏）。
 *
 * 七要素（PRD-agent-react-harness §2/§3）：①角色 ②目标 ③推理循环 ④工具协议 ⑤状态管理
 * ⑥错误恢复 ⑦结果规范。③⑥⑦ + §6 求解纪律为本单新追加；①④⑤ 沿用现有段/状态注入。
 */
describe("七要素 Harness 提示词标准（叠加式·SEAM 断七要素齐 + 旧红线零删改）", () => {
  // agent 首轮真实看到的系统提示词 = 共享核 + 状态注入段（pageContextSummary 派生页面焦点/选中/下钻）。
  const statePc = PageContextSchema.parse({
    view: "graph",
    focus: { metric: "market_share", gap: -3.2, base: "常州" },
    selection: ["正极粉短缺"],
    drillPath: ["份额缺口", "供给端", "正极粉短缺"],
  });
  const assembledSystemPrompt = `${AGENT_SYSTEM_CORE}\n${pageContextSummary(statePc)}`;

  it("七要素各有标志短语（在 agent 实际看到的系统提示词内）", () => {
    const elements: Array<[string, string[]]> = [
      // ① 角色 Role
      ["①角色", ["分析助手"]],
      // ② 目标 Objective（决策级产出，非罗列数据）
      ["②目标", ["决策级"]],
      // ③ 推理循环 ReAct（含反思触发点）——本单新增
      ["③推理循环", ["推理循环", "Think→Act→Observe→Reflect", "Reflect"]],
      // ④ 工具协议 Tool（唯一写出口 + 只读可并行）
      ["④工具协议", ["写降级", "create_action_draft"]],
      // ⑤ 状态管理 State（pageContextSummary 注入页面焦点/选中/下钻）
      ["⑤状态管理", ["页面聚焦", "下钻路径"]],
      // ⑥ 错误恢复 Recovery（分类恢复 + 复盘重试）——本单新增
      ["⑥错误恢复", ["错误恢复", "EMPTY_DATA", "SCOPE_VIOLATION"]],
      // ⑦ 结果规范 Final（五段决策模板）——本单新增
      ["⑦结果规范", ["结果结构", "结论", "关键分析", "证据", "建议", "风险"]],
    ];
    for (const [name, markers] of elements) {
      for (const m of markers) {
        expect(assembledSystemPrompt, `${name} 缺标志短语「${m}」`).toContain(m);
      }
    }
  });

  it("§6 求解纪律段在（排产/优化类问题必须调对口 solver·禁止心算）", () => {
    expect(AGENT_SYSTEM_CORE).toContain("求解纪律");
    for (const kw of ["排产", "优化", "产能约束", "可行性判断", "心算"]) {
      expect(AGENT_SYSTEM_CORE, `求解纪律缺关键词「${kw}」`).toContain(kw);
    }
  });

  /**
   * WO-CAPMAP-LIVE · 反写死护栏（**取代**原先 `toContain("capacity_feasibility"/"portfolio_optimize")` 的断言）。
   *
   * 原断言把两个 key **钉死**在 system prompt 里，而实测这两个 key **在活求解器注册表（59 条）里根本不存在**：
   *   · `capacity_feasibility` 是**意图** key，不是求解器（datacore `databuilder/comprehend.ts:149`
   *     写着 `capacity_feasibility: "capacity_forecast"` —— 意图→求解器的映射）；
   *   · `portfolio_optimize` 只作为**规则** key 存在（`portfolio_optimize_coeffs` 系数校准规则），
   *     真正的求解器叫 `portfolio`（`solvers/service.ts` SOLVER_KEYS）。
   * 即：prompt 在教模型去调两个不存在的 solver key，而测试在保证这句话不许改。
   * 现改为**反向**断言：求解纪律段里不许再内联具体 solver key（R14），改为指向导航图候选 + 检索。
   */
  it("求解纪律不内联具体 solver key（R14·选型指向活目录候选而非写死名单）", () => {
    const section = AGENT_SYSTEM_CORE.slice(AGENT_SYSTEM_CORE.indexOf("【求解纪律】"));
    for (const ghost of ["capacity_feasibility", "portfolio_optimize"]) {
      expect(section, `求解纪律仍内联了活注册表里不存在的 key「${ghost}」`).not.toContain(ghost);
    }
    // 正向：改为指向"导航图候选 + 检索"这条不写死的路。
    expect(section).toContain("导航图");
    expect(section).toMatch(/discover|retrieve_knowledge/);
  });

  it("旧红线短语一字不删（叠加改造的回归护栏）", () => {
    // lived-in.test:49 四要素
    for (const kw of ["数字红线", "写降级", "能力边界", "注入防护"]) {
      expect(AGENT_SYSTEM_CORE, `旧红线短语「${kw}」被删`).toContain(kw);
    }
    // qos-agent-slice-seam.test:90 导航图注入
    expect(AGENT_SYSTEM_CORE).toContain("本题导航图");
    // qos-b.test:172 注入防护
    expect(AGENT_SYSTEM_CORE).toContain("注入防护");
    // 收尾/写出口/预算纪律现有段仍在
    for (const kw of ["final_answer", "收尾纪律", "预算纪律", "工作方式"]) {
      expect(AGENT_SYSTEM_CORE, `现有段「${kw}」被删`).toContain(kw);
    }
  });

  it("四追加段为纯叠加：CEO 深问段 / 五角色片段以 AGENT_SYSTEM_CORE 为底自动继承四段", () => {
    // CEO_DEEP_QUESTION_SYSTEM = `${AGENT_SYSTEM_CORE}...` → 继承四追加段
    for (const kw of ["推理循环", "错误恢复", "求解纪律", "结果结构"]) {
      expect(CEO_DEEP_QUESTION_SYSTEM, `CEO 深问段未继承「${kw}」`).toContain(kw);
    }
    // 五角色片段自身只写角色视角（红线/四段由共享核继承·不重复）——确认片段登记齐
    for (const role of ["ceo", "supply-chain", "production", "quality", "base-planner"]) {
      expect(ROLE_SYSTEM_FRAGMENTS[role], `角色片段 ${role} 缺失`).toBeTruthy();
    }
  });

  it("四追加段各自完整成段（标题 + 关键动作短语）", () => {
    // ③ 推理循环：四步 + 反思自检 + 最多再规划 1 次
    expect(AGENT_SYSTEM_CORE).toContain("最多再规划 1 次");
    // ⑥ 错误恢复：绝不静默失败也绝不编造 + 取证失败标注
    expect(AGENT_SYSTEM_CORE).toContain("绝不静默失败也绝不编造");
    expect(AGENT_SYSTEM_CORE).toContain("取证失败");
    // ⑦ 结果结构：五段可行动判断
    expect(AGENT_SYSTEM_CORE).toContain("可行动判断");
  });
});
