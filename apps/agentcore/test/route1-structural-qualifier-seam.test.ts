import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { planCoordination, detectSingleRole, stripQualifierDomainTokens } from "../src/router/coordinator.js";

/**
 * WO-ROUTE-1 · ① 结构判据（定语位的域词不构成独立诉求）· ② 多角色路径旁白带角色标识（E9）。
 *
 * 这不是「给 S12/S13 补两个词」的门 —— 补词的门只会锁住那两句话。本门锁的是**结构性质**：
 * 定语一侧（工序名、交付动词族）随便换同义词都必须仍然成立，因为规则挂在**中心词**
 * （良率类指标 / 时间窗名词）上，而同义词爆炸恰恰只发生在定语一侧。
 * 若有人把实现退回成"往 ROLE_KEYWORDS 塞 涂布良率/交付高峰 两个词条"，②③ 立刻变红。
 */

const DEMO_PROD_FEATURES = [
  ...defaultOnKeys(),
  "qos.dril-routing",
  "agent.critic",
  "ceo.free-llm",
  "agent.coordinator",
  "qos.compose-path",
  "qos.reasoning-trace",
  "agent.escalation",
  "qos.deterministic-multi-domain",
  "qos.multi-intent-l3-coupled",
];

describe("WO-ROUTE-1 · 结构判据：定语位的域词不构成独立诉求（R6 纯函数·零 LLM）", () => {
  it("① 中和只剥定语、保中心词（原问句不改·仅用于域计数）", () => {
    expect(stripQualifierDomainTokens("涂布良率为什么掉了？")).toBe("良率为什么掉了？");
    expect(stripQualifierDomainTokens("常州工厂的涂布工序的合格率")).toBe("常州工厂的合格率");
    expect(stripQualifierDomainTokens("检修计划和交付高峰撞了怎么调？")).toBe("检修计划和高峰撞了怎么调？");
    // 中心词不是「良率类指标/时间窗」→ 一个字都不动（交付风险 = 诉求本体·必须留给三角）。
    expect(stripQualifierDomainTokens("常州这批订单的交付风险怎么解")).toBe("常州这批订单的交付风险怎么解");
    expect(stripQualifierDomainTokens("化成产能和良率都有问题")).toBe("化成产能和良率都有问题");
  });

  it("② S12/S13 四种说法全部不再被 Coordinator 抢答（含出厂注册原句）", () => {
    for (const q of [
      "涂布良率为什么掉了？", // S12 出厂注册原句
      "常州基地涂布良率为什么掉了？",
      "常州工厂的涂布工序直通率为啥下滑？",
      "涂布良率下降的根因是什么？",
      "检修计划和交付高峰撞了怎么调？", // S13 出厂注册原句
      "常州基地检修计划和交付高峰撞了怎么调？",
      "常州工厂的检修窗口跟交货高峰期冲突了，怎么错开？",
      "检修和交付高峰撞车，检修窗口该怎么挪？",
    ]) {
      expect(planCoordination(q, undefined, []), `「${q}」仍被拆成多角色会诊`).toBeUndefined();
    }
  });

  it("③ **结构性**（治同义词打地鼠）：定语一侧换任何同义词都仍成立——不是记住了那两句话", () => {
    // 工序侧：CAPACITY_PROCESS_RE 全表 × 质量指标中心词（ROLE_KEYWORDS quality 全表）笛卡尔积。
    for (const proc of ["涂布", "辊压", "卷绕", "叠片", "化成", "分容", "注液", "封装", "组装", "清洗"]) {
      for (const metric of ["良率", "合格率", "不良率", "一致性", "质量"]) {
        const q = `${proc}${metric}为什么掉了？`;
        expect(planCoordination(q, undefined, []), `「${q}」被拆成多角色会诊`).toBeUndefined();
      }
      // 「工序/的」连接成分也算定语位。
      expect(planCoordination(`${proc}工序的良率下降的根因是什么？`, undefined, [])).toBeUndefined();
    }
    // 交付侧：DELIVERY_RISK_RE 全词条 × 时间窗中心词全表。
    for (const verb of ["交付", "交期", "按时交", "能不能交"]) {
      for (const head of ["高峰", "高峰期", "旺季", "峰值", "爬坡期"]) {
        const q = `检修计划和${verb}${head}撞了怎么调？`;
        expect(planCoordination(q, undefined, []), `「${q}」被拆成多角色会诊`).toBeUndefined();
      }
    }
  });

  it("④ 红线·未误伤真会诊：需要多角色的题**仍**召集三角（三条既有用例逐字不变）", () => {
    expect(planCoordination("常州这批订单的交付风险怎么解", undefined, [])).toBeDefined();
    expect(planCoordination("交付风险怎么解", undefined, [])).toBeDefined();
    expect(planCoordination("常州交付风险：物料齐套、产能瓶颈、良率都看一下", undefined, [])).toBeDefined();
  });

  it("⑤ 诚实边界：真有**第二个独立诉求**时照样会诊（中和只剥定语位·不吞独立域词）", () => {
    // 「涂布」在定语位被剥，但「物料齐套」是另一条独立诉求 → 仍 2 域。
    expect(planCoordination("涂布良率掉了，物料齐套也跟不上", undefined, [])).toBeDefined();
    // 「化成」后面跟的是「产能」不是指标 → 不在定语位 → 生产域独立成立 → 仍 2 域。
    expect(planCoordination("化成产能和良率都有问题，怎么办", undefined, [])).toBeDefined();
    // 同一工序词出现两次，只有定语位那次被剥。
    expect(planCoordination("涂布良率掉了，涂布产能也不够", undefined, [])).toBeDefined();
  });

  it("⑥ detectSingleRole 与 planCoordination 用同一份中和视图（否则单域题落通用 agent 而非对口角色）", () => {
    expect(detectSingleRole("涂布良率为什么掉了？")).toBe("quality");
    expect(detectSingleRole("检修计划和交付高峰撞了怎么调？")).toBeUndefined(); // 无域词 → 通用 path-B
    // 既有用例不动。
    expect(detectSingleRole("物料齐套现在怎么样")).toBe("supply-chain");
    expect(detectSingleRole("这条产线产能瓶颈在哪")).toBe("production");
  });
});

describe("WO-ROUTE-1 · 多角色路径旁白**带角色标识**（E9 的第二半·前端要分栏显示谁在查什么）", () => {
  it("Coordinator 扇出：每条 agent_narration 带 role/roleLabel/agentId·stepId 各角色不互撞·≥2 个不同角色发过声", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
    for (const ag of seedRegistry().agents) if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [text(`第${i + 1}轮：先查一下再说。`), toolUse("discover", { kind: "solvers" })] });
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
    }

    const r = await submitQuery(t, ADMIN, "常州这批订单的交付风险怎么解", { view: "risk" });
    const task = await waitForTask(t, r.taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status), 25000);
    expect(task.classification?.model).toBe("coordinator"); // 证真的走了多角色路径
    expect(t.llm.agentRequests.length, "角色 agent 没跑起来 → 本用例无效").toBeGreaterThan(0);

    const events = await t.repos.events.listAfter(r.taskId, 0);
    const narr = events
      .map((e) => e.payload as { type?: string; stepId?: string; text?: string; role?: string; roleLabel?: string; agentId?: string } | undefined)
      .filter((p): p is NonNullable<typeof p> => p?.type === "agent_narration");

    expect(narr.length, "多角色路径上旁白一条都没发（E9）").toBeGreaterThan(0);
    for (const n of narr) {
      expect(n.role, "旁白没带角色标识 → 前端无法分栏").toBeTruthy();
      expect(n.roleLabel).toBeTruthy();
      expect(n.agentId).toBeTruthy();
      expect(n.text).toContain(`【${n.roleLabel}】`); // 当下时间线只渲染 text → 标识必须在文本里看得见
      expect(n.stepId).toMatch(/^dispatch_\d+\//); // 各角色 stepId 命名空间隔离（前端 stepId Map 不互相覆盖）
    }
    // 真·多角色：至少两个不同角色发过旁白，且 stepId 全局唯一（不互撞）。
    expect(new Set(narr.map((n) => n.role)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(narr.map((n) => n.stepId)).size).toBe(narr.length);
    await t.app.close();
  }, 60_000);
});
