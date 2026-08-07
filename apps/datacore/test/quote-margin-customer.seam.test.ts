import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import {
  ORDER_CUST_TO_CUSTOMER,
  businessTypeOfCustomer,
  customerNameOfOrderCust,
  customerSegKeyOf,
  segKeyOfBusinessType,
} from "../src/synthetic/battery.js";

/**
 * WO-QUOTE-MARGIN-CUSTOMER（欠账 #118）· **接缝驱动门**（SEAM-GATE·非各半 unit）。
 *
 * 病（修前实测·seed 42·scale S）：
 *  · 数据半 —— `order_of_customer` 由 `synthetic/service.ts` 按 `custIds[oi % custIds.length]` **轮转**绑定，
 *    与 `Order.cust` 名字毫无关系：「商用车集团G」名下 3 张全是广汽集团（乘用车）的单，
 *    「电网公司F」名下挂着宇通客车（商用车）的单 ⇒ **客户维在数据层根本不存在**。
 *  · 引擎半 —— `deriveExtendedArgs.quote_margin` 用 `mats.slice(0,4)` 取 `Material` 按 id 排序的前 4 行
 *    （al_foil/cell_case/cu_foil/elyte，**不含正极**）⇒ `bomCost` 恒 313.7452，与型号无关；
 *    `custName` 压根不读 ⇒ 换任意客户名输出**逐字节相同**。
 *  合起来：任何客户问毛利，拿到的是同一份数字，而答案上印着他问的那个客户名 = 假个性化。
 *
 * 本文件是**变异反证门**：退回任一半（轮转绑定 / Material 前 4 行）必须真红，见每条用例头部的「反证」注释。
 */
describe("WO-QUOTE-MARGIN-CUSTOMER · 客户维接缝（数据归属 × 引擎真 BOM）", () => {
  // ── ① 数据半：归属册 + 不变量 R-CUST-ATTRIB ─────────────────────────────────
  it("归属册覆盖全部订单客户名，且每条归属两端业态一致（轮转绑定必违反此式）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const customers = await t.repos.objects.listByType("demo", "Customer");
    const links = await t.repos.links.list("demo", (l) => l.type === "order_of_customer");
    expect(orders.length).toBeGreaterThan(0);
    expect(links.length).toBe(orders.length); // 24 单全部有归属，0 未绑定

    const custById = new Map(customers.map((c) => [String(c.props.custId), String(c.props.custName)]));
    const orderById = new Map(orders.map((o) => [o.id, o.props as Record<string, unknown>]));
    for (const l of links) {
      const o = orderById.get(l.fromId)!;
      const orderCust = String(o.cust);
      const custName = custById.get(String(l.props?.custId))!;
      // 边指向的客户 == 归属册说的那个客户（不是轮转出来的第 i%n 个）
      expect(custName, `订单 ${String(o.so)}(${orderCust}) 的归属`).toBe(customerNameOfOrderCust(orderCust));
      // 不变量 R-CUST-ATTRIB：两端业态一致。轮转绑定把乘用车的单挂到「商用车集团G」名下 → 这里必红。
      expect(customerSegKeyOf(custName), `订单 ${String(o.so)}(${orderCust}) 业态`).toBe(
        segKeyOfBusinessType(businessTypeOfCustomer(orderCust)),
      );
    }
    // 归属册本身自洽：每个登记的目标名都真的是一个 Customer
    for (const target of new Set(Object.values(ORDER_CUST_TO_CUSTOMER))) {
      expect([...custById.values()], `归属册目标 ${target}`).toContain(target);
    }
  });

  it("Customer.orderCustNames 与归属册互为反查（客户主数据侧能自证「我在订单上叫什么」）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const customers = await t.repos.objects.listByType("demo", "Customer");
    for (const c of customers) {
      const expected = Object.entries(ORDER_CUST_TO_CUSTOMER)
        .filter(([, target]) => target === String(c.props.custName))
        .map(([oc]) => oc)
        .sort();
      expect(c.props.orderCustNames, String(c.props.custName)).toEqual(expected);
    }
  });

  // ── ② 引擎半 + 差分门：两个不同客户 → 毛利真的不同，且各自可溯 ──────────────
  it("差分门：8 客户各自的毛利可溯到自己的订单与 BOM，且储能客户 ≠ 乘用车客户", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const names = ["整车厂A", "整车厂B", "整车厂C", "海外车企E", "商用车集团G", "储能集成商D", "储能集成商H", "电网公司F"];
    const got: Record<string, { margin: number; bomCost: number; price: number; scope: Record<string, unknown> }> = {};
    for (const custName of names) {
      const res = await invokeSolver(t, "quote_margin", { custName });
      expect(res.statusCode, `${custName}: ${res.body}`).toBe(200);
      const d = (res.json() as { data: Record<string, unknown> }).data;
      const scope = d.scope as Record<string, unknown>;
      got[custName] = {
        margin: d.margin as number,
        bomCost: (d.breakdown as { bomCost: number }).bomCost,
        price: (d.breakdown as { price: number }).price,
        scope,
      };
      // 可溯：答案上印的客户名 == 真正被算的那个；BOM 指得出是哪张；订单指得出是哪几张
      expect(scope.mode).toBe("CUSTOMER");
      expect(scope.custName).toBe(custName);
      expect(scope.bomId, `${custName} 的 bomId`).toMatch(/^BOM-/);
      expect(scope.bomRows, `${custName} 的 BOM 行数`).toBe(7); // 真 BOM 7 行（含正极），不是 Material 前 4 行
      expect(scope.dataMode).toBe("OK");
    }

    // 反证①（退回 Material 前 4 行）：bomCost 会恒为 313.7452 且 8 客户同值 → 下面两条必红。
    const bomCosts = new Set(Object.values(got).map((g) => g.bomCost));
    expect(bomCosts.size, `bomCost 取值集合=${[...bomCosts].join(",")}`).toBeGreaterThan(1);
    expect(bomCosts.has(313.7452), "bomCost 不得等于 Material 前 4 行的 313.7452").toBe(false);

    // 反证②（退回轮转绑定）：轮转下「电网公司F」名下会混进宇通客车(2170-NCM)的单，
    // 主力型号不再是储能型号 → 下面这条必红。
    expect(got["电网公司F"]!.scope.modelId).toBe("方形-LFP");
    expect(got["商用车集团G"]!.scope.modelId).toBe("2170-NCM"); // 宇通客车三单全是 2170-NCM
    expect(got["整车厂A"]!.scope.modelId).toBe("4680-NCM"); // 广汽集团主力

    // 差分门本体：储能客户与乘用车客户的毛利**真的不同**（修前两者逐字节相同）
    expect(got["电网公司F"]!.margin).not.toBe(got["整车厂A"]!.margin);
    expect(got["电网公司F"]!.bomCost).not.toBe(got["整车厂A"]!.bomCost);
    expect(got["电网公司F"]!.price).not.toBe(got["整车厂A"]!.price);

    // 每个客户的 orders 必须真的是他自己的单（scope.orders ⊆ 该客户名下）
    const links = await t.repos.links.list("demo", (l) => l.type === "order_of_customer");
    const orders = await t.repos.objects.listByType("demo", "Order");
    const soById = new Map(orders.map((o) => [o.id, String(o.props.so)]));
    for (const custName of names) {
      const custId = String((got[custName]!.scope as { custId: string }).custId);
      const owned = new Set(links.filter((l) => String(l.props?.custId) === custId).map((l) => soById.get(l.fromId)!));
      for (const so of got[custName]!.scope.orders as string[]) {
        expect(owned.has(so), `${custName} 的 scope.orders 含非本客户订单 ${so}`).toBe(true);
      }
    }
  });

  // ── ③ 作用域三态（照 credit_exposure 样板：不静默落首客户）──────────────────
  it("未命中客户 → 400 AMBIGUOUS_SCOPE（不静默落首个客户冒充答案）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "quote_margin", { custName: "不存在的客户X" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AMBIGUOUS_SCOPE");
  });

  it("未指定客户 → scope.mode=ALL（显式全域，非首客户）；直传 bom → scope.mode=EXPLICIT（R6 向后兼容）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await invokeSolver(t, "quote_margin", {});
    expect(all.statusCode).toBe(200);
    expect(((all.json() as { data: { scope: { mode: string } } }).data.scope).mode).toBe("ALL");

    // 调用方直传 bom/price（rules-p3 与 solvers-extended 走的就是这条路）→ 与上线前逐字节一致
    const explicit = await invokeSolver(t, "quote_margin", {
      price: 100,
      bom: [{ unit: 1, spotPrice: 40, processRate: 0.25 }],
      mfgRate: 0.1,
      logistics: 5,
      segmentFloor: 0.1,
    });
    expect(explicit.statusCode).toBe(200);
    const d = (explicit.json() as { data: { margin: number; breakdown: { bomCost: number }; scope: { mode: string } } }).data;
    expect(d.breakdown.bomCost).toBeCloseTo(50, 4);
    expect(d.margin).toBeCloseTo(0.35, 4);
    expect(d.scope.mode).toBe("EXPLICIT");
  });

  it("用下单品牌名提问（国家电网）也能落到对应客户（电网公司F）—— 两套命名之间有真映射", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const byAlias = await invokeSolver(t, "quote_margin", { custName: "国家电网" });
    expect(byAlias.statusCode).toBe(200);
    const s = (byAlias.json() as { data: { scope: { custName: string; orderCustNames: string[] } } }).data.scope;
    expect(s.custName).toBe("电网公司F");
    expect(s.orderCustNames).toContain("国家电网");
  });

  it("指定了该客户没下过的型号 → 明示 modelMatched:false + 单价来源（不静默丢弃实参·G-ARG-DROP-SEAM）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // S15 卡片的历史实参：电网公司F 名下并无 4680-NCM 在手单。
    const res = await invokeSolver(t, "quote_margin", { custName: "电网公司F", modelId: "4680-NCM" });
    expect(res.statusCode).toBe(200);
    const s = (res.json() as { data: { scope: Record<string, unknown> } }).data.scope;
    expect(s.modelMatched).toBe(false);
    expect(s.requestedModelId).toBe("4680-NCM");
    expect(String(s.priceSource)).toContain("Model.unitPrice");
    expect(s.bomId).toBe("BOM-4680-NCM-V1.0"); // 用户点名的型号，BOM 仍取该型号真 BOM
  });

  // ── ④ 口径自证：不发明换算常数，但也不藏着 ────────────────────────────────
  it("scope.unitBasis 把「价按套 / BOM 按台」的口径差写在输出里（G-QUOTE-BOM-PRICE-UNIT-SCALE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "quote_margin", { custName: "电网公司F" });
    const ub = (res.json() as { data: { scope: { unitBasis: Record<string, unknown> } } }).data.scope.unitBasis;
    expect(ub.coherent).toBe(false);
    expect(ub.gap).toBe("G-QUOTE-BOM-PRICE-UNIT-SCALE");
  });

  // ── ⑤ 真 BOM 数值锚（金值·独立复算）──────────────────────────────────────
  it("真 BOM 金值：4680-NCM=632.835 / 方形-LFP=540.2012（Σ 单台用量×现价×(1+损耗)，含正极）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const details = await t.repos.objects.listByType("demo", "BOMDetail");
    const materials = await t.repos.objects.listByType("demo", "Material");
    const priceOf = new Map(materials.map((m) => [String(m.props.matId), Number(m.props.unitPrice)]));
    const costOf = (bomId: string) =>
      Math.round(
        details
          .filter((d) => String(d.props.bomId) === bomId)
          .reduce((s, d) => s + Number(d.props.quantity) * (priceOf.get(String(d.props.materialId)) ?? 0) * (1 + Number(d.props.lossRate)), 0) * 1e4,
      ) / 1e4;
    expect(costOf("BOM-4680-NCM-V1.0")).toBeCloseTo(632.835, 3);
    expect(costOf("BOM-方形-LFP-V1.0")).toBeCloseTo(540.2012, 3);

    // 求解器输出与独立复算一致（引擎没有偷偷换算子）
    const ncm = await invokeSolver(t, "quote_margin", { custName: "整车厂A" });
    expect((ncm.json() as { data: { breakdown: { bomCost: number } } }).data.breakdown.bomCost).toBeCloseTo(632.835, 3);
    const lfp = await invokeSolver(t, "quote_margin", { custName: "电网公司F" });
    expect((lfp.json() as { data: { breakdown: { bomCost: number } } }).data.breakdown.bomCost).toBeCloseTo(540.2012, 3);
  });

  // ── ⑥ 确定性（R6）：同 seed 重跑逐字节一致 ────────────────────────────────
  it("R6：同 (industry, scale, seed) 两次种子 → 归属边与 quote_margin 输出逐字节一致", async () => {
    const run = async () => {
      const t: TestApp = await makeApp();
      await seedBattery(t);
      const links = (await t.repos.links.list("demo", (l) => l.type === "order_of_customer"))
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((l) => `${l.id}|${l.fromId}|${l.toId}|${JSON.stringify(l.props)}`)
        .join("\n");
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/solvers/quote_margin/invoke",
        headers: ADMIN,
        payload: { args: { custName: "电网公司F" } },
      });
      return `${links}\n---\n${JSON.stringify((res.json() as { data: unknown }).data)}`;
    };
    expect(await run()).toBe(await run());
  });
});
