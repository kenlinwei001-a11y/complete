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
      seg += src.slice(i, j).replace(/,/g, " ");
      i = j - 1;
      continue;
    }
    if (OPENERS.includes(c)) {
      depth += 1;
      if (depth > 1) seg += c; // 起始那一个括号本身不进段
      continue;
    }
    if (")}]".includes(c)) {
      depth -= 1;
      if (depth === 0) { segs.push(seg); return segs; }
      seg += c;
      continue;
    }
    // ⚠ 切分只在**一级**逗号上发生，但**所有**深度的字符都得留在段里。
    //   初版写成 `if (depth === 1) seg += c` ⇒ 嵌套花括号里的内容被整个丢掉，
    //   第二个实参抽出来成了空对象、键数恒 0（本次实测当场红在 ① 的 `keys.length`）。
    if (c === "," && depth === 1) { segs.push(seg); seg = ""; continue; }
    seg += c;
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
function perturbationCallKeys(
  src: string,
  callAt: number,
  /** 全树 + 本文件路径：第二实参是变量时要跨文件追它的构造处。缺省 = 不追（金丝雀用）。 */
  resolve?: { code: CodeTree; file: string },
): string[] {
  const paren = src.indexOf("(", callAt);
  if (paren < 0) return [];
  const args = topLevelSegments(src, paren);
  const body = args[1];
  if (body === undefined) return [];
  const brace = body.indexOf("{");
  if (brace < 0) {
    // ⚠️ 第二个实参不是对象字面量（例如 `createSimPerturbation(id, built.body)`）。
    //    **旧版在这里 `return []`，那是第 3 次犯同一个病**：本函数顶注自己写着
    //    「认不出的分段**抛错**而不是跳过」，而这一支恰恰是静默跳过 —— 于是
    //    `rail/PerturbRail.tsx` 这个真入口被记成 `keys: []`，普查断言看到一个空形状指纹，
    //    报「入口清单变了」却说不出它传什么。**「我抽不到」和「它没传」是两个命题。**
    //    现在：追一层到 body 的构造处；追不到就**抛错**，绝不返回空。
    const ident = body.trim().replace(/[;,]+$/, "");
    const last = ident.split(".").pop() ?? ident;
    if (resolve && /^[A-Za-z_$][\w$]*$/.test(last)) {
      const dir = resolve.file.slice(0, resolve.file.lastIndexOf("/") + 1);
      for (const [f, text] of resolve.code) {
        // 只在**同目录**里追（跨目录再追就成了全仓乱猜，命中一个同名 `body:` 会得出假形状）。
        if (!f.startsWith(dir)) continue;
        const at = text.search(new RegExp(String.raw`\b${last}\s*:\s*\{`));
        if (at < 0) continue;
        const bOpen = text.indexOf("{", at);
        return topLevelSegments(text, bOpen).flatMap((seg) => {
          if (seg.trim() === "") return [];
          const m = KEY_RE.exec(seg);
          if (m === null) return [];
          return [(m[1] ?? m[2])!];
        });
      }
    }
    throw new Error(
      `[sim-act-close] 第二实参是变量 ${JSON.stringify(ident.slice(0, 40))} 且在同目录里追不到它的构造处` +
        " —— 先教会抽取器，不许静默记成空形状（那会让普查断言报「入口清单变了」却说不出它传什么）",
    );
  }
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
    while ((m = re.exec(s)) !== null) out.push({ file, keys: perturbationCallKeys(s, m.index, { code, file }) });
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
    // 唯一事实锚 = 用户真按的那个按钮。**不再**拿 `createSimPerturbation(sessionId, {` 当锚：
    // 那是锚在实参变量名上，而前端合法地长出了第二、第三个扰动入口（顶注病历第 2 次）。
    const btnHost = locateFe(fe, APPLY_BTN, "「施加扰动」按钮宿主");
    const view = codeOf(fe, btnHost);
    const endpoints = codeOf(fe, locateFe(fe, EP_RE, "createSimPerturbation 端点封装宿主"));
    expect(view.length, "定位到的调用宿主读到空内容 ⇒ 定位器坏了，不许据此报「前端没接线」").toBeGreaterThan(1000);
    // 金丝雀：已知必中的锚点（沙盘推进封装与本单无关，一定还在）。
    expect(factHits(fe, "export const simTick"), "金丝雀不中 ⇒ 扫描器坏了，不许据此报「前端没接线」").not.toEqual([]);

    // 链路三段必须在同一宿主里合拢：按钮 → 处理器 → POST。
    // 缺任何一段都不是"搬家"，是真断线 —— 尤其「只定义不调用 = 排练不是实现」（铁律 0.5 判据 2）。
    expect(factHits(fe, APPLY_HANDLER), `「施加扰动」处理器 ${APPLY_HANDLER} 不在按钮宿主 ${btnHost} 里 ⇒ 链路断了`).toEqual([btnHost]);
    expect(
      view.split(APPLY_HANDLER).length - 1,
      `${APPLY_HANDLER} 在源码里只出现 1 次 = 只定义没接到 onClick ⇒ 用户按不出任何动作（#150 复发）`,
    ).toBeGreaterThan(1);
    expect(PERTURB_CALL.test(view), "按钮宿主里没有 createSimPerturbation 调用 ⇒ 按钮是假入口").toBe(true);
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

    // ── 入口普查：前端今天到底有几个扰动 POST 入口、各传什么 ─────────────────────
    // 这是 2026-08-22 那次红的直接对策：入口从 1 个长到 3 个，而旧定位器只会说
    // 「命中 2 处」——它连"第三个入口存在"都不知道（首参写 `child.id` 就看不见了）。
    // 钉的是**形状指纹**不是文件名 ⇒ 搬家不红；多一个/少一个/改形状必红，且红里带着它是谁。
    const sites = perturbationCallSites(fe);
    expect(
      sites.map((s) => shapeOf(s.keys)).sort(),
      `前端扰动 POST 入口清单变了，现为：${sites.map((s) => `${s.file}(${s.keys.join(",")})`).join("；")}` +
        " —— 新增入口先确认后端真收（本用例下面会逐个打真后端），再更新本断言；不许改成 ≥1 处糊过去",
    ).toEqual(
      [
        // 沙盘「施加扰动」表单（本用例复刻的那一个）
        shapeOf(["kind", "targetObjectId", "targetStateVar", "magnitude", "mode", "durationTicks", "label"]),
        // 方案环：每个方案分叉一个平行世界后施加同族扰动（字段全同，首参是 branch id）
        shapeOf(["kind", "targetObjectId", "targetStateVar", "magnitude", "mode", "durationTicks", "label"]),
        // 控制台首页左栏「扰动因素」树的「添加扰动」菜单（不传 mode/durationTicks，吃后端默认）
        shapeOf(["kind", "targetObjectId", "targetStateVar", "magnitude", "label"]),
        // 统一控制台左栏扰动导轨 `unified/rail/PerturbRail.tsx`（2026-08-26 新增的第 4 个入口）。
        // 它比前三个多一个 `startTick`（"从第几格起生效"）—— 这不是形状漂移，是真新增字段，
        // 下面的入口普查会拿它逐字打真后端（201 + 世界态真的变），不是在这里写一行了事。
        // ⚠ 它的 body 构造在同目录的 `perturbRailModel.ts` 里、调用处传的是 `built.body`，
        //   抽取器为此新增了「第二实参是变量 ⇒ 同目录追一层」的解析（追不到就抛错，不返回空）。
        shapeOf(["kind", "targetObjectId", "targetStateVar", "magnitude", "label", "startTick", "durationTicks", "mode"]),
      ].sort(),
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

    // ── 其余入口同样要打得通 ────────────────────────────────────────────────────
    // 上面复刻的是「施加扰动」表单那一个。控制台首页那个入口**少传 mode/durationTicks**，
    // 靠的是后端默认值 —— 而"后端默认值还在不在"这件事，只有真打一次才知道。
    // 只测一个入口 = 另外两个入口的 payload 后端收不收，本门一个字都说不出来。
    // ⚠ 复刻时**换一个幅度**（7 而不是底值 10）：控制台入口不传 `mode`、吃后端默认 `set`，
    //   而 `set 10` 打在底值 10 上「落点没变」与「payload 被整个吞掉」在回包里长得一模一样
    //   —— 那恰恰是本段最该分辨的两件事。7 在 set/delta/scale 三种模式下都 ≠ 10。
    // `startTick: 0` = 立即生效（导轨入口独有的字段）。给 0 不给正数是有意的：
    // 给正数则本 tick 内不生效，下面那句「收下了却没落到世界态」会被**正确的延迟行为**顶红，
    // 而红的原因与它要咬的「payload 被吞掉」完全无关 —— 那就成了一条会骗人的断言。
    const replay: Record<string, unknown> = { ...fixture, magnitude: 7, label: "SEAM · 入口普查", startTick: 0 };
    for (const s of [...new Map(sites.map((x) => [shapeOf(x.keys), x])).values()]) {
      for (const k of s.keys) expect(replay, `前端入口 ${s.file} 新增了 body 字段 ${k}，本门未覆盖——补 fixture 再跑`).toHaveProperty(k);
      const sidX = await newSession(t);
      const rx = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sidX}/perturbations`, headers: ADMIN,
        payload: Object.fromEntries(s.keys.map((k) => [k, replay[k]])),
      });
      expect(rx.statusCode, `前端入口 ${s.file} 真传的 payload 被施加口拒收：${rx.body}`).toBe(201);
      // 收下 201 却什么都没改 = "接了线没生效"，比拒收更难发现，所以这一句必须单独咬。
      expect(rx.json().state.o_up.load, `前端入口 ${s.file} 的 payload 收下了却没落到世界态`).not.toBe(10);
    }
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
  //
  // 链路是三段（按钮宿主 → 处理器 → POST），所以反证也按三段各断一次：
  // 只断"整段假源码抽不到"太弱 —— 那只证明抽取器认得出一段完全无关的文本。
  it("⑤ 反证：抽取器喂假源码 → 抽不到任何字段（证明①的绿来自前端真源码，不是恒真兜底）", () => {
    // ⑤a 既无处理器也无调用 ⇒ 空。
    expect(frontendPerturbationBodyKeys("export default function X(){ return null }")).toEqual([]);
    // ⑤b **有处理器、没那次 POST** ⇒ 空。这一条咬的是"处理器名还在，但里面不发请求了"——
    //     旧版只锚调用串，这种退化它一个字都说不出来。
    expect(
      frontendPerturbationBodyKeys(`const ${APPLY_HANDLER} = useCallback(async () => { toast("施加扰动"); }, []);`),
      "处理器还在但已不发 POST，抽取器却仍抽出字段 ⇒ 它在凭空造证据",
    ).toEqual([]);
    // ⑤c **有那次 POST、没处理器** ⇒ 空。别的入口（方案环 / 控制台树）也在调同一个封装，
    //     若少了这一条，①就可能抽到**别的入口**的形状而自以为抽到了「施加扰动」表单的。
    expect(
      frontendPerturbationBodyKeys(`void createSimPerturbation(x.id, { kind: "k", label: "l" });`),
      "不是「施加扰动」处理器里的那次调用，也被当成了它 ⇒ ①的绿说不清来自哪个入口",
    ).toEqual([]);
    // ⑤d 而喂真源码时必须抽得到（同一函数，四个方向都验过才叫工具是对的）。
    const fe = checkedTree(FE_TREE, 'data-testid="sandbox-tick-btn"', 100);
    expect(
      frontendPerturbationBodyKeys(codeOf(fe, locateFe(fe, APPLY_BTN, "「施加扰动」按钮宿主"))).length,
      "前端真源码里抽不到「施加扰动」的 body 字段 ⇒ 按钮还在但处理器已不发 POST（#150 复发），" +
        "或抽取器坏了 —— 两者都不许当成「本门通过」",
    ).toBeGreaterThan(0);
  });
});
