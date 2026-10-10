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
  // ⑥ 需要 typeKey：它要审的是「**哪个类型**把这个名字当状态变量用」，
  //   而不是「这个名字在本体里某处碰巧也是个属性」——后者是原门那个不度量危害的代理量。
  items: { sourceStateVar: string; targetStateVar: string; sourceTypeKey: string; targetTypeKey: string }[];
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

  /**
   * ══ ⑥ 状态变量与本体属性同名时，必须是**真读数**且量纲唯一 ═══════════════════════
   *
   * ── 这条断言 2026-09-15 被改过一次，理由必须写清（WO-SIM-ORDER-REAL-FIELDS）──────
   *
   * **原文**是「中文名表的键**不得**同时是该类型的本体属性」，理由原话：
   *   「若哪天有人把它们登记成 `PropertyDef`，对象详情/目录/喂 LLM 的属性清单里就会多出一批
   *     **永远取不到值**的列 —— 那是用本体断言了一件假事。」
   * 并留了一句话：「真要改主意，得先来改这条断言并写清理由。」——**本段就是那个理由。**
   *
   * ── 为什么非改不可：它与 ④ 合起来，把一条正路堵死了 ────────────────────────────
   * ④ 要求**每个**出现在规则里的状态变量都必须登记进 `STATE_VAR_DISPLAY_NAMES`；
   * ⑥（原文）要求该表的键**一个都不许**是本体属性。
   * 两条合起来 ⇒ **任何状态变量都不可能与任何属性同名**。
   * 而 `sim/seed-world.ts` 的 `deriveSeedBaseSnapshot` 播种时走的正是**同名探测**
   *（「同名属性存在且是有限数 ⇒ 那就是真读数」，否则哈希兜底），
   * `sim/world-read.ts` 的读取侧 DIRECT 档也复用同一个同名判据。
   * ⇒ 这两道门在**结构上**保证了真读数那一档**永远命中不了**，`measuredCells` 恒 0。
   * 实测为证：改前 `origin = { cells: 5895, measuredCells: 0, derivedCells: 5895 }`，
   * 且 `world-read.ts` 自己的注释就写着「demo 上 measuredCells:0 ⇒ 这一档今天恒 0 格」。
   * 换句话说：不是"碰巧没对上名字"，是**有门在保证它对不上**。
   *
   * ── 形态（照 CLAUDE.md 铁律 0.6 句式）────────────────────────────────────────
   *   「我用『状态变量名与属性名撞车』当作『多出一列永远取不到值的假列』的证据，
   *     而前者并不度量后者 —— 属性上**有真值**时，同名恰恰是那一列被真正读到的方式。」
   * 原门想挡的危害是**空列**，它却拿**撞名**当代理量。本单把判据挪回危害本身。
   *
   * ── 改后这道门比改前更强（不是放水）────────────────────────────────────────
   * 原门只查一件事（撞名与否）。现在查三件，且每一件都比"撞名"更贴近真危害：
   *   (a) **必须真有值**：该属性在真实对象上必须是有限数。登记一个取不到值的属性 ⇒ 当场红
   *       （这正是原门唯一想挡的那件事，一个字没放松）。
   *   (b) **量纲唯一（R18）**：同一个名字被两个类型当状态变量用、而两边 `unit` 不同 ⇒ 红。
   *       这是原门**完全查不到**的一类错：`qty` 这个属性名在本体里横跨 11 个类型、
   *       三种单位（套 / 件 / 吨），`unitPrice` 横跨 4 个类型（元 / 元·计量单位）。
   *       本单只把 `Order` 那一个拿去当状态变量，但**下一个人**若把 `PurchaseOrder.qty`（吨）
   *       也接成状态变量，全平台就会有一个中文名同时表示套和吨 —— 机器现在会先说话。
   *   (c) **中文名必须带单位**：既然名字进了带真实单位的量纲，屏上就不许出现
   *       "21777"却不知道是套还是吨。
   * ⛔ 不开文件白名单、不列豁免清单 —— 判据落在**属性自身的性质**上，
   *   对以后新增的任何类型/属性照样生效（白名单迟早被例外吃光）。
   */
  it("⑥ 状态变量与本体属性同名时：必须真有值 + 量纲唯一 + 中文名带单位（原「一律不许同名」已按本段理由收窄）", async () => {
    const t = await seededApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const types = res.json() as {
      key: string;
      properties: { propKey: string; unit?: string }[];
    }[];

    // 金丝雀：本体真的取回来了（空数组会让下面的检查恒绿）。
    expect(types.length, "本体应非空；为 0 说明取数坏了").toBeGreaterThan(0);

    const rs = await rules(t);
    // 🐤 金丝雀：规则表非空，否则 `usedAsStateVar` 恒空 ⇒ (a)(b)(c) 三项全部空跑变装饰品。
    expect(rs.items.length, "已发布规则应非空；为 0 说明取数坏了").toBeGreaterThan(0);

    /** 每个状态变量**实际被哪些类型**当状态变量用（取自已发布规则，不是猜的）。 */
    const usedAsStateVar = new Map<string, Set<string>>();
    for (const r of rs.items) {
      (usedAsStateVar.get(r.sourceStateVar) ?? usedAsStateVar.set(r.sourceStateVar, new Set()).get(r.sourceStateVar)!).add(r.sourceTypeKey);
      (usedAsStateVar.get(r.targetStateVar) ?? usedAsStateVar.set(r.targetStateVar, new Set()).get(r.targetStateVar)!).add(r.targetTypeKey);
    }

    const stateVarKeys = new Set(Object.keys(STATE_VAR_DISPLAY_NAMES));
    const emptyColumns: string[] = [];   // (a) 同名但取不到值 —— 原门唯一想挡的那件事
    const dimensionClash: string[] = []; // (b) 同一名字两个量纲
    const unitlessName: string[] = [];   // (c) 中文名没带单位

    for (const ty of types) {
      for (const p of ty.properties ?? []) {
        if (!stateVarKeys.has(p.propKey)) continue;
        // 只审**真的被当成状态变量用**的那些 (类型, 属性)。
        // 某类型碰巧有个同名属性、却没有任何规则拿它当状态变量 ⇒ 两套语义没有混用，不是本门的事。
        if (!usedAsStateVar.get(p.propKey)?.has(ty.key)) continue;

        // (a) 真有值吗？—— 拿该类型的真实对象去量，不信声明。
        const objs = await t.repos.objects.listByType("demo", ty.key);
        const finite = objs.filter((o) => {
          const v = o.props[p.propKey];
          return typeof v === "number" && Number.isFinite(v);
        }).length;
        if (objs.length === 0 || finite === 0) {
          emptyColumns.push(`${ty.key}.${p.propKey}（${objs.length} 个对象中 ${finite} 个有有限数）`);
        }

        // (c) 中文名必须带单位（属性声明了 unit 才要求 —— 没声明单位的属性本来就无从带）。
        const zh = STATE_VAR_DISPLAY_NAMES[p.propKey] ?? "";
        if (p.unit && p.unit !== "dimensionless" && !zh.includes(p.unit)) {
          unitlessName.push(`${p.propKey} 的中文名「${zh}」没带单位「${p.unit}」`);
        }
      }
    }

    // (b) 同一个状态变量名，被多个类型当状态变量用时，这些类型声明的 unit 必须一致。
    const unitOf = (typeKey: string, propKey: string): string | undefined =>
      types.find((x) => x.key === typeKey)?.properties?.find((p) => p.propKey === propKey)?.unit;
    for (const [v, typeKeys] of usedAsStateVar) {
      if (!stateVarKeys.has(v)) continue;
      const units = new Set<string>();
      for (const tk of typeKeys) {
        const u = unitOf(tk, v);
        if (u) units.add(`${tk}:${u}`);
      }
      const distinct = new Set([...units].map((s) => s.split(":")[1]));
      if (distinct.size > 1) {
        dimensionClash.push(`${v} 在 ${[...units].join(" / ")} —— 一个状态变量名对上了 ${distinct.size} 个量纲（R18）`);
      }
    }

    expect(emptyColumns, "状态变量与属性同名，但该属性在真实对象上取不到值 ⇒ 屏上会多出永远空的列（原⑥要挡的就是这个）").toEqual([]);
    expect(dimensionClash, "同一个状态变量名对应了多个量纲（R18：一个字段名只许对应一个量纲）").toEqual([]);
    expect(unitlessName, "带单位的业务量当状态变量时，中文名必须带上单位（否则屏上分不清套/件/吨）").toEqual([]);

    // 🐤 反向金丝雀：证明上面三项**有鉴别力**，不是恒空的装饰品。
    // 造一个"登记成状态变量、但对象上取不到值"的名字，(a) 那条规则必须抓到它。
    const fakeVar = "__never_a_real_prop__";
    const fakeTypes = [{ key: "Order", properties: [{ propKey: fakeVar, unit: "套" }] }];
    const fakeUsed = new Map([[fakeVar, new Set(["Order"])]]);
    const caught: string[] = [];
    for (const ty of fakeTypes) {
      for (const p of ty.properties) {
        if (!fakeUsed.get(p.propKey)?.has(ty.key)) continue;
        const objs = await t.repos.objects.listByType("demo", ty.key);
        const finite = objs.filter((o) => Number.isFinite(o.props[p.propKey] as number)).length;
        if (finite === 0) caught.push(`${ty.key}.${p.propKey}`);
      }
    }
    expect(caught, "反向金丝雀：空列必须被 (a) 抓到；抓不到说明这道门是装饰品").toEqual(["Order.__never_a_real_prop__"]);
  });
});
