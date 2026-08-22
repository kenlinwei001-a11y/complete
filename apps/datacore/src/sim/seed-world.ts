/**
 * WO-SIM-SEED-WORLD · **开箱即有一个能推的世界**（`SEED_DEMO=1` 播种路径的最后一步）。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y ═══════════════════════════════════════════
 *
 * **X（今天·实测）**：`SEED_DEMO=1` 起来后
 * `GET /a/v1/sim/sessions`（`X-Debug-User: demo:admin:admin|planner|catalog_admin`）
 * 回 `{"items":[]}` —— demo 租户**一个推演会话都没有**。于是推演沙盘四页
 * （`sim-console` / `sim-conduction` / `sim-attribution` / `sim-optimize`）的会话钩子
 * `views/sim/console/useConsoleSession.ts:117` 如实报 `no-running-session`，四页全落占位：
 * 世界里明明已经有 35 条 PUBLISHED 传导规则、11337 个物化对象，屏上却是一屏与它们无关的占位数。
 *
 * **Y（应该）**：种子跑完就有**一条 RUNNING 的推演会话**（`curTick ≥ 1`、`baseSnapshot` 非空、
 * 逐格 tick 态落盘），四页一打开就有世界可推。
 *
 * ⚠ 会话**不是**前端建的：`useConsoleSession.ts:20-23` 立了硬约束「本 hook 一个 POST 都不发，
 *   连 `createSimSession` 都不 import」——「用户打开了一个页面」不构成建世界的授权。
 *   所以这条缺口只能在**播种侧**补：世界是随 demo 数据一起被"种"出来的，不是被"看"出来的。
 *
 * ══ 复用生产路径（本单最容易做错的地方）═══════════════════════════════════════
 *
 * 建会话与推拍**一行都不自己写**，走 `SimWorldOps` —— 即 `app.ts` 里
 * `POST /a/v1/sim/sessions` 与 `POST …/tick` 用的**同一个闭包**（不是"照着抄一份"，
 * 是同一个函数对象经 `services.sim` 传进来）。
 * 手写一个 `status:"RUNNING"` 塞进仓储会得到一个 `curTick`/`tickState`/`trace` 全是假的空壳：
 * 四页取数回来照样是空 —— 那只是把占位换成了另一种占位。
 */
import type { PropagationRule, SimSession, TickState } from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";

/**
 * 推演世界的两条**生产写路径**（`app.ts` 的路由与本播种模块共用同一份实现）。
 *
 * 类型定义放在这里而不是 `app.ts`：`app.ts` 只 `import type` 它，运行时零依赖 ⇒ 不成环；
 * 而 `services.sim` 的对象字面量必须结构满足本接口 —— 哪天路由那两个闭包的签名漂了，
 * **编译当场红在 `server.ts` 的调用点上**（机器先说话，不靠人记得两处要同步）。
 */
export interface SimWorldOps {
  /**
   * 建会话：落 `sim_session` + tick0 态行 + 发 `sim.session_created`。
   * `id`/`createdAt` 只有播种路径会传（要确定性与幂等）；路由不传 ⇒ `newId()` + 当前时刻，逐字节同旧。
   */
  createSession(
    c: AuthCtx,
    input: { baseSnapshot?: TickState; scope?: Record<string, unknown>; id?: string; createdAt?: string },
  ): Promise<SimSession>;
  /** 真推 n 拍：逐格 `putTickState` + 会话进位置 RUNNING + 发 `sim.tick_completed`。 */
  tick(c: AuthCtx, s: SimSession, n: number): Promise<{ curTick: number }>;
}

/**
 * 种子世界的**固定会话 id**（R6 确定性 + 幂等键）。
 *
 * 为什么用固定 id 而不是"列表里找找看有没有像种子的那条"：`newId("sims")` 是 randomBytes，
 * 重启即漂 ⇒ 只能靠猜（按 label/时间/scope 模糊匹配）来判重，猜错就越堆越多。
 * 固定 id ⇒ 判重就是一次 `getSession`，而 pg 侧 `createSession` 本身是 `ON CONFLICT (id) DO UPDATE`，
 * 双保险。
 */
export const DEMO_SIM_WORLD_SESSION_ID = "sims_demo_seed_world";

/**
 * 种子世界的**固定建立时刻**。
 *
 * ⚠ 刻意是一个**过去**的时刻，不是 `new Date()`：四页挑会话的判据是
 * 「最近一条 RUNNING」（`useConsoleSession.ts:75-82` 按 `createdAt` 取最大）。
 * 若种子盖一个"永远最新"的时间戳，用户自己建的世界就**永远排在种子后面**，
 * 等于把种子从"开箱兜底"变成"永久霸占"。
 */
export const DEMO_SIM_WORLD_CREATED_AT = "2026-01-01T00:00:00.000Z";

/**
 * 种子世界开局推几拍。
 *
 * `3` 的依据是实测而非手感：demo 的 35 条规则 `delayTicks ∈ {0,1}`
 * （复验：`GET /a/v1/sim/propagation-rules` 取 delayTicks 去重）⇒
 *  · 1 拍：只有即时边到达，延迟边的贡献还挂在 `pending` 里，屏上看不见；
 *  · 2 拍：延迟边落地，世界第一次"完整"；
 *  · 3 拍：`metric-series` 有 4 个点（t0..t3），一条线才**有形状**可读。
 * 再多只是把种子时间与库体积线性拉长，读不出新东西。
 */
export const DEMO_SIM_WORLD_TICKS = 3;

/** `scope` 里承载种子记号的键（**不叫 `snapshotKind`**：那个键会把会话从沙盘列表里滤掉）。 */
export const DEMO_SIM_WORLD_SCOPE_KEY = "seedWorld";

/**
 * tick0 世界态的**出处记号**（写进 `SimSession.scope.baseSnapshotOrigin`，随
 * `GET /a/v1/sim/sessions` 原样下发 ⇒ 可查、可被测试咬死）。
 *
 * ⚠ 为什么这个记号必须存在：这批读数**长得和真值一模一样**（有量纲感、有小数位、随对象变化），
 * 用户没有任何办法分辨。而前端那一侧**分辨不了也不会分辨** ——
 * `SandboxView.tsx:573` 的规矩是「真从后端取回来的那一份盖 `MEASURED` 章」，
 * 于是任何来自 `GET …/:id/world` 的东西都会被标成实测（这不是本单引入的：
 * 用户今天在旧沙盘里点一下"推进一拍"，回包同样被盖 `MEASURED`，而它的 tick0 正是前端
 * `deriveBaseSnapshot` 的哈希占位）。**出处只能落在数据自己身上**，落在屏上就会被别人盖章盖掉。
 */
export interface SeedWorldSnapshotOrigin {
  /** `DERIVED` = 结构派生的确定性占位；`MEASURED` = 对象上真读到的数。见 `cells` 分项。 */
  kind: "DERIVED";
  /** 派生公式（口径与前端 `views/sim/edgeActiveModel.ts:388 deriveBaseSnapshot` 相同）。 */
  formula: string;
  /** 一句人话的出处说明（供任何消费方直接展示，不必各自编）。 */
  note: string;
  /** 覆盖的对象类型数（= 被 PUBLISHED 规则触及的类型）。 */
  types: number;
  /** 覆盖的物化对象数。 */
  objects: number;
  /** 总格子数 = Σ(对象 × 该类型被规则触及的状态变量)。 */
  cells: number;
  /**
   * 其中**真从对象属性上读到**的格子数。
   *
   * ⚠ 这个数是**现测**的，不是抄注释：每一格都先探一次 `props[stateVar]`，是有限数才算实测。
   * demo 上它今天是 **0** —— 与 `synthetic/battery.ts` 的实测结论一致
   *（「`loadIndex` 等在 `apps/datacore/src/synthetic/` 一次都不出现 …… 它们不是 `PropertyDef`，
   *  对象上不带这些值」）。把它做成运行时计数而不是一句断言，是为了哪天本体真的长出这些属性时
   * **数字自己会变**，而不是等人想起来去改注释。
   */
  measuredCells: number;
  /** 其中派生占位的格子数（`cells - measuredCells`）。 */
  derivedCells: number;
}

/** 播种回执（供 `server.ts` / `seed-cli.ts` 打日志；`created:false` = 幂等命中或诚实缺席）。 */
export interface SeedWorldReport {
  created: boolean;
  sessionId: string | null;
  curTick: number;
  /** 没建世界时**说明为什么**（诚实缺席：不许静默返回一个空回执）。 */
  reason: string | null;
  origin: SeedWorldSnapshotOrigin | null;
}

/**
 * 字符串 → 稳定 `[0,1)`（FNV-1a）。
 *
 * ⚠ **与前端 `views/sim/edgeActiveModel.ts:370 hash01` 同式，这是刻意的，不是"又造了一份"**：
 * 两边算的**不是同一个数**，而是两个互不相干世界的开局值 ——
 * 前端那份只作用于「用户在浏览器里现建的会话」，本份只作用于「种子会话」，
 * 且种子的结果**当场落库**（`baseSnapshot` 是持久数据），此后谁也不会再算一遍。
 * 故两者不构成「两半各写一套会漂移」的那种接缝（那种接缝的判据是"同一个数被算两次"）。
 * 保持同式的唯一理由是**口径一致**：屏上并排看两个世界时，占位值的量级/分布一致，
 * 不会出现"种子世界天生比自建世界热"这种纯属实现差异的错觉。
 */
export function seedHash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** 规则触及的「类型 → 状态变量集」（source 与 target 两端都算——两端都是引擎会读写的格子）。 */
function varsByType(rules: readonly PropagationRule[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (typeKey: string, stateVar: string): void => {
    const cur = m.get(typeKey);
    if (cur) cur.add(stateVar);
    else m.set(typeKey, new Set([stateVar]));
  };
  for (const r of rules) {
    add(r.sourceTypeKey, r.sourceStateVar);
    add(r.targetTypeKey, r.targetStateVar);
  }
  return m;
}

/**
 * 从租户**已物化对象 + 已发布传导规则**派生 tick0 世界态。
 *
 * ── 覆盖面：为什么只铺「规则触及的类型 × 该类型被触及的变量」────────────────────────
 * 前端 `deriveBaseSnapshot` 铺的是 `nodeTypes × stateVars` 全笛卡尔积 —— demo 上实测
 * **11348 键 × 36 变量 ≈ 408,528 格**，而引擎能读写的只有 `sourceTypeKey.sourceStateVar` /
 * `targetTypeKey.targetStateVar` 这些格子（实测 32 类 / 3411 对象 / **3494 格**，1/117）。
 * 多出来的那 40 万格是**惰性填充**：没有任何规则会读它、写它，
 * 却会逐格进 `metric-series` 的指标目录（它按世界态里的格子枚举指标）——
 * 等于给用户一屏永远是直线的"指标"。少铺不是抠库容，是**不造假指标**。
 *
 * ── 出处：先探真读数，探不到才派生（`measuredCells` 就是这一步的现场计数）────────────
 * 不给状态变量硬编一个"从哪个属性来"的映射：那是**替租户下建模判断**
 *（种子里已有同一条纪律的先例：`seed.ts` 拒绝给规则绑 `cadenceNodeId`，理由一字不差是
 * 「等于替租户断言…」）。同名属性存在且是有限数 ⇒ 那就是真读数，直接用；否则如实派生并计数。
 */
export async function deriveSeedBaseSnapshot(
  repos: Repos,
  tenantId: string,
): Promise<{ state: TickState; origin: SeedWorldSnapshotOrigin }> {
  const rules = await repos.sim.listPropagationRules(tenantId, true);
  const byType = varsByType(rules);
  const state: TickState = {};
  let objects = 0;
  let cells = 0;
  let measuredCells = 0;
  // 类型有序 + 对象按 id 有序 ⇒ 同一租户同一本体重跑，落库字节一致（R6）。
  for (const typeKey of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
    const vars = [...(byType.get(typeKey) ?? new Set<string>())].sort((a, b) => a.localeCompare(b));
    const rows = (await repos.objects.listByType(tenantId, typeKey))
      .filter((o) => !o.mergedInto) // 与 `GET /a/v1/sim/view-config` 的 nodeObjectIds 同源同过滤
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const o of rows) {
      const row: Record<string, number> = {};
      for (const v of vars) {
        const real = o.props[v];
        if (typeof real === "number" && Number.isFinite(real)) {
          row[v] = real;
          measuredCells += 1;
        } else {
          row[v] = Math.round(seedHash01(`${o.id}|${v}`) * 100);
        }
        cells += 1;
      }
      // 空 vars 不会发生（类型进 byType 必带至少一个变量），但仍不写空行：空行是"这个对象在世界里
      // 却一格都没有"，读起来像数据丢了。
      if (vars.length > 0) {
        state[o.id] = row;
        objects += 1;
      }
    }
  }
  return {
    state,
    origin: {
      kind: "DERIVED",
      formula: "round(hash01(`${objectId}|${stateVar}`) × 100)（FNV-1a · 与前端 deriveBaseSnapshot 同式）",
      note:
        "种子世界的 tick0 读数由**本体结构派生**（确定性占位），不是实测：" +
        "推演状态变量（loadIndex/demandPressure…）在本平台不是对象属性，对象上取不到值 —— " +
        "measuredCells 就是每次播种现场探到的真读数格数。凡拿它当起点算出的差值，量级不可当实测读。",
      types: byType.size,
      objects,
      cells,
      measuredCells,
      derivedCells: cells - measuredCells,
    },
  };
}

/**
 * `SEED_DEMO=1` → 给 demo 租户播**一条 RUNNING 的推演会话**（消四页的"无世界"占位）。
 *
 * 由两条播种路径调用（`server.ts` / `seed-cli.ts`）——两条**必须同步**（seed.ts 立的同一条纪律：
 * 漂了就会出现「容器起得来的环境有世界、跑过 pnpm seed 的环境没有」这种只在某些机器上复现的坑）。
 * 排在播种序列**最后**：它要读的是别人播完的产物（合成本体的对象 + 传导规则 + 流程层对象），
 * 任何一个没播完，铺出来的世界就是残的。
 *
 * 幂等（判据 4）：固定 id 先 `getSession` 判重 ⇒ 重复启动**一条都不多**，也不会把已有世界又推 3 拍。
 * 只影响 demo 种子（判据 5）：本函数只有 `SEED_DEMO=1` 分支调用，其它启动路径一个字节不动。
 */
export async function seedDemoSimWorld(repos: Repos, sim: SimWorldOps, ctx: AuthCtx): Promise<SeedWorldReport> {
  const existing = await repos.sim.getSession(ctx.tenantId, DEMO_SIM_WORLD_SESSION_ID);
  if (existing) {
    return {
      created: false,
      sessionId: existing.id,
      curTick: existing.curTick,
      reason: "幂等命中：种子世界已存在（固定 id），不重建、不再推拍",
      origin: null,
    };
  }
  const { state, origin } = await deriveSeedBaseSnapshot(repos, ctx.tenantId);
  // 诚实缺席：没有规则或没有物化对象 ⇒ **不建空世界**。一条 baseSnapshot 为空的 RUNNING 会话
  // 会让四页从"没有世界"变成"有世界但每一格都取不到数"——后者更难查（判据同 `useConsoleSession`
  // 分五态的理由：`no-running-session` 与"有会话但这一格没数据"处置完全不同）。
  if (origin.cells === 0) {
    return {
      created: false,
      sessionId: null,
      curTick: 0,
      reason:
        `本租户零可铺格子（PUBLISHED 传导规则触及 ${origin.types} 个类型、物化对象 ${origin.objects} 个）` +
        "⇒ 不建空世界（空 baseSnapshot 的 RUNNING 会话 = 把占位换成另一种占位）",
      origin,
    };
  }
  const session = await sim.createSession(ctx, {
    baseSnapshot: state,
    scope: {
      // 种子记号（幂等/审计用）。**没有 `kind` 键** ⇒ `resolveSimScope` 读作 GLOBAL，与旧会话同档。
      [DEMO_SIM_WORLD_SCOPE_KEY]: true,
      label: "demo 种子世界",
      baseSnapshotOrigin: origin,
    },
    id: DEMO_SIM_WORLD_SESSION_ID,
    createdAt: DEMO_SIM_WORLD_CREATED_AT,
  });
  // 真 tick（与 `POST …/tick` 同一份传导核）：会话在这一步才变 RUNNING，`curTick` 才真进位。
  const ticked = await sim.tick(ctx, session, DEMO_SIM_WORLD_TICKS);
  return { created: true, sessionId: session.id, curTick: ticked.curTick, reason: null, origin };
}
