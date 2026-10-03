import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import {
  ORDER_CUST_TO_CUSTOMER,
  CUSTOMER_REGISTRY,
  MODELS,
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
    // 册子不许因 custId 撞号而悄悄塌掉：塌掉后下面每条 `custById.get(...)` 都会取到别人的名字，
    // 而"归属两端业态一致"这条仍可能碰巧成立 —— 先把"册子本身是一一对应"钉住。
    expect(custById.size).toBe(customers.length);
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
    // 反查表一个客户都没有时，下面的循环一圈不跑而本条恒绿 ——「互为反查」根本没被验过。
    // 下限咬住归属册的目标客户数（册子加一个客户 ⇒ 这里先红，逼着确认主数据侧也长出来了）。
    expect(customers.length).toBe(new Set(Object.values(ORDER_CUST_TO_CUSTOMER)).size);
    for (const c of customers) {
      const expected = Object.entries(ORDER_CUST_TO_CUSTOMER)
        .filter(([, target]) => target === String(c.props.custName))
        .map(([oc]) => oc)
        .sort();
      expect(c.props.orderCustNames, String(c.props.custName)).toEqual(expected);
    }
  });

  // ── ② 引擎半 + 差分门：两个不同客户 → 毛利真的不同，且各自可溯 ──────────────
  it("差分门：20 客户各自的毛利可溯到自己的订单与 BOM，且储能客户 ≠ 乘用车客户", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // WO-ORDER-BOOK-500：名单**从名册现取**，不再在测试里另抄一份客户名 ——
    // 抄一份的后果刚刚真实发生过：名册退役匿名代号后，这里还咬着「整车厂A/电网公司F」，
    // 而那些客户已经不存在了。名单从单一来源取，加客户/改名都不会让这条用例悄悄漏测。
    const names = CUSTOMER_REGISTRY.map((c) => c.name);
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

    // 反证②（退回轮转绑定）：轮转会把别的业态的单挂到这个客户名下 → 主力型号的**化学体系**跑到对面去。
    // WO-ORDER-BOOK-500 把判据从「写死三个型号串」换成「**逐客户**核对化学体系与业态相符」：
    //  · 写死串的版本刚刚被证明是**假的耐久**——它只在 24 张手写单那份数据上成立，订单簿一扩就全红，
    //    而求解器一行没改。形态：「我用『主力型号恰好等于这个串』当作『归属没串台』的证据。」
    //  · 现在这版对**全部 20 家**都咬，覆盖面比原来 3 条断言更大：轮转绑定会让储能客户的主力型号
    //    落到动力型号上（反之亦然），任何一家串台即红。
    const posOf = new Map(MODELS.map((m) => [m.modelId, m.pos]));
    for (const custName of names) {
      const seg = customerSegKeyOf(custName);
      const pos = String(posOf.get(String(got[custName]!.scope.modelId)) ?? "");
      expect(pos, `${custName}(${seg}) 的主力型号 ${String(got[custName]!.scope.modelId)} 不在型号表里`).not.toBe("");
      // 储能客户的主力型号必须可用于储能；动力（乘用/商用）客户的必须可用于动力。
      expect(pos.includes(seg === "ess" ? "储能" : "动力"), `${custName}(${seg}) 主力型号 ${String(got[custName]!.scope.modelId)} 用途=${pos} 与业态不符 ⇒ 归属串台`).toBe(true);
    }

    // 差分门本体：储能客户与乘用车客户的毛利**真的不同**（修前两者逐字节相同）。
    // 取名册里的头部储能客户与头部乘用车客户各一家（不写死名字·随名册走）。
    const essName = names.find((n) => customerSegKeyOf(n) === "ess")!;
    const pasName = names.find((n) => customerSegKeyOf(n) === "pas")!;
    expect(got[essName]!.margin).not.toBe(got[pasName]!.margin);
    expect(got[essName]!.bomCost).not.toBe(got[pasName]!.bomCost);
    expect(got[essName]!.price).not.toBe(got[pasName]!.price);

    // 每个客户的 orders 必须真的是他自己的单（scope.orders ⊆ 该客户名下）
    const links = await t.repos.links.list("demo", (l) => l.type === "order_of_customer");
    const orders = await t.repos.objects.listByType("demo", "Order");
    const soById = new Map(orders.map((o) => [o.id, String(o.props.so)]));
    for (const custName of names) {
      const custId = String((got[custName]!.scope as { custId: string }).custId);
      const owned = new Set(links.filter((l) => String(l.props?.custId) === custId).map((l) => soById.get(l.fromId)!));
      const sos = got[custName]!.scope.orders as string[];
      // scope.orders 为空时下面一圈不跑：「每个客户的 orders 都是他自己的单」在"一张单都没有"
      // 的客户上恒真 —— 而那恰恰是求解器算错作用域最典型的表现。
      expect(sos.length, `${custName} 的 scope.orders 为空 ⇒ 归属校验空跑`).toBeGreaterThan(0);
      for (const so of sos) {
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

  it("点名的客户算不出真 BOM → 400 EMPTY_SCOPE（不回落 Material 前 4 行冒充该客户的成本）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 造一个「客户在库、但名下拿不到真 BOM」的形态：指定一个库里没有 BOM 的型号。
    // 修前该形态会静默回落到 `mats.slice(0,4)` 的 313.7452，并把客户名印在答案上——比修前更像真的。
    const probeCust = CUSTOMER_REGISTRY[0]!.name;
    const res = await invokeSolver(t, "quote_margin", { custName: probeCust, modelId: "不存在的型号Z" });
    expect(res.statusCode, res.body).toBe(400);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("EMPTY_SCOPE");
    expect(err.message).toContain(probeCust);
    expect(err.message).toContain("Material 前 4 行");
  });

  // ── ④ 客户维**可被按图走的工具找到**（WO-ORDER-BOOK-500 · 名字对齐的真正验收点）────────
  it("集中度按客户走得通（>0 个集中点），且按型号的金丝雀同时成立（证明不是把工具改宽了）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const conc = async (viaField: string, toType: string) => {
      const res = await invokeSolver(t, "concentration_risk", {
        startType: "Order", path: [{ viaField, toType }], minDependents: 2,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { concentrations: { rootId: string; count: number }[] } }).data.concentrations;
    };

    // 命门：修前这里恒为 **0 个** —— `Order.cust` 存的是显示名「东风汽车」，而集中度求解器按
    // `Customer` 的**主键** `custId` 建索引，拿显示名去查主键索引每一跳都断链。
    // 修后 `Order.customerId` 存主键且声明成 ref ⇒ 这条边对「按图走」的工具真实存在。
    const byCust = await conc("customerId", "Customer");
    expect(byCust.length, "客户集中度回 0 个 ⇒ 订单与客户档案又对不上号了").toBeGreaterThan(0);

    // 金丝雀（**必须同时成立**）：同一个求解器、同样的走法，按型号一直是通的。
    // 它证明上面那条转绿是因为**数据对上号了**，不是因为把求解器/门槛改宽了。
    const byModel = await conc("model", "Model");
    expect(byModel.length, "型号金丝雀也回 0 ⇒ 是工具坏了，不是数据修好了").toBeGreaterThan(0);

    // 集中度必须真的**不平均**：平均分给 20 家 ⇒ 头名占比恒 ≈1/20，这个分析就等于做死了。
    const total = byCust.reduce((a, c) => a + c.count, 0);
    const top1 = Math.max(...byCust.map((c) => c.count));
    expect(top1 / total, `头名客户占比 ${(top1 / total * 100).toFixed(1)}% ≈ 平均分(1/${byCust.length}) ⇒ 长尾没生效`)
      .toBeGreaterThan(1.5 / byCust.length);
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

  // ⚠ WO-ORDER-BOOK-500：本条的**判据变了**，因为它守的那个东西已经从根上不存在了，请连着读。
  // 原判据：「用下单品牌名『国家电网』提问 → 落到客户档案名『电网公司F』—— 两套命名之间有真映射」。
  // 那条断言的前提是**订单侧和档案侧各有一套名字**，靠一张 14→8 的映射表搭桥。
  // 这套两名制正是本单修掉的病根：按名字/主键对号的工具全部落空（集中度问客户实测回 0 个）。
  // 名册收敛成**一套名字**之后，「两套命名之间的映射」这个被测对象本身消失了 ——
  // 继续保留原断言只能靠再造一份别名表，那就是把病重新种回去。
  // 新判据（更强）：**逐个客户**核对「订单上写的名字 ≡ 客户档案上的名字 ≡ 求解器回显的名字」，
  // 三者任一处再分叉，这里当场红。
  it("订单品牌名 ≡ 客户档案名（单一名册·不再有两套命名需要映射）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const customers = await t.repos.objects.listByType("demo", "Customer");
    const custNames = new Set(customers.map((c) => String(c.props.custName)));

    // ① 数据层：订单上出现的每个客户名，都**逐字**是一个 Customer 的 custName（0 个对不上号）。
    const orderCusts = [...new Set(orders.map((o) => String(o.props.cust)))];
    expect(orderCusts.length, "订单里一个客户名都没有 ⇒ 种子坏了").toBeGreaterThan(0);
    const unmatched = orderCusts.filter((c) => !custNames.has(c));
    expect(unmatched, `订单客户名在客户档案里找不到（又变回两套名字了）：${unmatched.join("、")}`).toEqual([]);

    // ② 求解器层：拿订单上写的那个名字去问，回显的 custName 一字不差就是它本身（不需要任何别名换算）。
    for (const name of orderCusts) {
      const res = await invokeSolver(t, "quote_margin", { custName: name });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
      const s = (res.json() as { data: { scope: { custName: string; orderCustNames: string[] } } }).data.scope;
      expect(s.custName, `用「${name}」提问，求解器却回显成「${s.custName}」`).toBe(name);
      expect(s.orderCustNames, `${name} 的下单品牌名自证`).toContain(name);
    }
  });

  it("指定了该客户没下过的型号 → 明示 modelMatched:false + 单价来源（不静默丢弃实参·G-ARG-DROP-SEAM）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 储能客户名下不会有 4680-NCM 在手单（NCM 是动力体系·储能客户只下 LFP —— 见 MODELS.pos 与
    // `modelsForBusinessType`）。原文这里用的是匿名代号「电网公司F」，随名册退役换成它代表的真客户。
    const res = await invokeSolver(t, "quote_margin", { custName: "国家电网", modelId: "4680-NCM" });
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
    const res = await invokeSolver(t, "quote_margin", { custName: "国家电网" });
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

    // 求解器输出与独立复算一致（引擎没有偷偷换算子）。
    // 原文点名两个客户（整车厂A / 电网公司F）当 NCM/LFP 的代表 —— 那是把「哪家客户的主力型号是什么」
    // 当成了常量，客户名册一变就指空。改成**逐客户**核对：无论该客户主力型号是哪个，
    // 求解器给的 bomCost 必须等于该型号 BOM 的独立复算值。覆盖面从 2 家变成 20 家，且不写死名字。
    let sawNcm = false, sawLfp = false;
    for (const custName of CUSTOMER_REGISTRY.map((c) => c.name)) {
      const r = await invokeSolver(t, "quote_margin", { custName });
      expect(r.statusCode, `${custName}: ${r.body}`).toBe(200);
      const d = r.json() as { data: { scope: { bomId: string; modelId: string }; breakdown: { bomCost: number } } };
      expect(d.data.breakdown.bomCost, `${custName}(${d.data.scope.modelId}) 的 bomCost 与独立复算不符`)
        .toBeCloseTo(costOf(d.data.scope.bomId), 3);
      if (d.data.scope.modelId === "4680-NCM") sawNcm = true;
      if (d.data.scope.modelId === "方形-LFP") sawLfp = true;
    }
    // 金丝雀：上面那圈必须真的走到过这两个金值型号，否则「逐客户都对」可能是在一堆别的型号上空转。
    expect(sawNcm, "20 家客户里没有一家主力型号是 4680-NCM ⇒ 632.835 这个金值没被任何客户路走到").toBe(true);
    expect(sawLfp, "20 家客户里没有一家主力型号是 方形-LFP ⇒ 540.2012 这个金值没被任何客户路走到").toBe(true);
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
        payload: { args: { custName: "国家电网" } },
      });
      return `${links}\n---\n${JSON.stringify((res.json() as { data: unknown }).data)}`;
    };
    expect(await run()).toBe(await run());
  });
});
