import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { type CodeTree, checkedTree, factHits } from "./factlock.js";

/**
 * WO-SIM-ACT-CLOSE · **扰动闭环接缝门**（欠账 #150 / #151 / #152）。
 *
 * ══ 这条测试为什么不是"各半 unit" ══
 *
 * 沙盘的病从来不在某一半：引擎能传导（`sim-propagation.test.ts` 全绿）、路由能收扰动
 * （`sim-perturbation.test.ts` 全绿）、前端能画沙盘（`sandbox-*.test.tsx` 全绿）——
 * 三份绿测试摞在一起，用户仍然**在界面上做不出任何一个让世界改变的动作**。
 * 断的是接缝：`POST …/act` 零 src 调用方、`POST …/perturbations` 有 API 封装但零 UI 调用方。
 *
 * 所以本门的驱动方式是：**从前端源码里把它真正构造的那个请求抽出来，用抽出来的东西去打真后端**。
 *  · 前端把端点/字段名改了、或把那个按钮删了 ⇒ 抽取失败或 payload 变形 ⇒ 红；
 *  · 后端引擎不传导了、或扰动没进 `propagateTick` ⇒ 下游 KPI 不变 ⇒ 红。
 * 任何一半退化都红 —— 这正是 SEAM-GATE 要的「接缝驱动通」而非「各半绿」。
 *
 * ⚠ 每一处"抽取"都先跑金丝雀（铁律 0.6）：读到的源码非空 + 一个**已知必中**的锚点先命中，
 *   不中就报「工具坏了」，绝不报「前端没接线」。
 */

// ── 源码抽取（带金丝雀）─────────────────────────────────────────────────────────
const FE_TREE = "apps/frontend-shell/src";

/** 用户真按的那个东西 —— 本门要复刻的，就是它发出去的那个请求。 */
const APPLY_BTN = 'data-testid="sandbox-perturbation-apply-btn"';
/** 该按钮 `onClick` 直接调的处理器（链路第二段：按钮 → 处理器 → POST）。 */
const APPLY_HANDLER = "onApplyPerturbation";
/**
 * 扰动 POST 调用点。**只认「在调用」，不认实参叫什么名字**（病历见 `perturbationCallKeys` 顶注）。
 * `endpoints.ts` 里的封装**定义**写作 `createSimPerturbation = (`，中间隔着 `=`，天然不中
 * —— 「定义」不是「调用」，这条区分是 CLAUDE.md 铁律 0.5 判据 2 的原话。
 */
const PERTURB_CALL = /\bcreateSimPerturbation\s*\(/;
const EP_RE = /createSimPerturbation[\s\S]{0,900}?`(\/a\/v1\/sim\/sessions\/\$\{[^`]*?\}\/perturbations)`/;

/**
 * 定位一个**必须唯一**的事实：命中 0 处 = 事实没了；命中 ≥2 处 = **我锚错了东西**。
 * ⚠ 不许放宽成「≥1 处取第一个」—— 那样第二个入口长出来时本门一声不吭，
 *   而「①的绿到底来自哪次调用」就再也说不清（⑤ 的全部价值正在这一句上）。
 */
function locateFe(code: CodeTree, probe: string | RegExp, what: string): string {
  const homes = factHits(code, probe);
  if (homes.length !== 1)
    throw new Error(`[sim-act-close] ${what} 全树命中 ${homes.length} 处（${homes.join("、")}）—— 形状变了，先修定位器再谈结论`);
  return homes[0]!;
}

/** 取树里某个文件**剥注释后**的可执行代码 —— 注释里抄一遍调用不算「代码里有」。 */
function codeOf(code: CodeTree, file: string): string {
  const hit = code.find(([f]) => f === file);
  if (hit === undefined) throw new Error(`[sim-act-close] 树里没有 ${file} —— 扫描面塌了，结论作废`);
  return hit[1];
}

/**
 * 逐字符扫一段以 `open` 处 `(`/`{`/`[` 开头的分组，返回它的**一级**逗号分段（原文片段）。
 * 串与模板串整段跳过（内部逗号不参与分段），嵌套分组的内容不参与分段。
 *
 * ⚠ 诚实边界（已知、不假装没有）：模板串 `${…}` 内部的**字符串里**若含裸 `}`，会提前收尾。
 * 本仓当前无此写法；正则字面量同样不单独识别（与 `factlock.stripComments` 的边界一致）。
 */
function topLevelSegments(src: string, open: number): string[] {
  const OPENERS = "({[";
  if (!OPENERS.includes(src[open] ?? ""))
    throw new Error(`[sim-act-close] 分段起点不是括号：${JSON.stringify(src.slice(open, open + 40))}`);
  const segs: string[] = [];
  let seg = "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      // 串/模板串：原样收进本段，但把内部逗号换成替身，免得它把一段劈成两段。
      let j = i + 1;
      let tpl = 0; // 模板串插值 `${…}` 的嵌套深度（含插值里的对象字面量花括号）
      while (j < src.length) {
        const d = src[j]!;
        if (d === "\\") { j += 2; continue; }
        if (c === "`" && d === "$" && src[j + 1] === "{") { tpl += 1; j += 2; continue; }
        if (c === "`" && tpl > 0 && d === "{") { tpl += 1; j += 1; continue; }
        if (c === "`" && tpl > 0 && d === "}") { tpl -= 1; j += 1; continue; }
        if (d === c && tpl === 0) { j += 1; break; }
        j += 1;
      }
      if (depth === 1) seg += src.slice(i, j).replace(/,/g, "");
      i = j - 1;
      continue;
    }
    if (OPENERS.includes(c)) {
      depth += 1;
      if (depth > 1) seg += c;
      continue;
    }
    if (")}]".includes(c)) {
      depth -= 1;
      if (depth === 0) { segs.push(seg); return segs; }
      seg += c;
      continue;
    }
    if (c === "," && depth === 1) { segs.push(seg); seg = ""; continue; }
    if (depth === 1) seg += c;
  }
  throw new Error(`[sim-act-close] 分组没有闭合（起点 ${open}）—— 抽取器坏了，不许据此报「前端没接线」`);
}

/** 一级键 = `key:` / `"key":` / ES 简写 `key`。认不出来的分段**抛错**，绝不静默漏掉。 */
const KEY_RE = /^\s*(?:["']([A-Za-z_$][\w$]*)["']|([A-Za-z_$][\w$]*))\s*(?::|$)/;

/**
 * 抽出 `src` 中位于 `callAt` 的那次 `createSimPerturbation(…, { … })` 调用真正传的 body 一级键。
 *
 * ⚠ **这个抽取器骗过我两次，两次原样记在这里**（铁律 0.6：第 1 次修+记账，第 2 次建机制）：
 *
 * · **第 1 次**：初版正则只认 `^ {8}key:`，而 `magnitude,` / `durationTicks,` 是 **ES 简写属性**
 *   （无冒号）⇒ 抽出 5 个键、漏掉 2 个，那 5 个还看着完全合理。形态：
 *   「我用 `key:` 的命中数当作『body 有哪些字段』的证据，而前者并不度量后者。」
 *
 * · **第 2 次（2026-08-22 · 本次红）**：定位器写死字面串 `createSimPerturbation(sessionId, {`，
 *   而 2026-08-21 `WO-SIM-FE-HOME`（`6ff9d823`）给沙盘首页控制台加了**第二个合法入口**
 *   （`console/PerturbTree.tsx` 的「添加扰动」上下文菜单）⇒ 命中从 1 变 2 ⇒ ①⑤ 双红。
 *   更难看的是同一个探针**锚在实参变量名 `sessionId` 上**：`SandboxPlaysPanel.tsx` 那次
 *   同样真实、字段全同的调用因为首参写作 `child.id`，被它**整个看不见**；
 *   而键抽取写死 8 空格缩进，那处 10 空格缩进的调用即使被看见也会抽出 **0 个键**。
 *   形态：「我用『某个字面写法在源码里出现过一次』当作『前端只有这一个扰动入口』的证据。」
 *   —— 这正是 `factlock.ts` 顶注那句「锚在**事实**上，不锚在**位置**上」的反面。
 *
 * **机制（机器先说话，不靠人想起来）**：本抽取器现在
 *   ① 只认「在调用」这件事，不认实参名、不认缩进、不认收尾写法（`topLevelSegments` 真扫括号）；
 *   ② 认不出的分段**抛错**而不是跳过（上面第 1 次那种「静默少几个键」再也发生不了）；
 *   ③ ① 里对**全树入口做普查**并逐个打真后端 —— 再长出第四个入口时，红的信息里
 *      直接带着「它是谁、它传什么」，而不是一句没用的「命中 N 处」。
 */
function perturbationCallKeys(src: string, callAt: number): string[] {
  const paren = src.indexOf("(", callAt);
  if (paren < 0) return [];
  const args = topLevelSegments(src, paren);
  const body = args[1];
  if (body === undefined) return [];
  const brace = body.indexOf("{");
  if (brace < 0) return []; // 第二个实参不是对象字面量（例如整个 body 是个变量）⇒ 抽不到形状
  return topLevelSegments(body, brace).flatMap((seg) => {
    if (seg.trim() === "") return []; // 尾逗号后的空白段
    const m = KEY_RE.exec(seg);
    if (m === null)
      throw new Error(
        `[sim-act-close] body 里有本抽取器不认识的写法（展开/计算属性？）：${JSON.stringify(seg.trim().slice(0, 60))}` +
          " —— 先教会抽取器，不许静默漏掉一个字段（那正是它第一次骗人的形态）",
      );
    return [(m[1] ?? m[2])!];
  });
}

/**
 * 「施加扰动」按钮的处理器体内那次 POST 真正传的 body 一级键。
 * 链路三段（按钮 → 处理器 → POST）缺任何一段 ⇒ 返回 `[]` ⇒ ①⑤ 当场红。
 * ⑤ 拿它做**双向**反证：假源码必空、真源码必中 —— 空数组不是兜底，是"这段源码里真没有"。
 */
function frontendPerturbationBodyKeys(src: string): string[] {
  const h = src.indexOf(APPLY_HANDLER);
  if (h < 0) return [];
  const rel = src.slice(h).search(PERTURB_CALL);
  return rel < 0 ? [] : perturbationCallKeys(src, h + rel);
}

/** 前端今天**所有**扰动 POST 入口的普查（封装定义本身不算 —— 那是定义不是调用）。 */
function perturbationCallSites(code: CodeTree): { file: string; keys: string[] }[] {
  const out: { file: string; keys: string[] }[] = [];
  for (const [file, s] of code) {
    const re = new RegExp(PERTURB_CALL.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push({ file, keys: perturbationCallKeys(s, m.index) });
  }
  return out;
}

/** 形状指纹：入口**搬家不红**（不锚文件名），**改形状/多一个/少一个必红**。 */
const shapeOf = (keys: string[]): string => [...keys].sort().join("+");

// ── 世界种子：TypeA --FEEDS--> TypeB，一条已发布传导规则（coefficient 2·零延迟）────────
// 行业无关（TypeA/TypeB/FEEDS 是结构名不是业务名），KPI 取**下游** TypeB 的 load ——
// 取上游就成了"我写进去多少就读出多少"，那证明不了传导。
const ORG = { type: "SYNTHETIC" as const, jobId: "wo-sim-act-close" };
const TENANT = "demo";

const enableSim = (t: TestApp, tenant = TENANT) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

async function seedWorld(t: TestApp, opts: { delayTicks?: number } = {}): Promise<void> {
  for (const k of ["TypeA", "TypeB"]) {
    await t.repos.ontologyTypes.put({
      id: `otype_${k}`, tenantId: TENANT, key: k, displayName: k,
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
  }
  await t.repos.objects.put({ id: "o_up", tenantId: TENANT, type: "TypeA", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "o_down", tenantId: TENANT, type: "TypeB", props: {}, origin: ORG });
  await t.repos.links.put({ id: "lnk", tenantId: TENANT, type: "FEEDS", fromId: "o_up", toId: "o_down", origin: ORG });
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
    payload: {
      key: "r_feeds", sourceTypeKey: "TypeA", sourceStateVar: "load", viaLinkKey: "FEEDS",
      targetTypeKey: "TypeB", targetStateVar: "load", coefficient: 2, delayTicks: opts.delayTicks ?? 0,
      status: "PUBLISHED",
    },
  });
  expect(r.statusCode, "种传导规则失败——后面的断言全部无意义").toBe(201);
}

const BASE = { o_up: { load: 10 }, o_down: { load: 0 } };
const newSession = async (t: TestApp, baseSnapshot: unknown = BASE): Promise<string> =>
  (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } })).json().id as string;

/** 下游 KPI（= 用户在屏上看的那个数的来源）。 */
const downstream = (state: Record<string, Record<string, number>>): number => state.o_down?.load ?? 0;

describe("WO-SIM-ACT-CLOSE · 扰动闭环接缝（前端入口 → 传导 → KPI 真的变）", () => {
  // ══ ① 接缝驱动主用例 ═══════════════════════════════════════════════════════════
  it("① 用**前端源码里真实的那个请求**打后端 → 下游 KPI 真的变；不施加扰动的对照组不变", async () => {
    // ── 抽取 + 金丝雀 ───────────────────────────────────────────────────────────
    // 事实锚（WO-C 修法）：调用**住在哪个文件**不是事实 —— 全树定位（搬家不红；真断线才红）。
    const fe = checkedTree(FE_TREE, 'data-testid="sandbox-tick-btn"', 100);
    const view = readRepo(locateFe(PERTURB_CALL, "「施加扰动」调用宿主"));
    const endpoints = readRepo(locateFe(EP_RE, "createSimPerturbation 端点封装宿主"));
    expect(view.length, "定位到的调用宿主读到空内容 ⇒ 定位器坏了，不许据此报「前端没接线」").toBeGreaterThan(1000);
    // 金丝雀：已知必中的锚点（沙盘推进封装与本单无关，一定还在）。
    expect(factHits(fe, "export const simTick"), "金丝雀不中 ⇒ 扫描器坏了，不许据此报「前端没接线」").not.toEqual([]);

    // 前端真的有那个按钮，且它真的调施加口（不是只 import 不调 —— 那是"排练"不是"实现"）。
    expect(factHits(fe, 'data-testid="sandbox-perturbation-apply-btn"'), "沙盘没有「施加扰动」按钮 ⇒ 用户仍然做不出任何动作（#150 复发）").not.toEqual([]);
    // （调用宿主已由 locateFe 钉死唯一，view 即其原文。）
    // 落点必须来自**真物化对象 id**：写到 `Type#0` 这种占位键上，屏上会变而下游一动不动。
    expect(factHits(fe, "cfg?.nodeObjectIds?.[t]"), "扰动落点候选不是从 nodeObjectIds（真物化 id）来的 ⇒ 传导取不到源态").not.toEqual([]);

    // 前端封装映射到哪个后端端点（端点改了这里就抽不到 ⇒ 红）。
    const epMatch = endpoints.match(EP_RE);
    expect(epMatch, "抽不到 createSimPerturbation 的 URL 模板——前端改了端点或封装被删").not.toBeNull();

    // 前端真传的 body 字段名（改名/漏传 ⇒ 下面构造的 payload 跟着变形 ⇒ 后端行为变 ⇒ 红）。
    const keys = frontendPerturbationBodyKeys(view);
    expect(keys.length, "抽不到前端 body 字段——抽取器坏了或调用形状变了").toBeGreaterThan(0);
    expect([...keys].sort()).toEqual(
      ["durationTicks", "kind", "label", "magnitude", "mode", "targetObjectId", "targetStateVar"].sort(),
    );

    // ── 真跑：对照组（不施加扰动）───────────────────────────────────────────────
    const tc = await makeApp();
    await enableSim(tc);
    await seedWorld(tc);
    const sidControl = await newSession(tc);
    const controlTick = await tc.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidControl}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(controlTick.statusCode).toBe(200);
    const kpiControl = downstream(controlTick.json().state);
    // 前置事实：这个世界本来就会传导（coefficient 2 × 上游 10）。否则下面"变了"证明不了任何事。
    expect(kpiControl, "对照组本身就不传导 ⇒ 主用例测了个寂寞").toBe(20);

    // ── 真跑：实验组（走前端那条路施加扰动，再推一格）─────────────────────────────
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);

    // ⚠ payload 的**键**逐个来自上面从前端源码抽出来的 `keys`，不是这里手抄一份。
    const fixture: Record<string, unknown> = {
      kind: "capacity_loss",
      targetObjectId: "o_up",
      targetStateVar: "load",
      magnitude: 10,
      mode: "delta",
      durationTicks: null,
      label: "SEAM · 上游 load +10",
    };
    for (const k of keys) expect(fixture, `前端新增了 body 字段 ${k}，本门未覆盖——补 fixture 再跑`).toHaveProperty(k);
    const payload = Object.fromEntries(keys.map((k) => [k, fixture[k]]));

    const applied = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload,
    });
    expect(applied.statusCode, `施加口拒收前端真传的 payload：${applied.body}`).toBe(201);
    // ③ 回包的 state 就是前端就地落屏的那份 ⇒ **KPI 当场变**（不等 tick）。上游 10 → 20。
    expect(applied.json().state.o_up.load, "扰动没落到当前 tick 的世界态上 ⇒ 屏上不会变").toBe(20);

    // ④ 再推一格：扰动沿本体链路扩散到下游 ⇒ 下游 KPI 与对照组**不同**。
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    const kpiPerturbed = downstream(tick.json().state);
    expect(kpiPerturbed, "扰动没进传导 ⇒ 下游 KPI 与不施加时一样 = 闭环没闭合").not.toBe(kpiControl);
    expect(kpiPerturbed, "coefficient 2 × 被扰动到 20 的上游 = 40").toBe(40);
    // 溯源（R13）：这一格是哪几次扰动造成的，回包里说得出来。
    expect(tick.json().appliedPerturbations).toEqual([applied.json().perturbation.id]);
  });

  // ══ ② 限时扰动到期真回退（"停机 72h" 不许悄悄变成永久停机）══════════════════════
  it("② durationTicks 到期 → 上游自动回退，下游 KPI 跟着回到对照值（不是永久生效）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: {
        kind: "capacity_loss", targetObjectId: "o_up", targetStateVar: "load",
        magnitude: 10, mode: "delta", durationTicks: 1, label: "SEAM · 只持续 1 tick",
      },
    });
    // tick#1：扰动仍在生效期（producedTick=1 时已到期，引擎当格回退）——逐格断言，不含糊。
    const tick1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick1.json().state.o_up.load, "到期未回退 ⇒ 限时扰动悄悄变成永久").toBe(10);
    expect(downstream(tick1.json().state), "回退后下游应回到对照值 2×10").toBe(20);
    expect(tick1.json().appliedPerturbations, "已到期的扰动不该再算作「仍在起作用」").toEqual([]);
  });

  // ══ ③ #151 回归 —— 施加扰动不许清空在途延迟队列 ════════════════════════════════
  // （`sim-perturbation.test.ts` 断言② 已咬 `/act` 那条路；这里咬**前端真走的那条路**，
  //   两条路各有各的门 —— 修好的东西必须两处都不许退化。）
  it("③（#151）前端走的 /perturbations 路同样不清空 pending：tick → 施加 → tick，在途贡献如期到达", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t, { delayTicks: 1 }); // 与生产种子 demo_line_util_to_base_load 同形
    const sid = await newSession(t);

    const tick1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(downstream(tick1.json().state), "delayTicks=1 ⇒ 本格还没到").toBe(0);
    const st1 = await t.repos.sim.getTickState(TENANT, sid, 1);
    expect(st1?.pending, "前置事实：pending 真的非空，否则本断言测了个寂寞").toHaveLength(1);

    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: {
        kind: "supply_disruption", targetObjectId: "o_up", targetStateVar: "load",
        magnitude: 0, mode: "set", durationTicks: null, label: "SEAM · 掐掉来料",
      },
    });
    const st1After = await t.repos.sim.getTickState(TENANT, sid, 1);
    expect(st1After?.pending, "🔴 #151：施加扰动把在途队列抹了 ⇒ 已发出的量凭空蒸发").toHaveLength(1);

    // 在途那份如期到达（20），而被掐掉的来料不再产生新贡献。
    const tick2 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(downstream(tick2.json().state), "在途贡献没到 ⇒ pending 在施加时被吞了").toBe(20);
  });

  // ══ ④ #152 —— Trial Tick 必须真的跑传导 ═════════════════════════════════════════
  it("④（#152）就绪认证的 Trial Tick 真跑传导相：驱动得动的世界 fired>0，且 rulesFired = 两相之和", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);

    const cert = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification`, headers: ADMIN });
    expect(cert.statusCode).toBe(200);
    const trial = cert.json().trialTick as {
      passed: boolean; rulesFired: number;
      derivationRulesFired?: number; propagationRulesFired?: number; propagationRulesDeclared?: number;
    };
    expect(trial.passed).toBe(true);
    // 修前：这三个字段根本不存在，`rulesFired` 恒 = 派生 topo 长度，传导一条都没跑过。
    expect(trial.propagationRulesDeclared, "本租户已发布 1 条传导规则").toBe(1);
    expect(
      trial.propagationRulesFired,
      "🔴 #152：Trial Tick 只跑了 recompute（派生），传导相恒记 0 —— 认证在拿派生的成绩单冒充推演的",
    ).toBe(1);
    expect(trial.rulesFired, "rulesFired 必须是两相之和（拆账字段与总数对得上）")
      .toBe((trial.derivationRulesFired ?? 0) + (trial.propagationRulesFired ?? 0));
  });

  it("④补（诚实位）：世界态驱动不动传导时 declared>0 而 fired===0 —— 不许拿「声明了几条」冒充「跑通了几条」", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    // 上游态为 0 ⇒ 无源即无贡献 ⇒ 规则一条都不 fire（引擎 `sourceVal === 0` 直接 continue）。
    const sid = await newSession(t, { o_up: { load: 0 }, o_down: { load: 0 } });

    const trial = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification`, headers: ADMIN }))
      .json().trialTick as { propagationRulesFired?: number; propagationRulesDeclared?: number };
    expect(trial.propagationRulesDeclared, "规则确实声明了").toBe(1);
    expect(trial.propagationRulesFired, "空世界里传导跑不动，认证必须照实说 0").toBe(0);
  });

  // ══ ⑤ 反证：拿掉前端那次调用，本门必须红（证明它咬的是链路不是自己）═══════════════
  // 变异反证只能靠"改源码再跑"来做，这里退而求其次：断言抽取器**确实依赖前端源码**
  // —— 喂一段不含该调用的假源码，抽取结果必须为空（而不是靠某个恒真的兜底混过去）。
  it("⑤ 反证：抽取器喂假源码 → 抽不到任何字段（证明①的绿来自前端真源码，不是恒真兜底）", () => {
    expect(frontendPerturbationBodyKeys("export default function X(){ return null }")).toEqual([]);
    // 而喂真源码时必须抽得到（同一函数，两个方向都验过才叫工具是对的）。
    expect(frontendPerturbationBodyKeys(readRepo(locateFe(PERTURB_CALL, "「施加扰动」调用宿主"))).length).toBeGreaterThan(0);
  });
});
