import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { projectExceptionEvents, EXCEPTION_SEVERITY_CONFIG } from "../src/synthetic/battery.js";

/**
 * WO-EXCEPTION-EVENT · SEAM 验收（G-EXCEPTION-SCATTER 闭）。
 * 病根：四类异常（EquipmentDowntime/EquipmentAlarm/DefectRecord/TriggerRule）+缺料（MaterialBalance）
 * 五处散落无统一入口 → Agent「全监听」无处落地。ExceptionEvent = 四源归一确定性聚合投影。
 *
 * 接缝 = 「数据种源 × 投影引擎」：源行散在 generateBattery/generateExtended，投影落一等对象经 REST 可查。
 * 任一半漏（源没种 / 投影没接 / refId 断链 / severity 不随源变）即红。
 */

const OID = (refType: string, refId: string) => `obj_${refType.toLowerCase()}_${refId}`.replace(/[^\p{L}\p{N}_-]/gu, "_");

describe("WO-EXCEPTION-EVENT · 四源归一异常事件（SEAM）", () => {
  it("SEAM-1 四源归一：GET /a/v1/objects?type=ExceptionEvent&pageSize=500 覆盖 4 excType + 4 源", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=ExceptionEvent&pageSize=500", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { id: string; props: Record<string, unknown> }[] };
    const events = body.items;
    expect(events.length).toBeGreaterThanOrEqual(4);
    const excTypes = new Set(events.map((e) => String(e.props.excType)));
    // 四大异常类全归一（设备/质量/客户触发/物料短缺）——散落不再，统一入口成立。
    for (const t2 of ["EQUIPMENT", "QUALITY", "CUSTOMER", "MATERIAL_SHORTAGE"]) {
      expect(excTypes.has(t2)).toBe(true);
    }
    // 四原始散落源全在统一流中（缺料为补入第五源）。
    const sources = new Set(events.map((e) => String(e.props.source)));
    for (const s of ["downtime", "alarm", "defect", "trigger"]) {
      expect(sources.has(s)).toBe(true);
    }
    expect(sources.has("material_balance")).toBe(true);
    // severity/status 均落合法枚举。
    for (const e of events) {
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(String(e.props.severity));
      expect(["OPEN", "ACK", "RESOLVED"]).toContain(String(e.props.status));
    }
  });

  it("SEAM-2 refId 下钻回源对象（R13）：每源类型至少一条能解析到已物化真源，字段一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=ExceptionEvent&pageSize=500", headers: ADMIN });
    const events = (res.json() as { items: { props: Record<string, unknown> }[] }).items;

    // 对四类可物化源（downtime/alarm/defect/material_balance）各取一条，解析 refType/refId → 源对象，断言一致。
    const bySource = new Map<string, Record<string, unknown>>();
    for (const e of events) if (!bySource.has(String(e.props.source))) bySource.set(String(e.props.source), e.props);

    for (const src of ["downtime", "alarm", "defect", "material_balance", "trigger"]) {
      const ev = bySource.get(src);
      expect(ev, `源 ${src} 应有异常事件`).toBeTruthy();
      const refType = String(ev!.refType);
      const refId = String(ev!.refId);
      const srcObj = await t.repos.objects.get("demo", OID(refType, refId));
      expect(srcObj, `refId 应下钻回已物化源对象 ${refType}/${refId}（R13 不悬空）`).toBeTruthy();
      expect(srcObj!.type).toBe(refType);
    }

    // 具体字段一致：downtime 的 refId == 源 dtId；durationMin 决定 severity（下条 SEAM-3 深验）。
    const dtEv = bySource.get("downtime")!;
    const dtObj = await t.repos.objects.get("demo", OID(String(dtEv.refType), String(dtEv.refId)));
    expect(String(dtObj!.props.dtId)).toBe(String(dtEv.refId));
  });

  it("SEAM-3 改源 severity → 事件 severity 变桶（red-bite：数据×引擎接缝）", () => {
    const t0 = Date.parse("2026-06-10T00:00:00Z");
    // 同一停机源，durationMin 跨阈值 → severity 必换桶（LOW→CRITICAL），证投影真读源值。
    const low = projectExceptionEvents({ equipmentDowntimes: [{ dtId: "X", equipId: "E1", durationMin: 30, reason: "故障", status: "已恢复" }] }, t0);
    const crit = projectExceptionEvents({ equipmentDowntimes: [{ dtId: "X", equipId: "E1", durationMin: 300, reason: "故障", status: "已恢复" }] }, t0);
    expect(low[0]!.severity).toBe("LOW");
    expect(crit[0]!.severity).toBe("CRITICAL");
    expect(low[0]!.severity).not.toBe(crit[0]!.severity);
    // 中间桶亦随源变（120→HIGH, 60→MEDIUM），阈值出自配置表（R14·非散落魔数）。
    const high = projectExceptionEvents({ equipmentDowntimes: [{ dtId: "X", equipId: "E1", durationMin: 130, reason: "故障" }] }, t0);
    const mid = projectExceptionEvents({ equipmentDowntimes: [{ dtId: "X", equipId: "E1", durationMin: 90, reason: "故障" }] }, t0);
    expect(high[0]!.severity).toBe("HIGH");
    expect(mid[0]!.severity).toBe("MEDIUM");
    // 缺料桶亦随 gapTon 变（配置表驱动）。
    const gapCrit = projectExceptionEvents({ materialBalances: [{ matBalId: "m1", material: "三元正极", unit: "吨", gapTon: 9000 }] }, t0);
    const gapLow = projectExceptionEvents({ materialBalances: [{ matBalId: "m1", material: "三元正极", unit: "吨", gapTon: 100 }] }, t0);
    expect(gapCrit[0]!.severity).toBe("CRITICAL");
    expect(gapLow[0]!.severity).toBe("LOW");
    // gapTon<=0 不成异常（缺料才监听）。
    expect(projectExceptionEvents({ materialBalances: [{ matBalId: "m1", gapTon: 0 }] }, t0).length).toBe(0);
    // 配置表存在且单调（可审计·R14）。
    expect(EXCEPTION_SEVERITY_CONFIG.downtime[0]!.sev).toBe("CRITICAL");
  });

  it("R6 确定性：两次 seed → excId 集 + severity 字节一致", async () => {
    const runSeed = async () => {
      const t = await makeApp();
      await seedBattery(t);
      const objs = (await t.repos.objects.list("demo")).filter((o) => o.type === "ExceptionEvent");
      return objs
        .map((o) => `${o.props.excId}|${o.props.severity}|${o.props.status}|${o.props.refType}:${o.props.refId}`)
        .sort();
    };
    const a = await runSeed();
    const b = await runSeed();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(4);
  });
});
