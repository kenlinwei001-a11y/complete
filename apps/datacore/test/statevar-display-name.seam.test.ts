import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { STATE_VAR_DISPLAY_NAMES, stateVarDisplayName, stateVarDisplayNames } from "../src/synthetic/battery.js";

/**
 * WO-STATEVAR-DISPLAYNAME · 推演状态变量中文名的**接缝门**（后端这一半）。
 *
 * ── 病灶三分法判定：没接线（不是「接了线没数据」）──────────────────────────────────
 * 改前实测：`loadIndex` / `demandLoad` 这批名字在 `apps/datacore/src/synthetic/` **零命中**
 * （金丝雀 `util` 命中 ⇒ 工具是好的），它们**不是 PropertyDef**；契约里 `SandboxViewConfig.stateVars`
 * 是 `string[]`、`PropagationRule` 只有 `sourceTypeName`/`targetTypeName` ——
 * **全链没有任何字段承载状态变量的名字**。缺的是真值源与线，故修法是接线，不是补数据。
 *
 * ── 判据是**效果层**，不是"常量定义了" ──────────────────────────────────────────
 *  ① 名字出现在**两条真接口响应里**（view-config / propagation-rules），经真种子拿到，不是读源码常量；
 *  ② **两条路口径逐字节相同**（同一张表、同一个投影函数）——分两处各写一遍就会漂；
 *  ③ **诚实缺席**：未登记的变量**不出现在字典里**（不是 null / "" / 回填裸键），下游据此回落并可标记；
 *  ④ **覆盖金丝雀**：种子声明的每一个状态变量都必须有名字 —— 这条是"机器先说话"的那道门：
 *     谁往 `seed.ts` 加一条带新变量的传导规则却忘了登记中文名，**这里当场红**，
 *     而不是等到某天有人截图问「这个 loadIndex 是啥」。
 *  ⑤ **变异反证**：响应里的值必须**逐条等于**单源表的值 ⇒ 改表里任何一个词，响应跟着变；
 *     若有人在路由里另抄一份映射，这条立刻红。
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

interface ViewCfg { stateVars: string[]; stateVarNames?: Record<string, string> }
interface RulesResp {
  items: { sourceStateVar: string; targetStateVar: string }[];
  stateVarNames?: Record<string, string>;
}

async function viewConfig(t: TestApp): Promise<ViewCfg> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return res.json() as ViewCfg;
}

async function rules(t: TestApp): Promise<RulesResp> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return res.json() as RulesResp;
}

describe("WO-STATEVAR-DISPLAYNAME · 状态变量中文名经接口真下发（SEAM）", () => {
  it("① GET /sim/view-config 的 stateVarNames 带中文名（真种子真链路，不是读源码常量）", async () => {
    const t = await seededApp();
    const cfg = await viewConfig(t);

    // 种子真的种出了状态变量（前置：这批断言若跑在空世界上会全部空转变绿）。
    expect(cfg.stateVars.length).toBeGreaterThan(0);
    expect(cfg.stateVars).toContain("loadIndex");

    // 屏上那几个最常出现的词，逐条钉死。名字出处见 seed.ts 各规则注释（「② 型号需求负载 →
    // 沿"型号可产于基地"边推到基地负载指数」⇒ loadIndex = 负载指数）。
    expect(cfg.stateVarNames?.loadIndex).toBe("负载指数");
    expect(cfg.stateVarNames?.demandLoad).toBe("需求负载");
    expect(cfg.stateVarNames?.utilPressure).toBe("利用率压力");
    expect(cfg.stateVarNames?.shortageRisk).toBe("短缺风险");
  });

  it("② 两条路同源：propagation-rules 与 view-config 的字典逐字节相同（不许各写一份映射）", async () => {
    const t = await seededApp();
    const cfg = await viewConfig(t);
    const rs = await rules(t);

    expect(rs.items.length).toBeGreaterThan(0);
    // 逐字节相同 —— 这正是"同一张表 + 同一个投影函数"的可观测后果。
    // 谁在某条路由里另抄一份映射（哪怕只差一个字），这里当场红。
    expect(rs.stateVarNames).toEqual(cfg.stateVarNames);
  });

  it("③ 诚实缺席：未登记的变量**不出现在字典里**（不是 null/空串/回填裸键）", async () => {
    const t = await seededApp();

    // 真建一条带"本体没登记中文名"的变量的边（走真 POST 路由，不是直写仓储）。
    const created = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: {
        key: "wo_statevar_probe", sourceTypeKey: "Base", sourceStateVar: "__probe_unnamed_var__",
        viaLinkKey: "line_belongs_to_base", targetTypeKey: "Line", targetStateVar: "utilPressure",
        coefficient: 1, delayTicks: 0, status: "PUBLISHED",
      },
    });
    expect(created.statusCode).toBe(201);

    const rs = await rules(t);
    expect(rs.items.some((r) => r.sourceStateVar === "__probe_unnamed_var__")).toBe(true);

    // 关键：键**根本不在**字典里。若改成回填裸键（`__probe_unnamed_var__: "__probe_unnamed_var__"`），
    // 前端就再也分不出「名字恰好等于键」与「压根没名字」，"回落"也就无从如实标记。
    expect(Object.prototype.hasOwnProperty.call(rs.stateVarNames ?? {}, "__probe_unnamed_var__")).toBe(false);
    expect(stateVarDisplayName("__probe_unnamed_var__")).toBeUndefined();

    // 同一条响应里，已登记的那个照常有名字（证明不是"整个字典都空了"这种假通过）。
    expect(rs.stateVarNames?.utilPressure).toBe("利用率压力");
  });

  it("④ 覆盖金丝雀：种子声明的**每一个**状态变量都已登记中文名（加边忘了配名 ⇒ 这里当场红）", async () => {
    const t = await seededApp();
    const rs = await rules(t);

    const declared = [...new Set(rs.items.flatMap((r) => [r.sourceStateVar, r.targetStateVar]))].sort();
    // 金丝雀：先证明"我数的这批东西真的非空"，否则下面的差集恒为空、这道门恒绿（装饰品）。
    expect(declared.length, "种子应声明状态变量；为 0 说明取数坏了，不是覆盖率满分").toBeGreaterThan(10);

    const unnamed = declared.filter((v) => rs.stateVarNames?.[v] === undefined);
    expect(unnamed, `这些状态变量还没登记中文名（补 STATE_VAR_DISPLAY_NAMES）：${unnamed.join(", ")}`).toEqual([]);
  });

  it("⑤ 变异反证：响应值逐条 === 单源表的值 ⇒ 改表里一个词，接口跟着变", async () => {
    const t = await seededApp();
    const rs = await rules(t);

    const declared = [...new Set(rs.items.flatMap((r) => [r.sourceStateVar, r.targetStateVar]))];
    for (const v of declared) {
      // 不写死中文串，而是与单源表**对拍** —— 这样表一改，断言自动跟着走，
      // 而任何"路由里另存一份/写死一份"的做法都会当场分家。
      expect(rs.stateVarNames?.[v], `${v} 的下发值必须来自 STATE_VAR_DISPLAY_NAMES`).toBe(STATE_VAR_DISPLAY_NAMES[v]);
    }

    // 投影函数本身的口径：只收登记过的键，且输出稳定排序（同输入同输出 R6）。
    expect(stateVarDisplayNames(["loadIndex", "__nope__", "demandLoad"])).toEqual({
      demandLoad: "需求负载", loadIndex: "负载指数",
    });
  });

  it("⑥ 单源不并存：中文名表的键**不得**同时是该类型的本体属性（防有人顺手登记成 PropertyDef）", async () => {
    const t = await seededApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const types = res.json() as { key: string; properties: { propKey: string }[] }[];

    // 金丝雀：本体真的取回来了（空数组会让下面的检查恒绿）。
    expect(types.length, "本体应非空；为 0 说明取数坏了").toBeGreaterThan(0);

    /**
     * 状态变量是**推演世界态**（`SimTickState.state[objectId][var]`），不是对象属性。
     * 若哪天有人把它们登记成 `PropertyDef`，对象详情/目录/喂 LLM 的属性清单里就会多出一批
     * **永远取不到值**的列 —— 那是用本体断言了一件假事，也是本单刻意没选的那条修法。
     * 这道门把那条路封上：真要改主意，得先来改这条断言并写清理由。
     */
    const stateVarKeys = new Set(Object.keys(STATE_VAR_DISPLAY_NAMES));
    const collisions: string[] = [];
    for (const ty of types) {
      for (const p of ty.properties ?? []) {
        if (stateVarKeys.has(p.propKey)) collisions.push(`${ty.key}.${p.propKey}`);
      }
    }
    expect(collisions, "状态变量不应同时是本体属性（两套语义混用 ⇒ 屏上会出现永远空的列）").toEqual([]);
  });
});
