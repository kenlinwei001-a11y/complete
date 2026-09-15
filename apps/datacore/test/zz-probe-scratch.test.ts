// SCRATCH PROBE — 临时测量，交付前删除。
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { STATE_VAR_DISPLAY_NAMES, PROP_DISPLAY_NAMES } from "../src/synthetic/battery.js";

const CAND = ["qty", "unitPrice", "leadDays", "value", "dueMonth"];

describe("PROBE2", () => {
  it("dump", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos, "demo");

    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
    const types = res.json() as { key: string; properties: { propKey: string; unit?: string; dataType?: string; description?: string }[] }[];
    console.log("### TYPES:", types.length);

    // 🐤 金丝雀：一个确定存在的 (类型,属性) 必须被找到
    const canary = types.find((t2) => t2.key === "Order")?.properties?.find((p) => p.propKey === "qty");
    console.log("### CANARY Order.qty found:", canary ? JSON.stringify(canary) : "NOT-FOUND(工具坏了)");

    // R18 风险：同名属性出现在几个类型上，量纲是否一致
    for (const name of CAND) {
      const hits: string[] = [];
      for (const ty of types) {
        for (const p of ty.properties ?? []) {
          if (p.propKey === name) hits.push(`${ty.key}.${p.propKey}[unit=${p.unit ?? "-"} type=${p.dataType ?? "-"}]`);
        }
      }
      console.log(`### PROPNAME ${name} ON ${hits.length} TYPES:`, hits.join(" | "));
    }

    // 现有 gate ⑥ 的真实命中面：STATE_VAR_DISPLAY_NAMES 的键当前与本体属性的碰撞
    const svKeys = new Set(Object.keys(STATE_VAR_DISPLAY_NAMES));
    const collisions: string[] = [];
    for (const ty of types) for (const p of ty.properties ?? []) if (svKeys.has(p.propKey)) collisions.push(`${ty.key}.${p.propKey}`);
    console.log("### CURRENT_COLLISIONS:", collisions.length, collisions.join(","));

    // PROP_DISPLAY_NAMES 里这几个键的现有中文名
    for (const name of CAND) {
      const found = Object.entries(PROP_DISPLAY_NAMES).filter(([k]) => k.endsWith(`.${name}`));
      console.log(`### PROP_DISPLAY ${name}:`, JSON.stringify(found));
    }

    // 每个候选属性在 Order 世界内对象上的真值分布
    const orders = await t.repos.objects.listByType("demo", "Order");
    const live = orders.filter((o) => o.props.status !== "COMPLETED");
    for (const name of CAND) {
      const vals = live.map((o) => o.props[name]).filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
      console.log(`### ORDER.${name}: finite=${vals.length}/${live.length} min=${Math.min(...vals)} max=${Math.max(...vals)}`);
    }
    // 型号扇入
    const models = await t.repos.objects.listByType("demo", "Model");
    console.log("### MODEL_COUNT:", models.length);
    expect(types.length).toBeGreaterThan(0);
  }, 180000);
});
