import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { CUSTOMER_REGISTRY, CUSTOMER_GROUP_REGISTRY, buildCustomerGroups } from "../src/synthetic/battery.js";

const TENANT = "demo";

/**
 * WO-CUSTOMER-GROUP · 集团归属接缝驱动组合测（SEAM-GATE 头号判据）。
 *
 * ## 这个接缝是什么
 * 「客户名册声明归属」（数据半）×「集团行 + `customer_belongs_to_group` 边落库」（本体半）——
 * 任一半漏了，**集团敞口就算不出来**，而两半各自的 unit 测都会是绿的：
 * 名册那半只要字段在就绿；本体那半只要边的条数对就绿。
 * 故这里断的是**端到端的那个数**：沿图走出来的集团敞口。
 *
 * ## 今天的行为是 X，应该是 Y（本单的立项句）
 * **X**：`CUSTOMER_REGISTRY` 是平坦 20 行，「广汽埃安/广汽新能源/广汽集团 同属一个集团」
 *       **只写在注释里**，下游一个字读不到 ⇒ 屏上是三行互不相干的客户。
 * **Y**：集团是一等对象，客户经 `customer_belongs_to_group` 指向它 ⇒
 *       「丢掉广汽会怎样」由下游沿图**现算**，不必让 COO 自己把三行加起来。
 */
describe("WO-CUSTOMER-GROUP · 客户集团归属接缝驱动组合测", () => {
  const listByType = (t: TestApp, type: string) => t.repos.objects.listByType(TENANT, type);

  /** 沿图现算某集团的订单敞口：CustomerGroup ←belongs_to— Customer ←order_of_customer— Order。 */
  async function groupExposure(t: TestApp, groupId: string): Promise<number> {
    const belongs = await t.repos.links.list(TENANT, (l) => l.type === "customer_belongs_to_group");
    const memberObjIds = new Set(belongs.filter((l) => l.toId === `obj_customergroup_${groupId}`).map((l) => l.fromId));
    const ooc = await t.repos.links.list(TENANT, (l) => l.type === "order_of_customer");
    const orderObjIds = ooc.filter((l) => memberObjIds.has(l.toId)).map((l) => l.fromId);
    let sum = 0;
    for (const oidStr of orderObjIds) {
      const o = await t.repos.objects.get(TENANT, oidStr);
      if (!o) continue;
      // `Order.value` 是派生属性（`qty * unitPrice`）⇒ 这里从两个**基础**字段现算，
      // 不依赖派生管线是否已物化（否则本测会去验派生管线，而不是验归属接缝）。
      sum += Number(o.props.qty ?? 0) * Number(o.props.unitPrice ?? 0);
    }
    return sum;
  }

  it("SEAM-1 · 集团行落库且每个客户恒有一条归属边（⛔ 无 null 归属）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const customers = await listByType(t, "Customer");
    const groups = await listByType(t, "CustomerGroup");
    // 金丝雀：客户必须有实例，否则下面的 0 是遍历坏了不是边没建。
    expect(customers.length, "金丝雀：Customer 无实例 ⇒ 遍历坏了").toBe(CUSTOMER_REGISTRY.length);
    expect(customers.length).toBe(20);

    // 20 家客户去重成 16 个集团（广汽 3 / 长安 2 / 上汽 2 并成 3 个，其余 13 家各自单体）。
    expect(groups.length, "集团行数 = 名册 group 取值去重").toBe(16);

    // ⛔ 归属恒不为空：边数 == 客户数（一个都不许漏，含单体集团）。
    const belongs = await t.repos.links.list(TENANT, (l) => l.type === "customer_belongs_to_group");
    expect(belongs.length, "有客户没有归属边 ⇒ 下游又得写「没有集团」那一支分支").toBe(customers.length);
    for (const c of customers) {
      expect(String(c.props.groupRef ?? ""), `客户 ${String(c.props.custName)} 的 groupRef 为空`).not.toBe("");
    }
    // 每条边两端都解析得到真对象（不是悬空 id）
    for (const l of belongs) {
      const from = await t.repos.objects.get(TENANT, l.fromId);
      const to = await t.repos.objects.get(TENANT, l.toId);
      expect(from?.type).toBe("Customer");
      expect(to?.type).toBe("CustomerGroup");
    }
  });

  it("SEAM-2 · 广汽系三个主体归一集团；⛔ 国家电网 ≠ 国家电投（前缀相同不是同一集团）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const customers = await listByType(t, "Customer");
    const groupOf = (name: string) => String(customers.find((c) => c.props.custName === name)!.props.groupRef);

    // 真集团：三个**不同法人**归一集团（这正是仓主说的「客户名称重复出现」那件事的修法）
    expect(groupOf("广汽埃安")).toBe("grp_gac");
    expect(groupOf("广汽新能源")).toBe("grp_gac");
    expect(groupOf("广汽集团")).toBe("grp_gac");
    expect(groupOf("长安汽车")).toBe("grp_changan");
    expect(groupOf("深蓝汽车")).toBe("grp_changan");
    expect(groupOf("上汽通用五菱")).toBe("grp_saic");
    expect(groupOf("智己汽车")).toBe("grp_saic");

    // ⛔ 反向判据（错连比不连坏得多）：前缀相同但互不隶属的两家**必须**各自成集团。
    // 「国家电网」与「国家电投」是两家独立央企；按字符串前缀归会把它们并掉**且不报错**。
    expect(groupOf("国家电网")).toBe("grp_sgcc");
    expect(groupOf("国家电投")).toBe("grp_spic");
    expect(groupOf("国家电网")).not.toBe(groupOf("国家电投"));
    expect(groupOf("南方电网")).not.toBe(groupOf("国家电网"));
    // 合创**不归**广汽系（广汽埃安仅参股 25%·控股方另有其人）——「存疑不硬归」的落地断言
    expect(groupOf("合创汽车")).not.toBe("grp_gac");

    // groupType：多主体 = GROUP，单体 = STANDALONE（独立客户自成一集团，不留 null）
    const groups = await listByType(t, "CustomerGroup");
    const gt = (gid: string) => String(groups.find((g) => g.props.groupId === gid)!.props.groupType);
    expect(gt("grp_gac")).toBe("GROUP");
    expect(gt("grp_changan")).toBe("GROUP");
    expect(gt("grp_saic")).toBe("GROUP");
    expect(gt("grp_xpeng")).toBe("STANDALONE");
    expect(gt("grp_sgcc")).toBe("STANDALONE");
    expect(groups.filter((g) => g.props.groupType === "GROUP").length).toBe(3);
    expect(groups.filter((g) => g.props.groupType === "STANDALONE").length).toBe(13);
  });

  it("SEAM-3 · 对照实验：广汽埃安敞口 +Δ ⇒ 广汽系同步 +Δ，而小鹏系纹丝不动", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // —— 改前两个数 ——
    const gacBefore = await groupExposure(t, "grp_gac");
    const xpengBefore = await groupExposure(t, "grp_xpeng");
    // 金丝雀：两个集团都得有敞口，否则「不动」这个结论是「本来就是 0」冒充的。
    expect(gacBefore, "金丝雀：广汽系敞口为 0 ⇒ 遍历坏了，下面的「变化」无意义").toBeGreaterThan(0);
    expect(xpengBefore, "金丝雀：小鹏系敞口为 0 ⇒ 「不动」会被 0==0 冒充").toBeGreaterThan(0);

    // —— 施加扰动：只动「广汽埃安」名下的一张订单 ——
    const customers = await listByType(t, "Customer");
    const aion = customers.find((c) => c.props.custName === "广汽埃安")!;
    const ooc = await t.repos.links.list(TENANT, (l) => l.type === "order_of_customer");
    const aionOrderIds = ooc.filter((l) => l.toId === `obj_customer_${String(aion.props.custId)}`).map((l) => l.fromId);
    expect(aionOrderIds.length, "金丝雀：广汽埃安名下无订单 ⇒ 扰动打不出去").toBeGreaterThan(0);

    const target = (await t.repos.objects.get(TENANT, aionOrderIds[0]!))!;
    const addQty = 1000;
    const delta = addQty * Number(target.props.unitPrice ?? 0);
    expect(delta, "金丝雀：单价为 0 ⇒ Δ 恒为 0，本实验测不出东西").toBeGreaterThan(0);
    await t.repos.objects.put({
      ...target,
      props: { ...target.props, qty: Number(target.props.qty ?? 0) + addQty },
    });

    // —— 改后两个数 ——
    const gacAfter = await groupExposure(t, "grp_gac");
    const xpengAfter = await groupExposure(t, "grp_xpeng");

    // ① 归属真的连上了：集团敞口按成员的变化**同步**变化
    expect(gacAfter - gacBefore, "广汽系敞口没跟着成员动 ⇒ 归属边没连上").toBeCloseTo(delta, 6);
    // ② 没有错连：不相干的集团**纹丝不动**（只验 ① 是不够的——全连成一个集团时 ① 也会通过）
    expect(xpengAfter, "小鹏系敞口跟着广汽动了 ⇒ 错连（全连成一个集团）").toBe(xpengBefore);
  });

  it("R6 · 确定性：同 seed 两次跑，集团行字节级一致", async () => {
    const hashOf = async () => {
      const t = await makeApp();
      await seedBattery(t);
      const rows = (await listByType(t, "CustomerGroup"))
        .map((g) => `${String(g.props.groupId)}|${String(g.props.name)}|${String(g.props.groupType)}`)
        .sort();
      return createHash("sha256").update(rows.join("\n")).digest("hex");
    };
    const h1 = await hashOf();
    const h2 = await hashOf();
    expect(h1).toBe(h2);
    // 金丝雀：hash 不是空串的 hash（空集合两次也相同，那样这条断言什么都没证明）
    expect(h1).not.toBe(createHash("sha256").update("").digest("hex"));
  });

  it("派生式自证 · buildCustomerGroups 拒绝未声明的集团（不静默回落成「自己一个人的集团」）", () => {
    // 声明册内的 id 正常出行
    const ok = buildCustomerGroups([
      { groupId: "grp_gac", fallbackName: "X" },
      { groupId: "grp_gac", fallbackName: "X" },
      { groupId: "grp_xpeng", fallbackName: "Y" },
    ]);
    expect(ok.find((g) => g.groupId === "grp_gac")!.groupType).toBe("GROUP");
    expect(ok.find((g) => g.groupId === "grp_gac")!.name).toBe("广汽集团"); // 取声明册的名，不取 fallback
    expect(ok.find((g) => g.groupId === "grp_xpeng")!.groupType).toBe("STANDALONE");

    // 拼错的 id ⇒ throw（照 PROVINCE_MACRO_REGION 的老规矩），不静默造出一个假集团
    expect(() => buildCustomerGroups([{ groupId: "grp_gca", fallbackName: "拼错了" }])).toThrow(/不在 CUSTOMER_GROUP_REGISTRY/);

    // 生成集团（规模补足客户·一人一集团）是唯一例外，用 fallback 名
    const gen = buildCustomerGroups([{ groupId: "grp_x7", fallbackName: "客户008" }]);
    expect(gen[0]!.name).toBe("客户008");
    expect(gen[0]!.groupType).toBe("STANDALONE");

    // 名册自洽：每个客户的 group 都在声明册里（漏一个即红）
    const declared = new Set(CUSTOMER_GROUP_REGISTRY.map((g) => g.groupId));
    for (const c of CUSTOMER_REGISTRY) expect(declared.has(c.group), `客户 ${c.name} 的集团未声明`).toBe(true);
    // 反向：声明册里不许有零成员的死集团
    const used = new Set(CUSTOMER_REGISTRY.map((c) => c.group));
    for (const g of CUSTOMER_GROUP_REGISTRY) expect(used.has(g.groupId), `集团 ${g.groupId} 零成员`).toBe(true);
  });
});
