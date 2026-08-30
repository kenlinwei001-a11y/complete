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
import {
  PerturbationKindSchema,
  resolveSimScope,
  type Perturbation,
  type PropagationRule,
  type SimSession,
  type TickState,
} from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { stateVarDisplayName } from "../synthetic/battery.js";
import { buildPropagationInputs } from "./propagation-inputs.js";
import type { PropagationGraph } from "./propagation.js";

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
  /**
   * 建一条扰动：zod 校验 + 落 `sim_perturbation` + 已生效者立即施加 + 发 `sim.perturbation_created`。
   * `override` 只有播种路径会传（要确定性与幂等）；路由不传 ⇒ `newId()` + 当前时刻，逐字节同旧。
   *
   * ⚠ `body` 刻意是 `Record<string, unknown>` 而不是收窄成 `Perturbation` 的子集：**校验只有一处**
   * （路由里的 `PerturbationSchema.safeParse`）。在这里再声明一遍字段就是第二套校验，
   * 两处迟早漂 —— 播种侧填错字段的后果应当是**播种当场红**，不是被一个更宽松的本地类型放过去。
   */
  createPerturbation(
    c: AuthCtx,
    s: SimSession,
    body: Record<string, unknown>,
    override?: { id?: string; createdAt?: string },
  ): Promise<{ perturbation: Perturbation; state: TickState }>;
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

/**
 * 种子扰动的 `startTick`。**必须 ≥ 1，这是本单的地雷所在**（WO-SIM-SEED-PERTURB）。
 *
 * 建扰动时会话 `curTick === 0`。若 `startTick` 也取 0，则 `POST …/perturbations` 那条路
 * 判它「已在当前 tick 生效」⇒ 当场 `simApplyAtCurrentTick` 把它写进 **tick0 行**。
 * 而 `metric-series` 的两条线（基线/扰动后）**共用同一份 tick0 种子**
 * （`app.ts` 取 `getTickState(…,0).state`，见 `MetricSeriesArgs.seed`）——
 * 于是扰动被烙进了**基线自己的起点**，两条线再次逐值全等：
 * 屏上有一条扰动记录、`actual` 却一格不动，正是本单要消灭的那种「无事发生」换了个马甲。
 *
 * 取 1 ⇒ 建单时不生效（只入库）、tick0 干净；引擎在产出 tick1 那一格时 `entersAt` 施加一次，
 * 此后 tick2/tick3 沿链路往下带。分叉点因此**看得见**：t0 两线重合，t1 落点分开，t2/t3 下游跟着分开。
 */
export const DEMO_SIM_WORLD_PERTURB_START_TICK = 1;

/** `scope` 里承载种子记号的键（**不叫 `snapshotKind`**：那个键会把会话从沙盘列表里滤掉）。 */
export const DEMO_SIM_WORLD_SCOPE_KEY = "seedWorld";

/**
 * **播种完成标记**（WO-SIM-SESSIONS-PROJECTION 件二 · `scope` 里的键）。
 *
 * ── 🔴 病灶：今天的行为是 X，应该是 Y（2026-08-22 真 PostgreSQL 实测）──────────────
 * **X（今天）**：本函数的幂等守卫判的是「`getSession` 有没有回东西」。而播种**不是原子的**：
 * `createSession` → `createPerturbation` → `tick × 3` 是**四次独立写**，容器在中间任一处被杀，
 * 库里就留下一条**存在但没播完**的会话（实测：`status=READY, cur_tick=0`，
 * `sim_tick_state` 只剩 tick0 一行，`sim_perturbation` 零行）。
 * 下次重启，守卫看到"有东西了"就走开，日志打的是
 *   `SEED_DEMO=1: demo sim world not created — 幂等命中：种子世界已存在（固定 id），不重建、不再推拍`
 * —— **一句看起来一切正常的话**。此后永远不会补齐：四页的 `pickLatestRunningSession`
 * 要 `status==="RUNNING"`，这条 READY@tick0 一辈子挑不中，屏上永远是"无世界"占位，
 * 而这正是 WO-SIM-SEED-WORLD 当初要消灭的那个东西。**一个部署态的库就这样永久坏掉。**
 *
 * **Y（应该）**：幂等的判据落在「**播完了没有**」上，不是「**有没有东西**」上。
 * 这正是本仓反复踩的那个形态：
 * > 「我用『已经有数据了』当作『已经播完了』的证据，而前者并不度量后者。」
 *
 * ── 为什么标记写在 `scope` 里，而不是新开一张表 / 一列 ──────────────────────────
 * ① `scope` 是 jsonb，加键**不需要 migration**，也不需要 `repo/pg.ts` 逐列跟改
 *    （那张表是逐列表，加列漏改就是 memory 全绿 / pg 恒默认值的老坑）；
 * ② 标记必须与它描述的那条会话**同生共死** —— 会话被删，标记跟着没；
 *    放外面就会出现"标记说播完了、世界已经不在了"这种更难查的错位；
 * ③ `resolveSimScope` 对不认识的键一律读作 GLOBAL ⇒ 推演语义逐字节不变（RL9 additive 可回退）。
 *
 * 值刻意存**推了几拍这个常数**而不是时间戳：R6 要求同 `SEED_DEMO` 重跑字节级一致，
 * 塞一个 `completedAt` 进去，`sim_session.scope` 就再也不可能字节相同。
 */
export const DEMO_SIM_WORLD_COMPLETE_KEY = "seedWorldCompletedTicks";

/**
 * 一条已存在的种子世界，**播完了没有**（唯一实现：守卫与接缝门共用，别各写一套判据）。
 *
 * 三态，处置完全不同 —— 合成两态必修错地方：
 *  · `COMPLETE`   有完成标记 ⇒ 幂等命中，走开。**零额外查询**（标记就在已经读到的 `scope` 里）。
 *  · `LEGACY`     没有标记，但世界本身作证已播完（`RUNNING` 且 `curTick ≥ 播种目标拍数`）。
 *                 这是**本标记引入之前**播下的世界：不重播、只回填标记。
 *                 ⚠ 没有这一态，所有存量部署会在升级后被误判成半残并重播一次 ——
 *                 那就是拿一个新字段去证伪一堆本来好好的世界。
 *  · `INCOMPLETE` 既无标记、世界也作不了证 ⇒ **播到一半被打断**，必须修，且必须如实说。
 *
 * ⚠ 判据用 `curTick >= TICKS` 而不是 `=== TICKS`：用户自己在种子世界上多推了几拍是合法的，
 *   而 `=== ` 会把"用户用过这个世界"读成"播种没播完"，然后把人家的世界重置掉。
 * ⚠ 判据**不查 `listTickStates`**（判据 3「不许因此变慢」）：那条 `SELECT *` 会把
 *   每一拍的世界态 jsonb 全搬回进程，只为了数几行 —— 用一个刚为省流量修过的病去做体检，说不过去。
 */
export type SeedWorldCompleteness = "COMPLETE" | "LEGACY" | "INCOMPLETE";
export function seedWorldCompleteness(s: SimSession): SeedWorldCompleteness {
  if ((s.scope as Record<string, unknown>)[DEMO_SIM_WORLD_COMPLETE_KEY] === DEMO_SIM_WORLD_TICKS) return "COMPLETE";
  if (s.status === "RUNNING" && s.curTick >= DEMO_SIM_WORLD_TICKS) return "LEGACY";
  return "INCOMPLETE";
}

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

/** 播种回执（供 `server.ts` / `seed-cli.ts` 打日志；`created:false` = 幂等命中 / 修复 / 诚实缺席）。 */
export interface SeedWorldReport {
  created: boolean;
  /**
   * 本次是不是**修了一个半残世界**（WO-SIM-SESSIONS-PROJECTION 件二）。
   *
   * ⚠ 与 `created` **两个字段都要，不许合并**：`created` 回答「库里多了一条世界吗」，
   * `repaired` 回答「有一条世界原本是坏的吗」。合并成一个布尔，日志就再也分不出
   * 「首次播种」与「上次崩了这次补上」—— 而这两件事对运维的含义完全不同
   * （后者意味着**上一次启动被打断过**，值得去查为什么）。
   */
  repaired: boolean;
  /** 守卫这次判的是哪一态（`null` = 库里压根没有种子世界，谈不上完整性）。 */
  completeness: SeedWorldCompleteness | null;
  sessionId: string | null;
  curTick: number;
  /** 没建世界时**说明为什么**（诚实缺席：不许静默返回一个空回执）。 */
  reason: string | null;
  origin: SeedWorldSnapshotOrigin | null;
  /** 本次播下的种子扰动（`null` = 没播；原因见 `perturbationReason`）。 */
  perturbation?: Perturbation | null;
  /** 落点是怎么选出来的（口径分项，供日志与对账；`null` = 选不出合格落点）。 */
  choice?: SeedPerturbationChoice | null;
  /** 没播扰动时**说明为什么**（同 `reason` 的纪律：不许静默地少播一样东西）。 */
  perturbationReason?: string | null;
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
      /**
       * ⛔ **这句是直接印在用户屏上的，必须是纯文本人话** —— 不许写 markdown 标记，
       *    也不许写接口字段名 / 变量名。
       *
       * 今天有两个消费方，**都按纯文本渲染、都不过 markdown**：
       *   · `views/sim/unified/UnifiedSimShell.tsx` 顶部「世界态出处」状态行（整句一份）；
       *   · `views/sim/unified/metricWallModel.ts` 的 `calibreTextOf` —— **每张指标卡各一份**。
       * 后者是放大器：一屏 40 张卡里凡有读数的都会带上这句，所以这里多一个 `**`，
       * 屏上就多十几个。实测（2026-08-30 真浏览器 · demo/admin）：修前折叠态 8 个字面 `*`、
       * 展开「未变化」后 24 个；修后两态皆 0。
       *
       * 同理 `measuredCells` 原本也写在这句里 —— 那是接口字段名，用户读不懂；
       * 屏上那一项显示的词是「实测格」，所以这里跟着说「实测格」。
       */
      note:
        "种子世界的 tick0 读数由本体结构派生（确定性占位），不是实测：" +
        "推演状态变量（loadIndex/demandPressure…）在本平台不是对象属性，对象上取不到值 —— " +
        "「实测格」一项计的就是每次播种现场探到的真读数格数。凡拿它当起点算出的差值，量级不可当实测读。",
      types: byType.size,
      objects,
      cells,
      measuredCells,
      derivedCells: cells - measuredCells,
    },
  };
}

/**
 * 种子扰动的**落点与幅度**（全部**现算**，代码里零业务常数 R14）。
 *
 * ⚠ 每一个数都必须说得出口径 —— 这批字段随 `SimSession.scope.seedPerturbation` 原样下发，
 * 就是给人回头对账用的：口径变了，数就该跟着变，而不是等人想起来改注释。
 */
export interface SeedPerturbationChoice {
  targetObjectId: string;
  targetStateVar: string;
  /** `delta` 的幅度 = 该状态变量在本世界的**观测全距**（`varMax - varMin`）。 */
  magnitude: number;
  varMax: number;
  varMin: number;
  /** 落点被多少条 PUBLISHED 规则读作源（= 它有几条外发链路可走）。 */
  outRules: number;
  /** tick 预算内可被带动的下游**格子**数（不含落点自身）——排序键。 */
  reachCells: number;
  /** 其中不同下游**对象**数（不含落点对象自身）。`0` ⇒ 这条扰动只会动自己那一格，本单判它不合格。 */
  reachObjects: number;
  /** 排序时一共比过几个候选（诚实回带：这不是"随手挑的一格"）。 */
  candidates: number;
}

/** `"linkKey\u0000fromId"`（与 `propagateTick` 的 `navKey` 同式：用 NUL 分隔避免 key 撞车）。 */
const navKey = (linkKey: string, fromId: string): string => `${linkKey}\u0000${fromId}`;
/** 格子的稳定标识（`objectId` 与 `stateVar` 都可能含 `.`，故同样用 NUL 而不是点号）。 */
const cellKey = (objectId: string, stateVar: string): string => `${objectId}\u0000${stateVar}`;

/**
 * 选出种子扰动该落在**哪一格、多大幅度** —— 纯函数（R6：同入参逐字节同出参，零时钟零随机）。
 *
 * ── 为什么要"选"，不能写死一个落点 ───────────────────────────────────────────────
 * 判据 4「有出处，不编数」：落点写死就是**替租户断言**「你这个世界里最值得推的是这一格」，
 * 换租户/换行业当场失效（`seed.ts` 拒绝给规则绑 `cadenceNodeId` 是同一条纪律）。
 * 所以口径必须**可复算**：给定同一个世界，任何人重跑这个函数都该得到同一格。
 *
 * ── 口径三步（每一步都对齐引擎自己的取数条件，不另立一套）────────────────────────
 *
 * **① 候选** = tick0 世界态里**真实存在**的格子 `(objectId, stateVar)`，且同时满足：
 *    · `objectId` 在**引擎将要吃的那张图**里（`graph.objects`，故 `typeOf` 查得到）；
 *    · 某条规则把它读作源：`r.sourceTypeKey === typeOf(objectId) && r.sourceStateVar === stateVar`；
 *    · 该对象沿 `r.viaLinkKey` **真的有**类型为 `r.targetTypeKey` 的下游对象。
 *    这三条逐条抄自 `propagateTick` 的取数条件（`idsByType` / `sourceStateVar` / `targetsOf`）——
 *    **本单的分水岭就在这里**：落点若不满足它们，`propagateTick` 的 `state[sourceId]` 取不到，
 *    屏上那一格看着变了、下游一动不动（`SandboxView.tsx`「扰动落点候选」注释记的正是这个坑）。
 *
 * **② 排序键 = 传导可达面**（`reachCells`）：从该格出发，在「格图」上按**引擎的时基**做 BFS。
 *    预算 = `budgetTicks`（= 世界总拍数 − 扰动 `startTick`）；超预算的边不计入 ——
 *    数一条这辈子都不会在这条曲线上出现的传导，就是拿一个不度量目标的数当排序键。
 *
 *    ⚠ **第一跳与后续跳的开销不一样，这不是笔误**（实测逼出来的：按"都算 `1+delayTicks`"
 *    估出 37 格，真跑却动了 94 格 —— 差的就是这一跳）。机制在 `propagation.ts:593-595`：
 *    引擎**先把本拍落地的扰动写进 `effState`，再让规则读 `effState`**，
 *    原注释写明「本 tick 落地的扰动**当 tick 就要往下游传**，否则扰动要白等一个 tick」。所以：
 *      · **第一跳**（源就是扰动落点）：开销 = `delayTicks`。即时边的下游**与落点同一拍**就变。
 *      · **后续跳**（源是被带动的格子）：该格在 tick `T` 变 ⇒ `propagateTick(tick=T)` 读它、
 *        产出 `T+1` ⇒ 即时边下游在 `T+1` 变；延迟边 `arriveTick=T+1` 要等 `tick===T+1`
 *        那次调用才结算 ⇒ 下游在 `T+2` 变。开销 = `1 + delayTicks`。
 *    照"都算 `1+delayTicks`"会**系统性少数一跳**，排出来的第一名就未必是真的第一名。
 *
 * **③ 幅度 = 该状态变量在本世界的观测全距**（`max − min`，`mode:"delta"`）。
 *    为什么是全距而不是"翻一倍"「+15%」这类数：全距是**这个世界自己的离散度**，
 *    量级天然与它匹配，且随世界内容变化而变化；而 1.5 / 2 / 0.15 这些是外部拍脑袋的常数。
 *    全距为 0 的变量（全世界这一格都一样）**直接出局**：`delta 0` = 什么都没发生。
 *
 * ── 并列怎么办（R6 稳定 tiebreaker）──────────────────────────────────────────────
 * 候选按 `(objectId, stateVar)` **字典序**遍历，比较用**严格大于** ⇒ 并列时取字典序最小的那个。
 * 不用时钟、不用插入序、不用 `Math.random` —— 同一份种子重跑逐字节同一格。
 *
 * @param state       tick0 世界态（= 会话 `baseSnapshot`）。候选只从这里面出 ⇒ 落点必真实存在。
 * @param graph       引擎将要吃的**同一张**图（`buildPropagationInputs` 唯一装配处给，本函数不自己拼）。
 * @param rules       引擎将要吃的**同一批**规则（PUBLISHED − 本会话屏蔽）。
 * @param budgetTicks 扰动落地后还剩几拍可以传导。`≤0` ⇒ 没有任何下游来得及动，直接判无解。
 * @returns 选中的落点；**无合格候选时返回 `null`**（诚实缺席，调用方据此不播扰动并说明原因）。
 */
export function pickSeedPerturbation(args: {
  state: TickState;
  graph: PropagationGraph;
  rules: readonly PropagationRule[];
  budgetTicks: number;
}): SeedPerturbationChoice | null {
  const { state, graph, rules, budgetTicks } = args;
  if (budgetTicks <= 0) return null;

  const typeOf = new Map<string, string>();
  for (const o of graph.objects) typeOf.set(o.id, o.typeKey);
  // 链路导航索引（与 `propagateTick` 同式）：`"linkKey\0fromId"` → 该边的 toId 列表。
  const navOut = new Map<string, string[]>();
  for (const l of graph.links) {
    const k = navKey(l.linkKey, l.fromId);
    const cur = navOut.get(k);
    if (cur) cur.push(l.toId);
    else navOut.set(k, [l.toId]);
  }
  // `sourceTypeKey|sourceStateVar` → 规则（一格可能被多条规则读作源 ⇒ 数组）。
  const rulesBySource = new Map<string, PropagationRule[]>();
  for (const r of rules) {
    const k = cellKey(r.sourceTypeKey, r.sourceStateVar);
    const cur = rulesBySource.get(k);
    if (cur) cur.push(r);
    else rulesBySource.set(k, [r]);
  }

  /**
   * 一格的**一跳**下游：`{格, 这条边的 delayTicks}`。空数组 ⇒ 这一格推不动任何东西。
   * 刻意只回带 `delayTicks` 而不是算好的开销：开销取决于**这是第几跳**（见头注②），
   * 那是 BFS 的事，不是这里的事 —— 在这里就把它算死，第一跳那条例外就没地方表达了。
   */
  const stepsFrom = (objectId: string, stateVar: string): { objectId: string; stateVar: string; delayTicks: number }[] => {
    const t = typeOf.get(objectId);
    if (t === undefined) return [];
    const out: { objectId: string; stateVar: string; delayTicks: number }[] = [];
    for (const r of rulesBySource.get(cellKey(t, stateVar)) ?? []) {
      for (const toId of navOut.get(navKey(r.viaLinkKey, objectId)) ?? []) {
        // 目标类型必须对得上 —— 同一条链路键可能连着别的类型（`targetsOf` 的同一层过滤）。
        if (typeOf.get(toId) !== r.targetTypeKey) continue;
        out.push({ objectId: toId, stateVar: r.targetStateVar, delayTicks: r.delayTicks });
      }
    }
    return out;
  };

  // ── 各状态变量在本世界的观测极值（幅度口径 ③ 的唯一出处）──────────────────────────
  const varMin = new Map<string, number>();
  const varMax = new Map<string, number>();
  for (const row of Object.values(state)) {
    for (const [v, raw] of Object.entries(row)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const lo = varMin.get(v);
      const hi = varMax.get(v);
      if (lo === undefined || raw < lo) varMin.set(v, raw);
      if (hi === undefined || raw > hi) varMax.set(v, raw);
    }
  }

  let best: SeedPerturbationChoice | null = null;
  let candidates = 0;
  // 字典序遍历 ⇒ 并列时取最小者（R6 稳定 tiebreaker，见头注）。
  for (const objectId of Object.keys(state).sort((a, b) => a.localeCompare(b))) {
    const row = state[objectId]!;
    for (const stateVar of Object.keys(row).sort((a, b) => a.localeCompare(b))) {
      const first = stepsFrom(objectId, stateVar);
      if (first.length === 0) continue; // 不是任何规则的源，或没有下游对象 ⇒ 推不动
      const hi = varMax.get(stateVar);
      const lo = varMin.get(stateVar);
      if (hi === undefined || lo === undefined) continue;
      const magnitude = hi - lo;
      if (magnitude <= 0) continue; // 全距为 0 ⇒ `delta 0` = 什么都没发生
      candidates += 1;

      // ── BFS：按引擎时基算可达面。同一格可能经不同路径到达，留**最早到达**的那次 ──
      // `spent` = 该格比落点晚几拍才开始变。落点自己 = 0。
      // 第一跳开销 `delayTicks`、后续跳 `1 + delayTicks`（理由见头注②：引擎当拍就往下传）。
      const bestArrival = new Map<string, number>(); // cellKey → 最早到达拍数
      let frontier: { objectId: string; stateVar: string; spent: number }[] = [{ objectId, stateVar, spent: 0 }];
      let isFirstHop = true;
      while (frontier.length > 0) {
        const next: typeof frontier = [];
        for (const cur of frontier) {
          for (const st of stepsFrom(cur.objectId, cur.stateVar)) {
            const spent = cur.spent + (isFirstHop ? st.delayTicks : 1 + st.delayTicks);
            if (spent > budgetTicks) continue; // 这辈子不会出现在这条曲线上，不计
            const k = cellKey(st.objectId, st.stateVar);
            const seen = bestArrival.get(k);
            if (seen !== undefined && seen <= spent) continue;
            bestArrival.set(k, spent);
            next.push({ objectId: st.objectId, stateVar: st.stateVar, spent });
          }
        }
        frontier = next;
        isFirstHop = false;
      }
      // 落点自己那一格不算"下游"（它是因，不是果）。
      bestArrival.delete(cellKey(objectId, stateVar));
      const reachObjects = new Set<string>();
      for (const k of bestArrival.keys()) {
        const id = k.slice(0, k.indexOf("\u0000"));
        if (id !== objectId) reachObjects.add(id);
      }
      const reachCells = bestArrival.size;
      // 严格大于 ⇒ 并列保留先到者 = 字典序最小者。
      if (best !== null && reachCells <= best.reachCells) continue;
      best = {
        targetObjectId: objectId,
        targetStateVar: stateVar,
        magnitude,
        varMax: hi,
        varMin: lo,
        outRules: rulesBySource.get(cellKey(typeOf.get(objectId)!, stateVar))?.length ?? 0,
        reachCells,
        reachObjects: reachObjects.size,
        candidates: 0, // 总数要等遍历完才知道，最后回填
      };
    }
  }
  // 判据 2 的硬闸：**只动自己那一格不算带动下游**。选不出带下游的落点 ⇒ 诚实返回 null。
  if (best === null || best.reachObjects === 0) return null;
  return { ...best, candidates };
}

/**
 * `SEED_DEMO=1` → 给 demo 租户播**一条 RUNNING 的推演会话**（消四页的"无世界"占位）。
 *
 * 由两条播种路径调用（`server.ts` / `seed-cli.ts`）——两条**必须同步**（seed.ts 立的同一条纪律：
 * 漂了就会出现「容器起得来的环境有世界、跑过 pnpm seed 的环境没有」这种只在某些机器上复现的坑）。
 * 排在播种序列**最后**：它要读的是别人播完的产物（合成本体的对象 + 传导规则 + 流程层对象），
 * 任何一个没播完，铺出来的世界就是残的。
 *
 * 幂等（判据 4）：固定 id 先 `getSession`，判据落在 **`seedWorldCompleteness`（播完了没有）**
 * 而不是「有没有东西」——理由与实测见 `DEMO_SIM_WORLD_COMPLETE_KEY` 的头注。
 * 只影响 demo 种子（判据 5）：本函数只有 `SEED_DEMO=1` 分支调用，其它启动路径一个字节不动。
 */
export async function seedDemoSimWorld(repos: Repos, sim: SimWorldOps, ctx: AuthCtx): Promise<SeedWorldReport> {
  const existing = await repos.sim.getSession(ctx.tenantId, DEMO_SIM_WORLD_SESSION_ID);
  if (existing) {
    const completeness = seedWorldCompleteness(existing);
    if (completeness === "INCOMPLETE") {
      // ── 🔴 半残态：**不许**在这里报"幂等命中"走开（那正是本单要治的病）──────────────
      // 实测形态：`status=READY, cur_tick=0`，tick 态只剩 tick0，扰动零条 —— 播种被杀在
      // `createSession` 与 `tick` 之间。旧守卫看到"有东西了"就走开，日志打的是一句
      // 看起来一切正常的「幂等命中」，而四页的 `pickLatestRunningSession` 要 `RUNNING`，
      // 这条世界一辈子挑不中 ⇒ 屏上永远"无世界"。**修，并且如实说修了什么。**
      return await finishSeedWorld(repos, sim, ctx, existing, { repaired: true });
    }
    // ── 幂等命中（判据 6）：一条都不多，也不把已有世界再推 3 拍 ────────────────────────
    // `LEGACY` = 标记引入之前播下的世界，世界本身作证已播完 ⇒ 只**回填标记**，不重播。
    // 回填是一次 `putSession`（幂等 upsert），此后它就走 `COMPLETE` 那条零额外查询的快路。
    if (completeness === "LEGACY") await markSeedWorldComplete(repos, existing);
    //
    // ⚠ 另有一个**只在持久化部署上出现**的形态，必须诚实报出来而不是静默走开：
    // 本单之前播下的世界**没有扰动**（那时还不播），而固定 id 让判重在这里就短路 ⇒
    // 升级后重启，老世界照旧是一片"无事发生"，两条线仍逐值全等。
    // 不在这里补播：补了还得再推拍才能让它沿链路走，而"再推 3 拍"正是幂等要挡的事 ——
    // 两个都想要就会得到一个 curTick 越滚越大的世界。处置权交给运维（删掉这条会话再重启即可
    // 重播一个带扰动的），但**前提是他知道**。所以把这件事写进 `reason`。
    const existingPerturbations = await repos.sim.listPerturbations(ctx.tenantId, existing.id);
    return {
      created: false,
      repaired: false,
      completeness,
      sessionId: existing.id,
      curTick: existing.curTick,
      reason:
        "幂等命中：种子世界已存在且**已播完**（固定 id + 完成标记），不重建、不再推拍" +
        (completeness === "LEGACY" ? "；该世界播于完成标记引入之前，本次已回填标记（未重播）" : "") +
        (existingPerturbations.length === 0
          ? "；⚠ 该世界**零扰动**（本单之前播的老世界），基线与扰动后两条线会逐值全等 —— " +
            `删除会话 ${existing.id} 后重启即可重播一个带扰动的世界`
          : `；已有 ${existingPerturbations.length} 条扰动`),
      origin: null,
      perturbation: null,
      choice: null,
      perturbationReason: existingPerturbations.length === 0 ? "幂等命中的老世界零扰动，本次不补播（补播需再推拍，与幂等冲突）" : null,
    };
  }
  const { state, origin } = await deriveSeedBaseSnapshot(repos, ctx.tenantId);
  // 诚实缺席：没有规则或没有物化对象 ⇒ **不建空世界**。一条 baseSnapshot 为空的 RUNNING 会话
  // 会让四页从"没有世界"变成"有世界但每一格都取不到数"——后者更难查（判据同 `useConsoleSession`
  // 分五态的理由：`no-running-session` 与"有会话但这一格没数据"处置完全不同）。
  if (origin.cells === 0) {
    return {
      created: false,
      repaired: false,
      completeness: null, // 库里压根没有种子世界 ⇒ 谈不上"完整性"，不许拿 COMPLETE 冒充
      sessionId: null,
      curTick: 0,
      reason:
        `本租户零可铺格子（PUBLISHED 传导规则触及 ${origin.types} 个类型、物化对象 ${origin.objects} 个）` +
        "⇒ 不建空世界（空 baseSnapshot 的 RUNNING 会话 = 把占位换成另一种占位）",
      origin,
    };
  }
  // ── 选种子扰动的落点（**建会话之前**算完：会话 `scope` 要把口径一起带上）────────────────
  // 图/规则走**唯一装配处** `buildPropagationInputs`（与 `POST …/tick`、Trial Tick 同一份）——
  // 在这里另拼一张图，就会出现「选点时看到的世界」与「引擎真跑的世界」不是同一个，
  // 落点当场落空（本仓「第二套真相源」的老形态）。范围走契约唯一实现 `resolveSimScope`。
  const seedScope: Record<string, unknown> = {
    // 种子记号（幂等/审计用）。**没有 `kind` 键** ⇒ `resolveSimScope` 读作 GLOBAL，与旧会话同档。
    [DEMO_SIM_WORLD_SCOPE_KEY]: true,
    label: "demo 种子世界",
    baseSnapshotOrigin: origin,
  };
  const inputs = await buildPropagationInputs(repos, ctx, resolveSimScope(seedScope));
  // 新会话的 `disabledRuleKeys` 恒为空（`createSimSessionWorld` 写死），故"引擎将吃的规则"= 全部 PUBLISHED。
  const rules = await repos.sim.listPropagationRules(ctx.tenantId, true);
  const choice = pickSeedPerturbation({
    state,
    graph: inputs.graph,
    rules,
    // 扰动在 tick1 落地，世界总共推 3 拍 ⇒ 还剩 2 拍可以往下传。
    budgetTicks: DEMO_SIM_WORLD_TICKS - DEMO_SIM_WORLD_PERTURB_START_TICK,
  });
  if (choice !== null) seedScope.seedPerturbation = choice;

  const session = await sim.createSession(ctx, {
    baseSnapshot: state,
    scope: seedScope,
    id: DEMO_SIM_WORLD_SESSION_ID,
    createdAt: DEMO_SIM_WORLD_CREATED_AT,
  });

  return await finishSeedWorld(repos, sim, ctx, session, { repaired: false });
}

/**
 * 播种的**后半段**：扰动 → 真 tick → 落完成标记。**新建路与修复路共用这一份**。
 *
 * 为什么必须共用而不是修复路另写一段：两段各写一套，就会出现「新建的世界带扰动、
 * 修出来的世界不带」这种只在崩过一次的机器上复现的漂移 —— 本仓治过多次的
 * 「两半各写一套必漂」。这里连 `startTick` / 固定 id / label 截断都只有一处。
 *
 * ── 修复路（`repaired:true`）比新建路多做的两件事，都不是可选的 ───────────────────
 * ① `deleteTicksAfter(…, 0)`：把上一次没播完留下的**残 tick 行**清掉。
 *    不清 ⇒ 若残行的拍数比这次推的多，库里会留着一段**属于上一个半成品世界**的世界线，
 *    而 `GET …/:id/world` 取的正是落盘行 —— 屏上会读到一段没人再算得出来的历史。
 * ② `putSession` 把 `status/curTick` 归零：`sim.tick` 是**相对推进**（从 `curTick` 往后推 n 拍），
 *    半残世界的 `curTick` 可能已经是 1 或 2 ⇒ 直接推 3 拍会得到 `curTick=5` 这种数，
 *    而完成判据是 `curTick >= 3`，它照样"通过" —— 一个**能骗过自己判据**的修法。
 *    ⚠ `baseSnapshot`/`scope`/`createdAt` **原样保留**（不重算）：那份世界是上一次从当时的本体
 *    铺出来的，重算会得到一个与库里那行不是同一个世界的东西（R6 确定性在这里指的是
 *    「同一条种子世界」，不是「今天重跑会得到什么」）。
 */
async function finishSeedWorld(
  repos: Repos,
  sim: SimWorldOps,
  ctx: AuthCtx,
  session: SimSession,
  opts: { repaired: boolean },
): Promise<SeedWorldReport> {
  // 出处/落点都从会话自己的 `scope` 里读 —— 修复路没有 `deriveSeedBaseSnapshot` 的返回值，
  // 而重算一次会得到「今天的本体」铺出来的世界，与库里那行不是同一个（见函数头注②）。
  const scope = session.scope as Record<string, unknown>;
  const origin = (scope.baseSnapshotOrigin as SeedWorldSnapshotOrigin | undefined) ?? null;
  const choice = (scope.seedPerturbation as SeedPerturbationChoice | undefined) ?? null;

  if (opts.repaired) {
    await repos.sim.deleteTicksAfter(ctx.tenantId, session.id, 0);
    session.status = Object.keys(session.baseSnapshot).length > 0 ? "READY" : "DRAFT";
    session.curTick = 0;
    await repos.sim.putSession(session);
  }

  // ── 播扰动：**必须排在 tick 之前** ────────────────────────────────────────────────
  // 引擎只在**产出 `startTick` 那一格**时施加一次（`propagateTick` 的 `entersAt`）。
  // 先 tick 后建扰动 ⇒ 那一格早就跑过去了，扰动只会被 `POST …/perturbations` 就地写进
  // **当前 tick 那一行的落点那一格**，下游一格不动 ⇒ 落库的世界是错的。
  //
  // ⚠ 这个错**不会**在 `metric-series` 上露出来，别指望那条曲线兜底 —— 变异反证实测过：
  // 把本段挪到 `sim.tick` 之后重跑接缝门，⑤a–⑤e **全绿**，只有 ⑤f 报红
  // （`obj_base_changzhou.loadIndex` 落盘 1021.48 / 曲线 1097.08）。
  // 机制：那两条线是**从 tick0 现场重算**的，压根不读 `sim_tick_state` 的落盘行 ——
  // 只要扰动记录在库里，曲线照样分叉、照样好看；而沙盘取「当前世界」走的是落盘行
  // （`GET …/:id/world`），于是屏上两处对不上账。**曲线对不证明世界对。**
  //
  // 只播**一条**（判据 3）：`delta`/`scale` 不可交换，多条就要为"为什么是这个顺序"负责；
  // 一条 ⇒ 顺序问题在结构上不存在，不必靠插入序的偶然性。
  let perturbation: Perturbation | null = null;
  if (choice !== null) {
    const varLabel = stateVarDisplayName(choice.targetStateVar) ?? choice.targetStateVar;
    const r = await sim.createPerturbation(
      ctx,
      session,
      {
        // `kind` 只管**展示分类**，契约判据 3 写明它**不进传导规则** ⇒ 它一个数字都不影响。
        // 取枚举首项而不是挑一个"像"的：落点是**结构**选出来的，我们没有任何依据断言
        // 这是一次「产能损失」还是「质量事件」——替租户下这种判断正是 R14 要禁的。
        // 真正的出处写在 `label` 与 `scope.seedPerturbation` 里，那两处每个数都可复算。
        kind: PerturbationKindSchema.options[0],
        targetObjectId: choice.targetObjectId,
        targetStateVar: choice.targetStateVar,
        startTick: DEMO_SIM_WORLD_PERTURB_START_TICK,
        // 永久（`null`）：可传导的预算只有 2 拍，限时扰动会在下游还没看见之前就回退，
        // 屏上又是一条几乎重合的线 —— 那等于没播。
        durationTicks: null,
        magnitude: choice.magnitude,
        mode: "delta",
        // ⚠ 截到 200：契约 `label` 是 `z.string().max(200)`，而 `varLabel` 来自**租户数据**
        // （`stateVarDisplayName` 查不到就回落裸变量名，长度不受本仓控制）。
        // 超一个字 ⇒ `safeParse` 失败 ⇒ 播种抛错 ⇒ **整个服务起不来**。
        // 一句展示文案不值得赌服务启动；真正的出处在 `scope.seedPerturbation` 里，那份不截。
        label: (
          `种子扰动 · 把「${varLabel}」抬高一个全距（+${choice.magnitude}）` +
          `｜落点 = 传导可达面最大的一格（${choice.candidates} 个候选里下游 ${choice.reachCells} 格 / ${choice.reachObjects} 个对象）`
        ).slice(0, 200),
      },
      // 确定性 + 幂等：id/createdAt 都跟着会话固定，重跑逐字节一致（R6）。
      { id: `${DEMO_SIM_WORLD_SESSION_ID}_p0`, createdAt: DEMO_SIM_WORLD_CREATED_AT },
    );
    perturbation = r.perturbation;
  }

  // 真 tick（与 `POST …/tick` 同一份传导核）：会话在这一步才变 RUNNING，`curTick` 才真进位。
  // 扰动已经在库里 ⇒ `simAdvanceTicks` 的 `listPerturbations` 读得到，引擎在 tick1 施加并往下带。
  const ticked = await sim.tick(ctx, session, DEMO_SIM_WORLD_TICKS);

  // ── 完成标记：**必须是最后一次写** ──────────────────────────────────────────────
  // 它就是这条会话「播完了」的唯一证据。写在这里 ⇒ 上面任何一步被杀，标记都不在，
  // 下次启动 `seedWorldCompleteness` 判 INCOMPLETE、如实报、并修。
  // 写早一格（比如紧跟 `createSession`）就会得到一个**说自己播完了的半成品** ——
  // 那比没有标记更坏：它把"我没查到"变成了"它已经好了"。
  await markSeedWorldComplete(repos, { ...session, status: "RUNNING", curTick: ticked.curTick });

  return {
    created: !opts.repaired,
    repaired: opts.repaired,
    completeness: "COMPLETE",
    sessionId: session.id,
    curTick: ticked.curTick,
    reason: opts.repaired
      ? `⚠ 检测到播种不完整（会话 ${session.id} 存在但未播完：无完成标记，且非 RUNNING@tick≥${DEMO_SIM_WORLD_TICKS}）` +
        `—— 已自动补齐：世界线重置到 tick0、重播扰动、重推 ${DEMO_SIM_WORLD_TICKS} 拍、落完成标记`
      : null,
    origin,
    perturbation,
    choice,
    // 诚实缺席：没播扰动就**说为什么**（世界照建，但屏上会是一片"无事发生"，得让人查得到）。
    perturbationReason:
      choice === null
        ? "本世界选不出**能带动下游**的落点（无格子同时满足：是某条 PUBLISHED 规则的源 · 该对象沿 viaLinkKey 真有对应类型的下游 · 该状态变量在本世界的观测全距 > 0）⇒ 不播扰动"
        : null,
  };
}

/**
 * 把完成标记落到会话 `scope` 上（幂等：同值重写无副作用）。
 *
 * 走 `putSession` 而不是 `createSession`：后者会连 tick0 态一起重写并再发一次
 * `sim.session_created` —— 回填一个标记不该让全前端的会话缓存失效一次。
 */
async function markSeedWorldComplete(repos: Repos, session: SimSession): Promise<void> {
  await repos.sim.putSession({
    ...session,
    scope: { ...(session.scope as Record<string, unknown>), [DEMO_SIM_WORLD_COMPLETE_KEY]: DEMO_SIM_WORLD_TICKS },
  });
}
