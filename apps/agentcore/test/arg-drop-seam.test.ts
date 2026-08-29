import { describe, expect, it } from "vitest";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { collectSlotRefs } from "../src/util/template.js";
import { resolveCeoRoute, ceoIntentKeyForRoute, CEO_INTENT_KEYS, matchCustomerInQuery } from "../src/router/ceo-route.js";

/**
 * WO-SEAM-ARG-DROP · 数据半守卫（agentcore 包内快测·配合 datacore 全接缝测 arg-drop-seam.test.ts）。
 * 守 R-ARG-FIDELITY 结构不变量：CEO 意图的 plan solverArgs 里每个 {{slots.X}} 都有对口声明槽（无孤儿模板引用 →
 * 无运行期 TemplateResolutionError），且两 CONFIRMED 项（custName/scopeObjectIds）真进声明。
 */
describe("SEAM-ARG-DROP · CEO 种子数据半（slotNames × plan 模板 一致）", () => {
  const { intents, plans } = seedIntentsAndPlans("demo");
  const intentByKey = new Map(intents.map((i) => [i.key, i]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  it("每个 CEO 意图：plan solverArgs 的 {{slots.X}} 引用 ⊆ 声明槽（无孤儿模板引用）", () => {
    for (const key of CEO_INTENT_KEYS) {
      const intent = intentByKey.get(key);
      expect(intent, `缺 CEO 意图 ${key}`).toBeTruthy();
      const declared = new Set((intent!.slots ?? []).map((s) => s.name));
      // planId 在 Intent 契约上是可选的（草稿意图可以还没绑定 plan）；本用例断言的正是
      // 「CEO 意图都已绑定 plan」，故此处断言非空是判据的一部分，不是掩盖。
      const plan = planById.get(intent!.planId!)!;
      const invoke = (plan.steps as { type: string; params?: { args?: unknown } }[]).find((s) => s.type === "invoke_solver");
      const refs = invoke ? collectSlotRefs(invoke.params?.args ?? {}) : new Set<string>();
      for (const r of refs) {
        expect(declared.has(r), `意图 ${key} 的 plan 引用 {{slots.${r}}} 但未声明为槽（会 TemplateResolutionError）`).toBe(true);
      }
    }
  });

  it("CONFIRMED-1 ceo_credit_exposure：custName 已声明为槽 + plan 映射 {{slots.custName}}", () => {
    const intent = intentByKey.get("ceo_credit_exposure")!;
    expect((intent.slots ?? []).map((s) => s.name)).toContain("custName");
    const plan = planById.get(intent.planId!)!;
    const invoke = (plan.steps as { type: string; params: { args: unknown } }[]).find((s) => s.type === "invoke_solver")!;
    expect([...collectSlotRefs(invoke.params.args)]).toContain("custName");
    // 数据半 seam：credit 深问路由真解析出 custName（供该槽承接）。
    const route = resolveCeoRoute("国家电网的信用敞口有多大？", undefined, "ceo");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_credit_exposure");
    expect((route.args as { custName?: string }).custName).toBe("国家电网");
  });

  it("CONFIRMED-2 ceo_whatif：槽名对齐路由输出 scopeObjectIds（非 baseId）+ plan 映射 {{slots.scopeObjectIds}}", () => {
    const intent = intentByKey.get("ceo_whatif")!;
    const names = (intent.slots ?? []).map((s) => s.name);
    expect(names).toContain("scopeObjectIds");
    expect(names).not.toContain("baseId"); // 修前的错名（路由发 scopeObjectIds → 会丢）
    const plan = planById.get(intent.planId!)!;
    const invoke = (plan.steps as { type: string; params: { args: unknown } }[]).find((s) => s.type === "invoke_solver")!;
    expect([...collectSlotRefs(invoke.params.args)]).toContain("scopeObjectIds");
    // 数据半 seam：whatif 深问路由真发 scopeObjectIds（数组·供 json 槽承接）。
    const route = resolveCeoRoute("常州化成扩2通道能补多少缺口？", { focus: { base: "changzhou" } } as never, "ceo");
    expect((route.args as { scopeObjectIds?: string[] }).scopeObjectIds).toEqual(["changzhou"]);
  });

  /**
   * WO-CUST-SLOT-REGEX · 客户名槽位解析的**两侧**都要有牙。
   * 旧正则 `/([一-龥]{2,10}(?:客户|公司))/` 是照退役匿名代号（「电网公司F」）写的：
   * 换成真品牌名后 **20 家 0 命中**，而 10 个非客户词里 **5 个误命中** —— 两头都错。
   * 本组把「召回」与「精度」各钉一半，任一侧再退化都当场红。
   */
  describe("WO-CUST-SLOT-REGEX · 客户名抽取（召回 × 精度 两侧都钉）", () => {
    // 名册取自 DataCore 客户库实测（seed 42·20 家）。带机构后缀的 16 家必须命中。
    const WITH_SUFFIX = ["小鹏汽车", "零跑汽车", "广汽新能源", "长安汽车", "深蓝汽车", "合创汽车", "蔚来汽车",
      "吉利汽车", "国家电网", "南方电网", "国家电投", "小米汽车", "广汽集团", "智己汽车", "宇通客车", "东风汽车"];
    // 无机构后缀的 4 家：形态上抽不出（「大众」「现代」本身就是普通汉语词）——只能靠引号锚。
    // 这不是"漏了"，是**如实登记的缺口**：正解是把客户册提到 @platform/contracts（见 ceo-route.ts 文件内裁决）。
    const NO_SUFFIX = ["广汽埃安", "上汽通用五菱", "大众", "现代"];

    it("召回：16 家带机构后缀的真实客户，逐个从信用问句里抽出原名", () => {
      for (const n of WITH_SUFFIX) expect(matchCustomerInQuery(`${n}的信用敞口有多大？`), n).toBe(n);
    });

    it("召回：4 家无后缀客户经引号锚命中（登记缺口——裸名形态确实抽不出）", () => {
      for (const n of NO_SUFFIX) {
        expect(matchCustomerInQuery(`「${n}」的信用敞口有多大？`), n).toBe(n);
        expect(matchCustomerInQuery(`${n}的信用敞口有多大？`), `${n} 裸名`).toBeUndefined();
      }
    });

    it("精度：10 个不是客户名的中文词，一个都不许命中（误匹配 → 求解器 400，比漏匹配贵）", () => {
      for (const q of ["本月毛利怎么样", "常州基地的敞口", "这个客户还能接新单吗", "全部客户合计敞口是多少",
        "新能源汽车行业的信用风险", "我们的公司整体授信还剩多少", "下周的应收账款有多少",
        "产能利用率和信用额度", "各家公司的逾期情况", "主要客户的回款进度"]) {
        expect(matchCustomerInQuery(q), q).toBeUndefined();
      }
    });

    it("`g` 正则不许跨调用漏 lastIndex（模块级 /g + matchAll 的经典坑：第二次起开始丢命中）", () => {
      for (let i = 0; i < 5; i++) expect(matchCustomerInQuery("国家电网的信用敞口有多大？"), `第 ${i + 1} 次`).toBe("国家电网");
    });
  });
});
