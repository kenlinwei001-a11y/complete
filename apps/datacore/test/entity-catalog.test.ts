import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, debugUser } from "./helpers.js";
import { entitySimilarity, scoreEntities, buildFieldCatalog } from "../src/databuilder/entity-catalog.js";
import type { ObjectTypeDef } from "../src/domain.js";

/**
 * PRD-fde §3.2 实体与字段目录索引（P1 读模型）：消歧 + 字段目录。
 *
 * 故事脚本（~100 字）：规划员要建"常州基地产能紧张影响订单"的域,但脚本里写的是模糊的"常州/那个基地"。
 * 发动机必须先把它消歧成系统里**具体存在**的实体(常州基地),才能补对应数据——绝不带"那个基地"占位符
 * 往下走。同时要知道现有字段明细(订单有哪些字段、哪些是时序),才知道该补什么。验证:消歧端点把"常州"
 * 解析出 Base/常州 候选、把不存在的"火星基地"判域外(让上层走补录);字段目录列出类型字段含时序标记;R2 隔离。
 */
describe("PRD-fde §3.2 · 实体与字段目录索引（消歧 + 字段目录）", () => {
  it("纯函数 entitySimilarity/scoreEntities：相似度 + 行打分确定性（R6）", () => {
    expect(entitySimilarity("常州", "常州")).toBe(1);
    expect(entitySimilarity("常州基地", "常州")).toBeCloseTo(0.5, 5); // 子串包含
    expect(entitySimilarity("常州", "成都")).toBe(0);
    const rows = [{ id: "o1", props: { baseId: "base_cz", name: "常州" } }, { id: "o2", props: { baseId: "base_cd", name: "成都" } }];
    const cands = scoreEntities("常州", "Base", rows, 0.34);
    expect(cands.map((c) => c.label)).toEqual(["常州"]); // 只命中常州,成都被 minScore 滤掉
    expect(cands[0]!.score).toBe(1);
  });

  it("buildFieldCatalog：类型→字段,标出主键/时序/单位（元本体没有的层）", () => {
    const types: ObjectTypeDef[] = [{
      id: "ot1", tenantId: "demo", key: "Order", displayName: "订单", domain: "sales",
      properties: [
        { propKey: "so", dataType: "string", isPrimaryKey: true },
        { propKey: "qty", dataType: "number", isPrimaryKey: false, unit: "件" },
        { propKey: "utilization", dataType: "number", isPrimaryKey: false, temporal: true },
      ],
      derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    }];
    const cat = buildFieldCatalog(types);
    expect(cat[0]!.primaryKey).toBe("so");
    expect(cat[0]!.fields.find((f) => f.name === "utilization")!.temporal).toBe(true); // 时序字段标出
    expect(cat[0]!.fields.find((f) => f.name === "qty")!.unit).toBe("件");
  });

  it("GET /a/v1/entity-catalog/resolve：'常州'→具体候选;'火星基地'→域外(resolved=false)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const hit = await t.app.inject({ method: "GET", url: "/a/v1/entity-catalog/resolve?q=" + encodeURIComponent("常州") + "&type=Base", headers: ADMIN });
    const hj = hit.json() as { resolved: boolean; candidates: { typeKey: string; label: string }[] };
    expect(hj.resolved).toBe(true);
    expect(hj.candidates[0]!.typeKey).toBe("Base");
    expect(hj.candidates.some((c) => c.label === "常州")).toBe(true);

    const miss = await t.app.inject({ method: "GET", url: "/a/v1/entity-catalog/resolve?q=" + encodeURIComponent("火星基地") + "&type=Base", headers: ADMIN });
    const mj = miss.json() as { resolved: boolean; candidates: unknown[] };
    expect(mj.resolved).toBe(false); // 域外 → 上层走 InputManifest 补录,不猜
    expect(mj.candidates.length).toBe(0);
  });

  it("GET /a/v1/entity-catalog：字段目录列出类型 + R2 隔离", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/entity-catalog", headers: ADMIN });
    const items = (res.json() as { items: { typeKey: string; fields: unknown[] }[] }).items;
    expect(items.some((i) => i.typeKey === "Order")).toBe(true);
    expect(items.find((i) => i.typeKey === "Base")!.fields.length).toBeGreaterThan(0);
    // R2：别的租户空
    const other = await t.app.inject({ method: "GET", url: "/a/v1/entity-catalog", headers: debugUser("other", "u", "admin") });
    expect((other.json() as { items: unknown[] }).items.length).toBe(0);
  });
});
