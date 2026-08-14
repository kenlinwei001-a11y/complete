import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * 轨L 增量2：demo 本体经真建模链产出（chainMode）——provenance（R13）因果真实。
 * 验证根因方案（非 MAP_TO_EXISTING 盖戳捷径）：
 *  - 类型由 publishDraft 真 CREATE（存在性因果由链导致），sourceBindings 真由 publish 读真 rawDataset 算出；
 *  - 确定性策展 PATCH 保留 R14 派生属性 / 中文 displayName / 归域（零回归）；
 *  - obj id 统一 `obj_${type}_${pk}` → 与 A 路基线字节一致；R6 同 seed 重跑一致（无 LLM/时钟/随机）。
 */
describe("轨L 增量2 · demo 本体经真建模链（chainMode·provenance 因果真实）", () => {
  it("viaModelingChain → 34 类型由链 CREATE：sourceBindings 真、派生属性/中文名/域保留、obj id 字节同 A 路", async () => {
    const t = await makeApp();
    // 与 SEED_DEMO 启动路径一致：rawDataset→deriveModeling→确定性策展PATCH→publish→materialize 真链产出。
    await t.services.synthetic.runJob(t.adminCtx, {
      industry: "battery-manufacturing",
      scale: "S",
      seed: 42,
      viaModelingChain: true,
    });

    const types = (await (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json()) as Array<{
      key: string;
      displayName: string;
      domain: string;
      sourceBindings: Array<{ dataset: string; connId: string }>;
      derivedProperties: Array<{ propKey: string }>;
    }>;
    // 89 类型全由链 CREATE（66 基线 + WO-CEO-2 供应链/地缘/决策域 5 类 + WO-CEO-3 TriggerRule 1 类
    // + WO-CEO-DATA-2 每指标因果域 drill 类 9 类：CompetitorShare/CompetitorPrice/BidRecord/
    // PipelineOpportunity/WinLossRecord/PriceRealization/ARAging/DSO/OverdueRecord
    // + WO-EXCEPTION-EVENT 四源归一 ExceptionEvent 1 类
    // + integ-wave-11：WO-ATP-PROMISE/ORDERLINE/INVENTORY-3TIER/WAREHOUSE-CUSTLOC 6 类
    //   （OrderLine/OrderPromise/FinishedGoodsInventory/InventoryTxn/Warehouse/CustomerLocation）
    //   + WO-INTERBASE-TRANSFER 1 类（InterBaseTransfer）= +7 → 89）。
    //   + WO-TIER3 毛利桥 1 类（GrossMarginBridge·gross_profit 专属反向归因域 drill）→ 90。
    //   + WO-ADOPT-MITIGATION 1 类（AdoptedMitigation·已采纳处置方案台账·adopt_mitigation 执行器落点）→ 91。
    //     该类型**出厂零实例**（运行期由 Action 审批写入），故 objs 计数不变、下面的 provenance 校验也不覆盖它。
    //   + WO-SANDBOX D1×E1 接缝：Cadence（节拍落库·61 battery + 31 extended）→ 92。
    //   + WO-SANDBOX-D2 采购段两段承载 2 类（CustomsClearance 清关 / IncomingInspection 到货检验）→ 94。
    //     两类**均有实例**（清关仅进口单 1 条 · 检验每单必检 30 条），故下面的 provenance 校验覆盖它们。
    expect(types.length).toBe(94);
    // R13 provenance 因果真实：凡在 demo 中物化了实例的类型，其 sourceBindings 非空且指向同名真 rawDataset
    //（非硬编码模板）。Phase3 MES 类型（WorkOrder/WIP*/Equipment*E/Operator* 等）为轻量 demo 的
    // 本体模型定义、不落 demo 实例（否则单次 seed 逾万对象拖垮用例），无实例 provenance，故按物化类型校验。
    const materializedTypes = new Set((await t.repos.objects.list("demo")).map((o) => o.type));
    const provenanced = types.filter((ty) => materializedTypes.has(ty.key));
    expect(provenanced.length).toBeGreaterThanOrEqual(34); // 至少覆盖原 34 核心类型
    for (const ty of provenanced) {
      expect(ty.sourceBindings.length).toBeGreaterThan(0);
      // 源系统路由（mock→real）后 sourceBinding.dataset = 源系统表名（mes_base_master/erp_sales_orders 等），
      // 非类型键；校验其指向真 rawDataset（有源表名 + 连接器，provenance 因果真实、非硬编码模板）。
      expect(ty.sourceBindings.some((b) => !!b.dataset && !!b.connId)).toBe(true);
    }
    // 零回归：策展元数据（中文名 / 归域 / R14 派生属性叶子）保留。
    const base = types.find((x) => x.key === "Base")!;
    expect(base.displayName).toBe("生产基地");
    expect(base.domain).toBe("factory");
    expect(base.derivedProperties.map((d) => d.propKey).sort()).toEqual(["committedQty", "oeeIndex", "orderCount"]);
    const order = types.find((x) => x.key === "Order")!;
    expect(order.derivedProperties.map((d) => d.propKey)).toContain("value");
    // obj id 字节同 A 路基线：obj_base_changzhou 存在且 origin=MATERIALIZED（真经链物化，R13 可溯 rawDataset）。
    const obj = await t.repos.objects.get("demo", "obj_base_changzhou");
    expect(obj).toBeTruthy();
    expect(obj!.type).toBe("Base");
    expect(obj!.origin.type).toBe("MATERIALIZED");
    expect((obj!.origin as { datasetId?: string }).datasetId).toBeTruthy();
  });

  it("R6 确定性：viaModelingChain 同 seed 重跑 → 类型键集 + 对象 id 集字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await t.services.synthetic.runJob(t.adminCtx, {
        industry: "battery-manufacturing",
        scale: "S",
        seed: 42,
        viaModelingChain: true,
      });
      const types = (await t.services.ontology.listTypes(t.adminCtx)).map((x) => x.key).sort();
      const objs = (await t.repos.objects.list("demo")).map((o) => o.id).sort();
      return { types, objs };
    };
    const a = await run();
    const b = await run();
    expect(a.types).toEqual(b.types);
    expect(a.objs).toEqual(b.objs);
    expect(a.types.length).toBe(94); // +WO-TIER3 GrossMarginBridge；+WO-ADOPT-MITIGATION AdoptedMitigation（零实例 → objs 计数不变）；+WO-SANDBOX Cadence（节拍·8 实例）；+WO-SANDBOX-D2 CustomsClearance/IncomingInspection（92→94）
    // WO-SANDBOX-D2：+32 对象 = 进口供应商 SUP-015 宇部兴产 1 条（清关段唯一能走到实测分支的路，
    // 原 14 家 region 全境内 → 清关段恒 NOT_APPLICABLE = 接了线没数据）+ CustomsClearance 1 条（仅进口 PO）
    // + IncomingInspection 30 条（每张 PO 到货必检）。PurchaseOrder 仍 30 条、Material 仍 8 条（只加字段不加实例）。
    // WO-OPT-WHATIF-CLOSE：**11127 → 11320（+193）** = 首次物化 `MaintenanceOrder`（设备维修工单）。
    // 为什么对：该类型此前是「声明完整却零实例」——propDef(battery.ts:1581) + 展示名 + 连接器映射
    // (conn-eam/eam_maint_orders) + 数据类目(data-categories.ts) + 链路 maint_for_equip/spare_for_maint 全在，
    // 唯独 `generateBattery` 产的 193 行（hashString 派生·**零 rng 消耗**）从没进物化清单。193 = 780 台设备
    // 中 `hashString(equipId_mo)%4===0` 的那批（sparse ~25%），S/M/L/XL 同值。
    // **类型集仍 94**（类型早就在册，本次只补实例，故上一行 94 不动）。
    // 两条路都落它：`putAll` 在 chainMode 只产 rawDataset、非 chainMode 直物化，本用例走 viaModelingChain:true，
    // 生产路（seed.ts 传 false）由 `opt-whatif-close.seam.test.ts ⑤` 经 REST 合成 job 断言同为 193
    //（守铁律 0.5 #6：生产实参那条分支必须真的被某个测试覆盖）。
    expect(a.objs.length).toBe(11329); // WO-ORDER-JOURNEY：+2 对象（链路落点域 CausalFactor 2 条·cf-batch-idle[MaterialBatch.idleDays] / cf-base-capacity-contention[Base.util]·metricKey=chain_flow·**类型集仍 94**：CausalFactor 早在册，本次只补实例；补的是 `locus{objectType,objectId}` ↔ `CausalFactor{drillType,drillId}` 这一跳今天缺的两类落点）。// WO-FACTOR-SCOPE-SINGLESOURCE：+7 对象（产能域 CausalFactor 7 条·瓶颈工序/设备OEE/人力工时/物料齐套/物流时长/换型损失/良率波动·metricKey=capacity·**类型集仍 94**：CausalFactor 早在册，本次只补实例）。// WO-SANDBOX D1×E1 接缝：+8 对象（Cadence 全链节拍·4 SYNTHETIC 真推出周期 + 4 EMPTY 诚实缺席照样落库，使「查过没有」与「压根没登记」在下游分得开）。// WO-GSIM-1-DATA：+5 对象（电芯→电池包就近供芯 InterBaseTransfer·5 纯 PACK 基地各 1 条·T5 SEAM 物料·类型集不变）。 WO-TIER3：+8 对象（GrossMarginBridge 毛利桥 gmb-total/volume/price/cost·chainMode 物化·real 跑实测） // WO-CEO-1a：+10 对象（7 顶层/细分 Metric + 3 细分业务线 Principal）；WO-CEO-2/3：+22 对象（长协/备份池/矿价趋势/决策缺陷/因果因素 + 触发规则；类型集 66→72）；WO-CEO-DATA-2：+35 对象（商业/财务域每指标因果 drill 实例；类型集 72→81）；WO-EXCEPTION-EVENT：+734 对象（首次物化 DefectRecord/EquipmentDowntime/EquipmentAlarm 三源[R13 下钻]+ 四源归一 ExceptionEvent；类型集 81→82）；integ-wave-11：+7065 对象（narrowed-P0 首次物化 5 类决策 MES[WorkOrder/WIPLot/QualityLot/InspectionResult/EquipmentOEE 高量] + WO-ATP-PROMISE/ORDERLINE/INVENTORY-3TIER/WAREHOUSE-CUSTLOC[OrderLine/OrderPromise/FinishedGoodsInventory/InventoryTxn/Warehouse/CustomerLocation] + WO-INTERBASE-TRANSFER[InterBaseTransfer]；类型集 82→89）
  });
});
