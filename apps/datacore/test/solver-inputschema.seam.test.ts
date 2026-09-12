/**
 * ★ WO-SOLVER-INPUTSCHEMA · 「求解器实现 ↔ 入参模式 ↔ MCP 工具描述」三段**接缝**测试。
 *
 * 为什么必须是接缝测试而不是各半 unit（SEAM-GATE）：这件事天然跨三个包 ——
 *   ① `apps/datacore/src/catalog.ts`（目录条目 · 数据半）
 *   ② `packages/contracts/src/solver-input-schema.ts`（入参模式 · 契约半）
 *   ③ `apps/agentcore/src/mcp/solvers-catalog.ts`（MCP 工具装配 · 引擎半）
 * 三者各自 unit 全绿、而「模型到底看不看得到 `lineGranularity`」依然可以是 false —— 那正是本单要堵的洞。
 * 故本文件**驱动整条缝**：真目录 → 真 builder → 断言工具描述里的可传参数。
 *
 * 🐤 金丝雀纪律（铁律 0.6）：凡要报「某键不可见 / 某求解器无入参」这类**否定结论**，
 * 先证明量法本身有鉴别力（§0 双向金丝雀）。金丝雀不中 ⇒ 报「量法坏了」，⛔ 不许报「它不存在」。
 */
import { describe, it, expect } from "vitest";
import { buildSolverMcpTools } from "../../agentcore/src/mcp/solvers-catalog.js";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";
import {
  SOLVER_INPUT_SCHEMAS,
  solverInputSchema,
  inputPropertyKeys,
  inputRequiredKeys,
  validateSolverInput,
  SOLVER_ARGS_SCHEMAS,
  requiredArgKeys,
} from "../src/solvers/args-schemas.js";

const TOOLS = buildSolverMcpTools(ALL_SOLVER_CATALOG as never);
const toolOf = (key: string) => {
  const t = TOOLS.find((x) => x.solverKey === key);
  if (!t) throw new Error(`求解器 ${key} 不在 ALL_SOLVER_CATALOG —— 量法坏了，不许据此下结论`);
  return t;
};
/** 模型在 MCP 工具描述里**看得到**的可传参数集（有 schema 用 schema，否则退回 argHints 散文）。 */
const visibleParams = (key: string): string[] => {
  const t = toolOf(key);
  return t.inputSchema ? Object.keys(t.inputSchema.properties).sort() : Object.keys(t.argHints ?? {}).sort();
};

describe("§0 🐤 双向金丝雀 —— 先自证量法有鉴别力，再允许下任何否定结论", () => {
  it("正向必中：已登记的 portfolio 必须拿得到 inputSchema，且它是个 object schema", () => {
    const js = solverInputSchema("portfolio");
    expect(js, "portfolio 已在 SOLVER_INPUT_SCHEMAS 登记却取不到 schema ⇒ 量法坏了").toBeDefined();
    expect(js!.type).toBe("object");
    expect(Object.keys(js!.properties).length).toBeGreaterThan(10);
  });

  it("反向必不中：未登记的 key 必须返回 undefined（而不是空壳 object）", () => {
    expect(solverInputSchema("zzz_不存在的求解器")).toBeUndefined();
    expect(inputPropertyKeys("zzz_不存在的求解器")).toEqual([]);
  });

  it("目录本身非空（否则下面所有『看不到某键』都会恒真地通过）", () => {
    expect(TOOLS.length).toBeGreaterThan(30);
  });
});

describe("§1 对照实验 · 补 schema 前后「模型能看到的可传参数个数」必须拉开", () => {
  // 判据（本单写死）：argHints 是**补 schema 之前**模型唯一的入参信息源（本单一字未改它），
  // 故「前」= argHints 条数、「后」= inputSchema.properties 条数，两数同轮实测、可复现。
  /**
   * ⚠ **实测订正（本测试当场把派单前提咬出来了）**：派单写的是
   * 「`global_sim_optimize`（`lineGranularity`/`frozenCapacityMode`）」两个键都不可见。
   * 实测 `frozenCapacityMode` **本来就在 `argHints` 里**（目录 4 键之一），真正不可见的只有
   * `lineGranularity`。故 `newlyVisible`（此前确实看不见）与 `alreadyVisible`（此前已可见，
   * 只是没类型没枚举）**分两栏断言** —— 把两者混成一句，就是本仓反复犯的
   * 「拿一个笼统数字盖住两个不同事实」。
   */
  const cases: { key: string; newlyVisible: string[]; alreadyVisible: string[]; why: string }[] = [
    {
      key: "portfolio",
      newlyVisible: ["lineGranularity"],
      alreadyVisible: ["frozenCapacityMode"],
      why: "service.ts:3512 asBool(args.lineGranularity) → portfolio.ts:278 —— 代码早就读它，模型一直不知道它存在",
    },
    {
      key: "capacity_forecast",
      newlyVisible: ["whatIf", "demandDelta"],
      alreadyVisible: ["modelId"],
      why: "capacity.ts:396/398 —— 三根产能杠杆（夜班/通道/外协）此前完全不在 argHints 里",
    },
  ];

  for (const { key, newlyVisible, alreadyVisible, why } of cases) {
    it(`★ ${key}：后 > 前，且新增可见 ${newlyVisible.join("/")}（${why}）`, () => {
      const before = Object.keys(toolOf(key).argHints ?? {}).sort();
      const after = visibleParams(key);
      // eslint-disable-next-line no-console
      console.log(`【对照实验】${key}  前=${before.length} [${before.join(",")}]  →  后=${after.length} [${after.join(",")}]`);
      expect(after.length, `${key} 补 schema 后可传参数没变多 ⇒ 没接上`).toBeGreaterThan(before.length);
      for (const k of newlyVisible) {
        expect(before, `${k} 本就在 argHints 里 ⇒ 它不属于「新增可见」这一栏，请改栏别改断言`).not.toContain(k);
        expect(after, `${k} 补完 schema 仍看不见 ⇒ 模型依旧只能猜`).toContain(k);
      }
      for (const k of alreadyVisible) {
        expect(before, `${k} 此前就该可见 ⇒ 前提漂了`).toContain(k);
        expect(after, `${k} 补 schema 后反而丢了 ⇒ 破坏加性`).toContain(k);
      }
    });
  }

  it("★ plan_audit：10 个必填一个都不能少（目录 argHints 此前只声明 versionId，而实现根本不读它）", () => {
    const before = Object.keys(toolOf("plan_audit").argHints ?? {}).sort();
    const after = visibleParams("plan_audit");
    // eslint-disable-next-line no-console
    console.log(`【对照实验】plan_audit  前=${before.length} [${before.join(",")}]  →  后=${after.length} [${after.join(",")}]`);
    expect(inputRequiredKeys("plan_audit")).toEqual(
      ["capex", "cashCushion", "dem", "gmTarget", "kitGap", "ltaCov", "seg_com", "seg_ess", "seg_pas", "sup"],
    );
    expect(before).not.toContain("dem"); // 前：一个必填都没声明
    expect(after).toContain("dem");
  });
});

describe("§2 能力性判据 · 错类型必须被**拒**，不许静默转 false", () => {
  // 病根：service.ts:3461 `asBool = v => v == null ? undefined : v === true || v === "true"`
  // ⇒ asBool("yes") === false。调用方以为开了线级排产，实际拿到基地级结果 —— 静默错答。
  it("★ lineGranularity:\"yes\" 被拒（带字段名与原因），lineGranularity:true 通过", () => {
    const bad = validateSolverInput("portfolio", { lineGranularity: "yes" });
    const good = validateSolverInput("portfolio", { lineGranularity: true });
    // eslint-disable-next-line no-console
    console.log(`【校验·拒】${JSON.stringify(bad)}`);
    // eslint-disable-next-line no-console
    console.log(`【校验·收】${JSON.stringify(good)}`);
    expect(bad.ok, "错类型没被拒 ⇒ 和今天 asBool 静默转 false 一样坏").toBe(false);
    expect("errors" in bad && bad.errors.join(" ")).toContain("lineGranularity");
    expect(good.ok).toBe(true);
  });

  it("pressureUnit 只认 pp|ratio（finance_world_projection 实现 :202-205 也是这么判的）", () => {
    expect(validateSolverInput("finance_world_projection", { worldId: "w1", pressureUnit: "percent" }).ok).toBe(false);
    expect(validateSolverInput("finance_world_projection", { worldId: "w1", pressureUnit: "ratio" }).ok).toBe(true);
  });

  it("必填缺席被拒：finance_world_projection 缺 worldId（实现 :176-179 同样 throw）", () => {
    expect(validateSolverInput("finance_world_projection", {}).ok).toBe(false);
    expect(validateSolverInput("finance_world_projection", { worldId: "w1" }).ok).toBe(true);
  });

  it("未登记求解器诚实报 unchecked，⛔ 不假装校验过", () => {
    const r = validateSolverInput("zzz_未登记", { 任意: 1 });
    expect(r.ok).toBe(true);
    expect("unchecked" in r && r.unchecked).toBe(true);
  });
});

describe("§3 双表对账 · 两张注册表重叠的 key 不许状态相反（机器咬，不靠人记得）", () => {
  // CLAUDE.md 铁律 0.6 第 5 条：双份真相里最贵的不是冲突（冲突会红），是**两份状态相反而没有东西会红**。
  const overlap = Object.keys(SOLVER_INPUT_SCHEMAS).filter((k) => k in SOLVER_ARGS_SCHEMAS);

  it("重叠集非空（否则本组断言恒真地通过 ⇒ 对账装置是装饰品）", () => {
    expect(overlap.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`【双表对账】重叠 key = [${overlap.join(", ")}]`);
  });

  for (const key of overlap.length ? overlap : ["portfolio"]) {
    it(`${key}：两表必填集必须一致（不一致 = 组合器与模型对「什么是必填」有两套说法）`, () => {
      expect(inputRequiredKeys(key)).toEqual(requiredArgKeys(key).sort());
    });

    it(`${key}：旧表字段必须是新表的子集（新表只许更全，不许更少）`, () => {
      const oldShape = (SOLVER_ARGS_SCHEMAS[key] as { shape?: Record<string, unknown> }).shape ?? {};
      const missing = Object.keys(oldShape).filter((k) => !inputPropertyKeys(key).includes(k));
      expect(missing, `新表漏了旧表已有的键 ${missing.join(",")} ⇒ 模型会以为这些参数不能传`).toEqual([]);
    });
  }
});

describe("§4 加性与确定性（R6）", () => {
  it("未登记求解器**不带** inputSchema 键（不发空壳·既有消费方逐字节不变）", () => {
    const unreg = TOOLS.filter((t) => !(t.solverKey in SOLVER_INPUT_SCHEMAS));
    expect(unreg.length, "全登记了 ⇒ 本断言恒真，需换别的样例").toBeGreaterThan(0);
    for (const t of unreg) expect("inputSchema" in t, `${t.solverKey} 未登记却带了 inputSchema`).toBe(false);
  });

  it("已登记求解器**带** inputSchema，且 argHints 原样保留（旧消费方不受影响）", () => {
    for (const key of Object.keys(SOLVER_INPUT_SCHEMAS)) {
      const t = TOOLS.find((x) => x.solverKey === key);
      if (!t) continue; // 该 key 不在目录里（如被 entitlement 过滤）—— 不是本组要咬的事
      expect(t.inputSchema, `${key} 已登记却没带 schema`).toBeDefined();
      expect(t.argHints, `${key} 的 argHints 被动过 ⇒ 破坏加性`).toEqual(
        (ALL_SOLVER_CATALOG.find((c) => c.key === key)?.argHints ?? {}),
      );
    }
  });

  it("同 key 两次取 schema 恒返回同一冻结引用（无时钟/无随机/不可被调用方改坏）", () => {
    const a = solverInputSchema("portfolio");
    const b = solverInputSchema("portfolio");
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("buildSolverMcpTools 两次调用结果逐字节一致（R6）", () => {
    expect(JSON.stringify(buildSolverMcpTools(ALL_SOLVER_CATALOG as never))).toBe(
      JSON.stringify(buildSolverMcpTools(ALL_SOLVER_CATALOG as never)),
    );
  });
});

describe("§5 保真 · schema 声明的键必须是实现真读的（⛔ 不许照抄 argHints，更不许发明）", () => {
  /**
   * 本组咬的是本单最容易退化的方向：日后有人往 schema 里**加一个实现根本不读的键**，
   * 模型照着传 → 静默被丢掉 → 「照说明书调用却拿到错答案」。这正是
   * `scripts/check-solver-arg-key-drift.mjs` 对 argHints 咬的那件事，本组把它延伸到 inputSchema。
   *
   * 判据取**样本**而非全量：全量需解析 5 棵树的实现，超出本单范围；
   * 这里钉死 4 个已逐行核过出处的求解器，作为回潮哨兵。
   */
  const PINNED: Record<string, { keys: string[]; src: string }> = {
    chain_impediments: { keys: ["scope"], src: "service.ts:4549 args.scope" },
    finance_world_projection: {
      keys: ["worldId", "pressureUnit", "revenueLine", "costLine", "marginLine", "turnWindow"],
      src: "finance-world.ts:153 FinanceWorldArgs（6 个 —— 目录 argHints 只有 5 个，漏 turnWindow）",
    },
    capacity_forecast: {
      keys: ["modelId", "qty", "weeks", "batches", "whatIf", "demandDelta", "granularity", "mode", "base"],
      src: "capacity.ts:391 ForecastArgs（接口即真相·9 个）",
    },
    changeover_sequence: { keys: ["lineId", "orders", "matrix", "current"], src: "extended.ts:329-332" },
  };

  for (const [key, { keys, src }] of Object.entries(PINNED)) {
    it(`${key}：schema 字段集 === 实现真读集（出处 ${src}）`, () => {
      expect(inputPropertyKeys(key)).toEqual([...keys].sort());
    });
  }

  it("chain_impediments 不许声明 scope.modelIds（实现 service.ts:4550 对它直接抛错）", () => {
    const scope = solverInputSchema("chain_impediments")!.properties.scope as { properties?: Record<string, unknown> };
    expect(Object.keys(scope.properties ?? {}).sort()).toEqual(["baseIds", "businessTypes"]);
  });
});
