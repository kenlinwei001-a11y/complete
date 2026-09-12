/**
 * WO-WORLDSTATE-CONTRACT · **世界态读取契约**的唯一实现。
 *
 * ══ 今天的行为是 X，应该是 Y（开工实测原文，本机 4051 内存态 demo 租户）════════════
 *
 * **X**：`sessionId` 这根管子**从前端一路通到装配器**，终点却没人接收 ——
 *   `SandboxOptRoute.tsx` 传（`body = sessionId ? {sessionId} : {}`）、
 *   `opt-assemble.ts` 抄进回包（唯一一处，注释原文「本层不解释它」）、
 *   `opt-pareto.ts` 里 `sessionId` **零命中**（金丝雀：同文件 `objectives` 命中 17 ⇒ 真零命中）。
 *   实测：`obj_model_4680-NCM.costPressure` 施 999（http 201，世界态确认写入）再 tick×3，
 *   方案寻优回包 **md5 `f46392a90be7692d17503e04fc06d432` / 19124B 逐字节不变**；
 *   金丝雀（证读数取法有鉴别力）：只收窄 `selection` ⇒ md5 当场变
 *   `fce5fb58b094da9fd1292829a46a0f74` / 19292B。
 *   ⇒ 形态是「**接了线、线通、终点没人接收**」，不是「没接线」。
 *
 * **Y（本文件）**：把「产出侧怎么读这次推演的世界态」写成一份**可披露的契约**，
 *   让方案寻优读的是**这次推演的世界态**而不是本体真值。
 *
 * ══ 本单真正的架构问题（实测才看得见，不读代码想不出来）═══════════════════════════
 * **世界态与优化模型钉在不同的对象类型上**：
 *   · 模型读的决策对象：`OrderLine`(873) · `Base`(13)
 *   · 这两类身上的世界态只有 `OrderLine.splitPressure` / `Base.loadIndex`
 *   · 而 `costPressure` 挂在 `Order`(500) 与 `Model` 上 —— **不是模型读的那两类**
 * 于是「把世界态灌进 args」这句话本身**没有定义**：灌哪一格、灌到谁身上，
 * 正是本文件要写下来的东西。
 *
 * ══ 三条纪律（每条都是复用既有口径，不是新发明）═══════════════════════════════════
 *  ① **同名直取（DIRECT）**：`state[objId][v]` 里 `v` 恰好是该对象一个属性 ⇒ 直接覆盖。
 *     这是 `seed-world.ts` `deriveSeedBaseSnapshot` 播种纪律的**逆向** —— 它播种时先探
 *     `props[stateVar]`「同名属性存在且是有限数 ⇒ 那就是真读数」。读写两侧共用**一个身份**，
 *     不另立映射。（demo 上 `measuredCells:0` ⇒ 这一档今天恒 0 格；本体哪天长出这些属性，
 *     它**自己就会开始生效**，不用等人想起来改代码。）
 *  ② **压力投影（PROJECTED）**：压力类变量不是属性，要一座量纲桥才能作用到金额/产能上。
 *     桥**复用 `FINANCE_WORLD_PRESSURE_DIVISOR`**（`finance-world.ts` 已声明并已在跑的那座），
 *     公式与它逐字同形：`量' = 量 ×（1 ± 压力 ÷ divisor）`。
 *     ⛔ **不新增任何业务系数** —— divisor 是**单位换算**（百分点→比率），不是业务常数。
 *  ③ **经真链路反查**：压力挂在别的类型上时，只走**本体里真实存在的那条边**
 *     （`finance-world.ts` 原话：「经真链路 `customer_has_invoice` 反查 ＝ 传导规则自己走的
 *     那条边，不另造映射」）。⛔ 不按名字猜对应关系。
 *
 * ══ 落点为什么用词库而不是写死属性名（R14）═══════════════════════════════════════
 * 投影声明只说「作用到**成本 / 产能 / 需求量**这一格」，具体是哪个属性由
 * `field-role-lexicon.ts` 的 `lexiconHit` 现判 —— **与装配器挑 role 用的是同一份词库**。
 * 换个租户换套本体，落点自动跟着变，代码一行不动。
 * ⛔ 写死 `unitCost`/`serveCost` 这种属性名就是把本行业的建模判断焊进平台。
 *
 * ══ R4 / R6 ════════════════════════════════════════════════════════════════════
 * R4：**全程只读**。不写世界态、不写本体真值、不发事件 —— 沙盘只推演不写真值。
 *     覆盖只发生在**返回给调用方的副本**上（`{...o, props:{...}}`），仓储里那一行一个字节不动。
 * R6：无 `Date` / 无随机；对象按 id、变量按名、承载体按全序遍历 ⇒
 *     同 (会话, 拍, 本体) 重跑逐字节一致。
 */
import {
  FINANCE_WORLD_PRESSURE_DIVISOR,
  type SimWorldAppliedCell,
  type SimWorldProjectionRule,
  type SimWorldReadDisclosure,
  type SimWorldUnconsumed,
  type TickState,
} from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../domain.js";
import { notFound } from "../errors.js";
import type { Repos } from "../repo/repo.js";
import { lexiconHit, type RoleLexiconKey } from "../solvers/field-role-lexicon.js";

/**
 * `applied[]` 明细的条数上限（**保险丝，不是业务常数**）。
 *
 * 生产量级下被改写的格子可达数千（demo 实测 873 条 OrderLine × 1 格），
 * 全量回包会让装配响应涨到 MB 级 —— 而屏上那张溯源表只看得下几十行。
 * ⛔ 截断必须**如实报数**（`appliedTruncated`），不许静默少给：
 * 静默截断会让「这一格没被改」与「改了但没印出来」在屏上一模一样。
 */
export const WORLD_READ_APPLIED_LIMIT = 200;

/**
 * **投影声明表**（本契约今天认的全部压力→模型量映射）。
 *
 * ⚠ 这张表是**声明不是常数**：每一行都写明沿用哪条已落地的口径，随回包下发
 * （`SimWorldReadDisclosure.rules`），屏上当场可查「凭什么是这个数」。
 *
 * ⛔ 为什么只有这几行、而不是把 41 个状态变量全铺上：
 * 铺一行就是替租户下一次**建模判断**（`seed-world.ts` 那条纪律的原话：
 * 「不给状态变量硬编一个"从哪个属性来"的映射：那是替租户下建模判断」）。
 * 故这里**只收录能指到既有口径的**那几条；其余变量一律进 `unconsumed[]` 诚实点名，
 * 让下一张单据此决定要不要收编，而不是本文件替它决定。
 */
export const SIM_WORLD_PROJECTION_RULES: readonly SimWorldProjectionRule[] = [
  {
    stateVar: "costPressure",
    affects: "cost",
    direction: "up",
    formula: "成本' = 成本 ×（1 + 成本压力 ÷ divisor）",
    source: "沿用 finance_world_projection 对同一个 costPressure 的成本投影（同一座量纲桥、同一个经济量）",
  },
  {
    stateVar: "loadIndex",
    affects: "capacity",
    direction: "down",
    formula: "可用产能' = 产能 ×（1 − 负荷指数 ÷ divisor）",
    source: "负荷指数按定义就是产能已被占用的比例；桥同 finance_world_projection",
  },
  {
    stateVar: "utilPressure",
    affects: "capacity",
    direction: "down",
    formula: "可用产能' = 产能 ×（1 − 利用率压力 ÷ divisor）",
    source: "同 loadIndex：利用率压力按定义占用产能；桥同 finance_world_projection",
  },
  {
    stateVar: "demandPressure",
    affects: "demand",
    direction: "up",
    formula: "需求量' = 需求量 ×（1 + 需求压力 ÷ divisor）",
    source: "需求压力按定义作用在需求量上；桥同 finance_world_projection",
  },
];

/** `affects` → 词库 role（落点判据与装配器挑 role 用同一份词库，不另抄一套正则）。 */
const AFFECTS_LEXICON: Record<SimWorldProjectionRule["affects"], RoleLexiconKey> = {
  cost: "cost",
  capacity: "capacity",
  demand: "demand",
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 与全链一致的量化分辨率（同 `opt-pareto.ts` 的 `QUANT`，不另立一套精度）。 */
const q = (x: number): number => Math.round(x * 1e6) / 1e6;

/** 一个候选承载体：压力挂在谁身上、怎么取过来的。 */
interface Carrier {
  id: string;
  type: string;
  /** `SELF` 或本体里真实存在的那条边的 linkKey。 */
  via: string;
}

export interface WorldReadView {
  /** 叠了世界态的 `listByType`（签名与 `BindingOntologyView`/`AssembleDeps` 逐字一致）。 */
  listByType(tenantId: string, typeKey: string): Promise<ObjectInstance[]>;
  /** 收尾取披露块 —— 只统计**真被读过**的类型（没读过的类型不该出现在溯源表里）。 */
  disclosure(): SimWorldReadDisclosure;
}

/**
 * WO-WORLDSTATE-SURFACE · **世界态叠加核**（从 `buildWorldReadView` 原样抽出，单一实现两处复用）。
 *
 * 与 `WorldReadView` 的分工：
 *   · `WorldReadView.listByType` = **仓储读** + 叠加（装配器路径：它自己打 `repos.objects.listByType`）。
 *   · `SolverWorldOverlay.overlayRows` = **只叠加**（求解器路径：行已由 `loadContext` 载好，
 *     且已经过了 A6 行级过滤与 WO-69 列投影 —— 再打一次仓储会绕开列投影，把被禁列叠回求解器）。
 *
 * ⛔ 两处必须共用同一个叠加核：各抄一份就是「装配器叠一套、求解器叠另一套」，
 * 同一个世界在两屏上给出两个都"对"的数 —— 第二套真相源。
 */
export interface SolverWorldOverlay {
  readonly worldId: string;
  readonly tick: number;
  readonly source: "TICK" | "BASE_SNAPSHOT";
  /** 世界态里有态的对象数（0 ⇒ 披露块如实说「未发生世界隔离」，不静默当真值算）。 */
  readonly objectsWithState: number;
  /**
   * 把世界态叠到**已加载的**对象行上。只改返回的副本（R4：仓储行一个字节不动）；
   * 一格都没被改写的行返回**同一引用**（调用方 `c.orders = overlayRows(...)` 在无世界态时逐字节等价）。
   */
  overlayRows(typeKey: string, rows: readonly ObjectInstance[]): ObjectInstance[];
  /** 收尾取披露块 —— 只统计**真被 overlayRows 处理过**的类型。 */
  disclosure(): SimWorldReadDisclosure;
}

/**
 * 建一个世界态叠加核（`buildWorldReadView` 与求解器统一读取面共用）。
 *
 * @throws `notFound("sim session")` —— 会话不存在**或**属于别的租户（R2 暗发，
 *   与 `getSimOr404` / `finance-world.ts` 同一个闸门）。
 *   ⛔ **绝不静默退化成「读本体真值」** —— 那正是本单要修的这个病的形态：
 *   悄悄给你一份看起来正常、其实答非所问的数。
 */
export async function buildSolverWorldOverlay(
  repos: Repos,
  tenantId: string,
  worldId: string,
  opts: { pressureUnit?: "pp" | "ratio" } = {},
): Promise<SolverWorldOverlay> {
  const session = await repos.sim.getSession(tenantId, worldId);
  if (!session) throw notFound("sim session");

  // 取**当前拍**的态；该拍还没落格就回落开局快照 —— 与 `loadChainSimOverlay`
  // （`wo-drill-verdict-backend`）和 `finance-world.ts` 同一条判据，不另写一条。
  const tickRow = await repos.sim.getTickState(tenantId, session.id, session.curTick);
  const world: TickState = tickRow?.state ?? session.baseSnapshot;
  const source: SimWorldReadDisclosure["source"] = tickRow ? "TICK" : "BASE_SNAPSHOT";

  const pressureUnit = opts.pressureUnit ?? "pp";
  const divisor = FINANCE_WORLD_PRESSURE_DIVISOR[pressureUnit];

  /**
   * 链路索引（**一次全量读，之后纯内存**）。
   *
   * ⚠ 按 `fromId`/`toId` 两个方向都索引：`OrderLine --line_of_order--> Order` 与
   * `Order --order_has_line--> OrderLine` 在 demo 上**两条边都真实存在**，
   * 只索引一个方向会漏掉一半承载体（实测过：只索 out 时 `Order.costPressure` 取不到）。
   */
  const links = await repos.links.list(tenantId, () => true);
  const neighbors = new Map<string, Carrier[]>();
  const pushNb = (from: string, c: Carrier): void => {
    const cur = neighbors.get(from);
    if (cur) cur.push(c);
    else neighbors.set(from, [c]);
  };
  for (const l of links) {
    pushNb(l.fromId, { id: l.toId, type: "", via: l.type });
    pushNb(l.toId, { id: l.fromId, type: "", via: l.type });
  }

  /** 世界态里承载各状态变量的对象数（用于 `unconsumed` 的诚实计数）。 */
  const carriersOf = new Map<string, number>();
  for (const objId of Object.keys(world)) {
    for (const v of Object.keys(world[objId] ?? {})) carriersOf.set(v, (carriersOf.get(v) ?? 0) + 1);
  }

  const applied: SimWorldAppliedCell[] = [];
  let appliedTotal = 0;
  const consumedVars = new Set<string>();
  const typeStats = new Map<string, { objects: number; cellsApplied: number }>();
  /** 对象 id → 类型（现读现填，用于给承载体标类型；读不到就留空串由下面补 `"?"`）。 */
  const typeOfId = new Map<string, string>();

  const record = (cell: SimWorldAppliedCell): void => {
    appliedTotal += 1;
    if (applied.length < WORLD_READ_APPLIED_LIMIT) applied.push(cell);
    consumedVars.add(cell.stateVar);
  };

  /**
   * 找某条投影规则在某个对象上的**唯一承载体**。
   *
   * ⛔ **只取一个**（全序：`SELF` 优先 → linkKey 字典序 → 承载体 id 字典序）。
   * 理由不是审美：demo 上 `OrderLine` 经 `line_of_order` 够得着 `Order.costPressure`、
   * 经 `orderline_for_model` 又够得着 `Model.costPressure`，**两个都取就把同一笔经济事实
   * 叠了两次**（而且叠出来的曲线在屏上完全正常，没人看得出来）。
   */
  const carrierFor = (objId: string, stateVar: string): Carrier | undefined => {
    if (isNum(world[objId]?.[stateVar])) return { id: objId, type: typeOfId.get(objId) ?? "", via: "SELF" };
    const cands = (neighbors.get(objId) ?? []).filter((c) => isNum(world[c.id]?.[stateVar]));
    if (cands.length === 0) return undefined;
    return [...cands].sort((a, b) => a.via.localeCompare(b.via) || a.id.localeCompare(b.id))[0];
  };

  const overlayRows = (typeKey: string, inputRows: readonly ObjectInstance[]): ObjectInstance[] => {
    const rows = inputRows as ObjectInstance[];
    for (const o of rows) typeOfId.set(o.id, o.type);
    const stat = typeStats.get(typeKey) ?? { objects: 0, cellsApplied: 0 };
    stat.objects = rows.length;

    /**
     * R6 双重序：**处理序**按 id 升序（`applied[]` 截断永远取同一批格子），
     * **返回序保持输入序** —— 叠加只缩格，**不重排**。
     * 求解器路径的入参是 `loadContext` 载好的 ctx 数组，其顺序是加载层的口径；
     * 零压力时本函数必须返回「同序同引用」的行，否则「世界态零压力」与「没传 worldId」
     * 会因**行序**不同而给出不同回包 —— 那就不是世界态在起作用，是排序在起作用。
     * （装配器路径要 id 升序由 `buildWorldReadView` 自己 sort —— 那是它开工前就有的契约。）
     */
    const patched = new Map<string, ObjectInstance>();
    for (const o of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      const props = { ...o.props };
      let touched = false;

        // ── ① 同名直取（DIRECT）──────────────────────────────────────────────
        // 变量按名升序 ⇒ 遍历序确定（R6）。
        for (const v of Object.keys(world[o.id] ?? {}).sort((a, b) => a.localeCompare(b))) {
          const raw = world[o.id]?.[v];
          const before = props[v];
          if (!isNum(raw) || !isNum(before)) continue; // 同名属性不存在或不是数 ⇒ 这一档不适用
          if (before === raw) { consumedVars.add(v); continue; } // 值本来就一样，不算一次改写
          props[v] = raw;
          touched = true;
          stat.cellsApplied += 1;
          record({
            objectId: o.id, objectType: o.type, property: v, stateVar: v,
            carrierId: o.id, carrierType: o.type, via: "SELF",
            rawValue: q(raw), before: q(before), after: q(raw), kind: "DIRECT",
          });
        }

        // ── ② 压力投影（PROJECTED）──────────────────────────────────────────
        for (const rule of SIM_WORLD_PROJECTION_RULES) {
          const carrier = carrierFor(o.id, rule.stateVar);
          if (!carrier) continue;
          const raw = world[carrier.id]?.[rule.stateVar];
          if (!isNum(raw)) continue;
          // 压力为 0 ⇒ 因子为 1 ⇒ 不是一次改写（记成改写会让 `cellsApplied` 虚高，
          // 而那个数是「这次推演到底影响了几格」的唯一读数）。
          if (raw === 0) { consumedVars.add(rule.stateVar); continue; }
          const factor = rule.direction === "up" ? 1 + raw / divisor : 1 - raw / divisor;
          // 产能被占用到负数没有物理意义 ⇒ 夹在 0（"这条线满负荷、一格都腾不出来"）。
          const safe = Math.max(0, factor);
          const lex = AFFECTS_LEXICON[rule.affects];
          for (const p of Object.keys(props).sort((a, b) => a.localeCompare(b))) {
            const before = props[p];
            if (!isNum(before) || before === 0) continue;
            if (!lexiconHit(p, lex)) continue;
            const after = q(before * safe);
            if (after === q(before)) continue;
            props[p] = after;
            touched = true;
            stat.cellsApplied += 1;
            record({
              objectId: o.id, objectType: o.type, property: p, stateVar: rule.stateVar,
              carrierId: carrier.id, carrierType: typeOfId.get(carrier.id) ?? carrier.type ?? "?",
              via: carrier.via, rawValue: q(raw), before: q(before), after, kind: "PROJECTED",
            });
          }
        }

      // R4：只改**返回给调用方的副本**，仓储里那一行一个字节不动。
      if (touched) patched.set(o.id, { ...o, props });
    }

    typeStats.set(typeKey, stat);
    // 返回序 == 输入序；没被改写的行返回**同一引用**（零压力 ⇒ 整个数组与输入逐格等价）。
    return rows.map((o) => patched.get(o.id) ?? o);
  };

  const disclosure = (): SimWorldReadDisclosure => {
    const objectTypesRead = [...typeStats.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([typeKey, s]) => ({ typeKey, objects: s.objects, cellsApplied: s.cellsApplied }));
    /**
     * 世界态里有、本模型没消费的变量。⛔ 不许留白：留白会被读成「这个变量没有压力」，
     * 而真相是「这个模型不看它」—— 两件事的处置完全不同。
     */
    const unconsumed: SimWorldUnconsumed[] = [...carriersOf.entries()]
      .filter(([v]) => !consumedVars.has(v))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([stateVar, carriers]) => ({
        stateVar,
        carriers,
        reason: SIM_WORLD_PROJECTION_RULES.some((r) => r.stateVar === stateVar)
          ? "本模型读的对象上，既没有同名属性、也没有经真链路够得着的承载体。"
          : "投影声明表里没有这个变量 —— 收录它等于替租户下一次建模判断，故诚实缺席而不是硬折算。",
      }));
    const worldObjects = Object.keys(world).length;
    return {
      sessionId: session.id,
      tick: session.curTick,
      source,
      worldObjects,
      objectTypesRead,
      cellsApplied: appliedTotal,
      rules: [...SIM_WORLD_PROJECTION_RULES],
      applied,
      appliedTruncated: Math.max(0, appliedTotal - applied.length),
      unconsumed,
      pressureUnit,
      divisor,
      agentInvolved: false,
      note:
        worldObjects === 0
          ? `世界 ${session.id} 第 ${session.curTick} 拍的态是空的（0 个对象有态）——` +
            "本次实质跑在本体当前值上，未发生世界隔离。这不是「扰动不影响方案」，是「这个世界里还没有任何态」。"
          : appliedTotal === 0
            ? `读了世界 ${session.id} 第 ${session.curTick} 拍（${worldObjects} 个对象有态），` +
              "但本模型读的那几格一格都没被改写 —— 这是「这次推演还没影响到这个模型」，不是「没读世界态」。" +
              "没被消费的变量已逐条列出。"
            : `读了世界 ${session.id} 第 ${session.curTick} 拍（${worldObjects} 个对象有态），` +
              `改写 ${appliedTotal} 格。压力按${pressureUnit === "pp" ? "百分点" : "比率"}读，除数 ${divisor}。` +
              "本次未调用 agent：全部读数来自求解器入参与本体真值。",
    };
  };

  return {
    worldId: session.id,
    tick: session.curTick,
    source,
    objectsWithState: Object.keys(world).length,
    overlayRows,
    disclosure,
  };
}

/**
 * 建一个世界态读取视图（装配器路径的薄壳：仓储读 + 同一个叠加核）。
 *
 * @throws `notFound("sim session")` —— 会话不存在**或**属于别的租户（R2 暗发，
 *   与 `getSimOr404` / `finance-world.ts` 同一个闸门）。
 *   ⛔ **绝不静默退化成「读本体真值」** —— 那正是本单要修的这个病的形态：
 *   悄悄给你一份看起来正常、其实答非所问的数。
 */
export async function buildWorldReadView(
  repos: Repos,
  ctx: AuthCtx,
  sessionId: string,
  opts: { pressureUnit?: "pp" | "ratio" } = {},
): Promise<WorldReadView> {
  const overlay = await buildSolverWorldOverlay(repos, ctx.tenantId, sessionId, opts);
  return {
    // 装配器路径的契约从本契约落地第一天起就是 **id 升序**（叠加核改成「返回序保持输入序」之前
    // 就在这里排）——sort 留在这层，与开工前逐字节一致；求解器路径不受这层约束。
    listByType: async (tenantId, typeKey) =>
      overlay
        .overlayRows(typeKey, await repos.objects.listByType(tenantId, typeKey))
        .sort((a, b) => a.id.localeCompare(b.id)),
    disclosure: overlay.disclosure,
  };
}
