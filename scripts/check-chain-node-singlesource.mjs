#!/usr/bin/env node
/**
 * 门：全链节点 ID 单源（`CHAIN_NODE_REGISTRY`）· **数据半 + 引擎半 + 前端**三侧同扫。
 *
 * ⛔ 存在理由 = 一次真实事故（不是预防性洁癖）：
 *   S0 首版把 `ChainStepSchema.nodeId` / `ChainNodeSchema.nodeId` 冻成 `z.string().min(1)` 自由串，
 *   **没有注册表**。于是 D1（数据半·节拍）与 E1（引擎半·损失归因）两个 dev 各自发明了一套词表——
 *     · D1：`sop_consensus` / `order_review` / `master_schedule` / `mrp_run` / `settlement` …
 *     · E1：`demand.consensus` / `order.cash` / `material.replenish` / `capacity.aging` …
 *   **交集为 0**。两边单测各自全绿，链路却整条断开：D1 推出来的节拍，没有任何消费方能按 id 找到。
 *   这是「绿测试 ≠ 能用 · 断在接缝」的教科书形态。本门就是防它复发。
 *
 * ── 2026-08-06 · 欠账 #110：把门扩到前端 ──────────────────────────────────
 * 首版只扫 datacore 两个文件，**不扫前端**——而前端同样消费 `CHAIN_NODE_REGISTRY`
 * （`views/sim/InspectorNodePanel.tsx` 的节点清单）。「节点 ID 单源」这个名字承诺的范围，
 * 比它实际覆盖的范围大：前端手抄一份词表，门完全看不见。**门名承诺 > 门实覆盖** 本身
 * 就是本仓在治的那类假绿，故本次把 `apps/frontend-shell/src/**` 整个纳入扫描面。
 *
 * ── 四条判据（互补，各抓一种不同的错法；混为一谈会漏）──────────────────
 *   K 键位   `nodeId:`/`cadenceNodeId:` 属性值、以及 `x.nodeId === "…"` 比较值，必须在册。
 *            ← 抓**任何方言**，含无点号的旧 D1 词表（`sop_consensus` 这种 N 抓不到）。
 *   N 命名空间  **任何**形如 `<stage 小写>.<名>` 的字符串字面量都必须在册（或属 `capacity.op.`）。
 *            ← 抓 K 看不见的形状：数组字面量 `["demand.x", …]`、Record 键 `{ "order.y": … }`、
 *              switch case。**手抄词表恰恰长这样，键名根本不叫 nodeId** —— 只有 K 等于没扩。
 *   C 抄表   单个前端 src 文件里**materialize ≥ COPY_THRESHOLD 个在册 nodeId 字面量** ⇒ 判为
 *            第二份注册表。← 抓「id 全对但仍是手抄」：K/N 只查合法性，**合法的抄写照样是抄写**，
 *              而工单要治的正是「前端手抄的词表」。前端只渲染、不产出新信息，列表必然是副本。
 *   L 抄标签 单个前端 src 文件里出现 ≥ COPY_THRESHOLD 个在册 `label` 字面量 ⇒ 中文映射表副本。
 *            ← 契约 §2.5 白纸黑字：「`label` —— 人读名（前端**不另维护中文映射表**，一律取这里）」。
 *
 *   C/L 只对前端生效：`synthetic/cadence.ts` 的 `CADENCE_NODES` 是**数据侧的原创声明**
 *   （哪些节点有节拍、周期多长 = 新信息，且 cadence.ts:400 运行时对注册表验真），不是副本。
 *
 * ── C 的**按机制豁免**：编译期就绑死在契约上的键，不是第二份注册表 ──────────
 *   `WO-SEMANTICS-SINGLESOURCE`：`views/sim/chainNodeSemantics.ts` 被 C 判红，而它长这样——
 *     ```ts
 *     import { type ChainNodeDef } from "@platform/contracts";
 *     type RegisteredChainNodeId = ChainNodeDef["nodeId"];          // 派生自 CHAIN_NODE_REGISTRY
 *     const T: Partial<Record<RegisteredChainNodeId, Sem>> = { "…": {…}, … };
 *     ```
 *   C 的立论是「改册时这里不会跟着变」。**对这种写法，该立论是假的**：键类型是注册表 `as const`
 *   派生出来的字面量联合，写一个不在册的键 / 册里改掉一个 id ⇒ `tsc` 当场 **TS2353**
 *   （实测原文见 `docs/PRD-semantics-singlesource.md` §4）。这比门明文豁免的 `cadence.ts:400`
 *   （**运行时**对注册表验真）还强一档：运行时验真要跑到才红，编译期包含关系连构建都过不去。
 *   ⇒ 判据 C **跳过**「处于**键位**、且该对象字面量的**声明类型**的键类型锚在契约上」的字面量。
 *
 *   ⚠ 这是「按机制豁免」，不是「按文件豁免」——豁免名单一开口，将来的真问题会跟着被放过。
 *      故豁免必须**反伪造**，六条口子逐条堵死（①②③ 是 `tsc --strict` 下亲手跑出来的，不是推理）：
 *      ① `type RegisteredChainNodeId = string`（本地伪造一个同名别名白嫖）⇒ 键类型解析不到
 *         `@platform/contracts` 的导入名 ⇒ **不豁免**。豁免的是「锚在契约上」，不是「名字长得像」。
 *      ② `Record<Id | string, …>`（掺一个 `string` 把联合泡宽）⇒ 实测 `tsc` **不再报错**
 *         （编译期包含关系当场失效）⇒ 键类型里出现 `string`/`any` 一律**不豁免**。
 *      ③ `{…} as Partial<Record<Id, …>>`（强制断言）⇒ 实测 `tsc` **不报错**，`as` 会把不在册的键
 *         静默洗白 ⇒ 只认 `const X: T = {…}` 与 `{…} satisfies T`（后者实测照样报 TS2353），
 *         **`as` 一律不认**。
 *      ④ 只豁免**键位**。同一张锚定表里的**值**（`{ "demand.consensus": ["order.review", …] }`）
 *         照常计入 C —— 值不受键类型约束，那才是真词表。
 *      ⑤ 锚点必须是 `@platform/contracts` **本尊**（contracts-only-shared）。从别的前端文件
 *         re-export 一个 `RegisteredChainNodeId` 再 import 来用 ⇒ **不豁免**（fail-closed）。
 *         这条严得刻意：合法的修法只是多写一行 `import { type ChainNodeDef } from "@platform/contracts"`，
 *         成本近零；而放开跨文件追溯，就等于给伪造者开了一条门看不见的路。
 *      ⑥ 键类型里**每一个**类型引用都必须解析得动（契约导入名，或本文件里能展开的 `type` 别名），
 *         解析不动即**不豁免**。这条是 ② 的补漏，不补就留了个 ② 看不见的洞：
 *         `Record<Rid | Loose, …>` 里 `Loose` 从别处 import 进来、其定义很可能就是 `string`，
 *         而本文件的 AST 里根本不出现 `string` 这个关键字 ⇒ 只查 ② 会把一张已经被泡宽的表
 *         当成锚定的放行。（配了金丝雀，见「门自己不许瞎 ⑤」的第 6 条反例样本。）
 *
 *   **L 判据不受本豁免影响**（刻意）：键绑死了不代表值干净——「中文映射表副本」的形态是
 *   在**值**位抄 `label`，L 照常计数。豁免只回答「键会不会漂」，不回答「值是不是副本」。
 *
 * ── 角色排除：`stepId` 是**另一个命名空间**，不是豁免名单 ────────────────
 *   `stepId` 与 `nodeId` 共用 `<stage>.<名>` 形状，但语义不同。实测两侧都有真实存量：
 *     · `solvers/chain-loss.ts:417` `stepId:"order.settlement_terms"` / `nodeId:"order.cash"`（在册）
 *     · `solvers/chain-loss.ts:494` `stepId:"material.supplier_leadtime"` / `nodeId:"material.replenish"`（在册）
 *     · 另有 `material.in_transit` / `material.customs` / `material.iqc` / `capacity.aging#dwell`
 *   故 N 排除「处于 `stepId` 属性位」的字面量。**这排除的是角色，不是取值**——
 *   写死一张「这几个串允许」的豁免表，会把将来真正写歪的 nodeId 一起放过；排角色不会。
 *
 * ── 诚实边界：本门**抓不到**什么（写清楚，免得门名再一次承诺过头）────────
 *   本单要治的病，恰恰是「门名承诺的范围 > 门实覆盖的范围」。所以已知的洞必须当面列出来，
 *   而不是让下一个人从绿灯里推断「这些都被守住了」：
 *   ① **stepId 自身无单源**：`stepId` 今天没有注册表，本门只把它当作「另一个命名空间」放行，
 *      不校验其取值。要治得先给 stepId 建册 —— 另一笔欠账。
 *   ② **C 判据按单文件计数**：把一份词表拆成「每文件只写 2 个 id」散布到 6 个文件，可绕过
 *      `COPY_THRESHOLD`。不上「全前端聚合计数」是因为它会把「6 个视图各自合法地引用 1 个默认节点」
 *      一起判红 —— 宁可漏掉这种刻意规避，也不制造会被加豁免名单的噪声（豁免名单一旦开口，
 *      将来的真问题会跟着一起被放过）。
 *   ③ **只整串匹配**：散文/文案里提到 id（如 `"节点 demand.consensus 的前置期"`）不算词表，
 *      因此把 id 拼进长字符串可绕过 N。
 *   ④ **只扫 `src/**` 的 ts/tsx**：`test/` 与 `.json` fixture 不在扫描面内。这是**刻意**的——
 *      `test/fixtures/chain-loss-real.json` 是后端真实响应的抓取物，里面的
 *      `order.settlement_terms`/`material.supplier_leadtime` 是 **stepId**；JSON 没有 AST 角色，
 *      扫它必然把这些误报成不在册 nodeId。误报会逼出豁免名单，那就把门蛀空了。
 *   ⑤ **类型锚豁免让出的那一块**（WO-SEMANTICS-SINGLESOURCE 新增，照实写不圆场）：
 *      在一张锚定表里**另造一套中文名**（`Partial<Record<RegisteredChainNodeId, string>>`，
 *      值是**新编的**、不等于在册 `label`）—— 键不会漂（编译期绑死）、值也不是 `label` 副本，
 *      于是 C 与 L 都咬不到。这块**在本豁免之前是被 C 顺手挡住的**，现在让出来了。
 *      不为它加判据的理由：C 数的是 **id**，「值是不是该由前端定义」是另一个问题
 *      （真要治得给「前端可原创字段」建册，另一笔欠账）；而抄在册 `label` 这条主路 L 仍然咬得住。
 *
 * ── 门自己不许瞎（G-GATE-PARSER-TRUNCATED-VIEW 同族）────────────────────
 *  ① 契约解析：正则锚到 `] as const satisfies`；条目数 ≥ MIN_NODES；四个哨兵 id 必在。
 *  ② 阶段前缀 / 工序前缀**从契约现解**（`CHAIN_STAGES` / `CHAIN_OP_NODE_PREFIX`），
 *     门自己绝不手抄一份——否则治手抄的门自己就是手抄。
 *  ③ 扫描面非空：前端文件数 ≥ MIN_FE_FILES，且哨兵文件必须在扫描集里（walker 断了要红，不是「没发现」）。
 *  ④ **词法自检（每次运行都跑）**：拿一段内嵌样本喂给提取器，断言
 *     「注释里的 id 提不出来 / 数组字面量与 Record 键提得出来 / 正则里的引号不会带偏后续扫描」。
 *     ← 直接对治 `check-view-reachable.mjs` 第一版那个病：裸文本匹配、注释掉的行照样算数、
 *       变异后仍绿。本门用 **TypeScript 官方 scanner** 取字面量（注释/正则/JSX 由编译器天然处理），
 *       自检是为了证明它**确实**如此，而不是宣称如此。TS 装不上 ⇒ 红（fail-closed，不静默降级）。
 *  ⑤ **类型锚自检（每次运行都跑）**：新判据也得配金丝雀 —— 豁免逻辑本身是新代码，
 *     「它不红」既可能是「代码干净」也可能是「豁免写瞎了把谁都放过」。故拿 10 段内嵌样本
 *     正反对拍：4 段该豁免（`Partial<Record<…>>` / 裸 `Record<…>` / `satisfies` / 别名链多跳），
 *     6 段**必须不豁免**（本地伪造 `= string` / 掺 `string` 泡宽 / `as` 断言 / 值位 /
 *     非契约模块锚点 / 联合里掺解析不动的外来类型）。正反两侧的条数**从样例表现算**，
 *     不在通过行里手抄 —— 治手抄的门自己手抄一个数是同一种病。
 *     任一条对不上 ⇒ 判「门自己瞎了」而不是「代码干净」。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(ROOT, "packages/contracts/src/chain-sim.ts");

/** 逐文件点名的扫描面（数据半 / 引擎半）。 */
const SCANNED_FILES = [
  join(ROOT, "apps/datacore/src/synthetic/cadence.ts"),
  join(ROOT, "apps/datacore/src/solvers/chain-loss.ts"),
];
/** 整树扫描面（前端）。欠账 #110：门名承诺「全链节点 ID 单源」，就得覆盖所有消费方。 */
const SCANNED_TREES = [join(ROOT, "apps/frontend-shell/src")];

/** 注册表条目数下限。改册时同步上调 —— 「解析出 0 条也算过」正是被截断的门的样子。 */
const MIN_NODES = 12;
/** 必现哨兵：解析结果里少了任何一个 ⇒ 视野被截断，不是「真的没有」。 */
const SENTINELS = ["demand.consensus", "order.settlement", "material.replenish", "capacity.aging"];
/** 前端扫描面文件数下限：walker 挂了/路径改了会掉到 0，那时门会「在空视野里报一致」。 */
const MIN_FE_FILES = 100;
/** 前端哨兵文件（`CHAIN_NODE_REGISTRY` 的已知前端消费方）。不在扫描集 ⇒ 扫描面塌了。 */
const FE_SENTINEL_FILE = "apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx";
/** 「一份词表」的门槛：1 个是引用，2 个可能是一对比较，≥3 个就是在列表了。 */
const COPY_THRESHOLD = 3;
/** `stepId` 属于另一个命名空间（见文件头「角色排除」）。这里排的是**属性名**，不是取值。 */
const STEP_ID_KEYS = new Set(["stepId", "step_id"]);
/** K 判据认的键位。 */
const NODE_ID_KEYS = new Set(["nodeId", "cadenceNodeId"]);
/**
 * C 的类型锚豁免，锚点**只认这一个模块**（contracts-only-shared）。
 * 从别的前端文件 re-export 再 import ⇒ 不认（fail-closed，见文件头反伪造 ⑤）。
 */
const CONTRACTS_MODULE = "@platform/contracts";
/** 键类型解析时可以**透穿**的标准工具类型（只认标准的，自定义包装一律不认）。 */
const TRANSPARENT_TYPE_WRAPPERS = new Set(["Partial", "Readonly", "Required"]);

const errs = [];
const blind = []; // 「门自己瞎了」类，与业务违规分开报——修法完全不同

/* ═══════════════ 0 · 取 TS scanner（fail-closed） ═══════════════ */
let ts;
try {
  ts = (await import("typescript")).default;
} catch (e) {
  console.error(
    "❌ chain-node-singlesource: 载入 typescript 失败 —— 本门用官方 scanner 取字符串字面量" +
      "（注释/正则/JSX 才不会被裸正则带偏）。装不上就红，不静默降级成哑匹配。\n  " +
      String(e && e.message ? e.message : e),
  );
  process.exit(1);
}

/** 键类型里出现这些 ⇒ 联合被泡宽、编译期包含关系失效（实测）⇒ 一律不豁免。 */
const WIDE_TYPE_KINDS = new Set([ts.SyntaxKind.StringKeyword, ts.SyntaxKind.AnyKeyword]);

/* ═══════════════ 1 · 从契约现解单源（门自己不手抄） ═══════════════ */
const src = readFileSync(CONTRACT, "utf8");

// 锚到结尾的 `] as const satisfies`，不用惰性 `]`：数组内部注释/字符串里一旦出现 `]` 就会被截断。
const m = src.match(/export const CHAIN_NODE_REGISTRY = \[([\s\S]*?)\n\] as const satisfies/);
if (!m) {
  console.error("❌ chain-node-singlesource: 解析不到 CHAIN_NODE_REGISTRY（契约被改名/改形状？门先红，不静默放过）");
  process.exit(1);
}
const registry = [...m[1].matchAll(/nodeId:\s*"([^"]+)"/g)].map((x) => x[1]);
const labels = [...m[1].matchAll(/label:\s*"([^"]+)"/g)].map((x) => x[1]);

if (registry.length < MIN_NODES) {
  blind.push(`注册表只解析出 ${registry.length} 条（下限 ${MIN_NODES}）——极可能是正则被截断，门在残缺视野里做判断`);
}
for (const s of SENTINELS) {
  if (!registry.includes(s)) blind.push(`哨兵 ${s} 不在解析结果里 —— 视野被截断（不是「真的没有」）`);
}
if (labels.length !== registry.length) {
  blind.push(`label 解析出 ${labels.length} 条、nodeId ${registry.length} 条，不等长 —— 契约形状变了或正则截断`);
}

// 阶段前缀：从 CHAIN_STAGES 现解，**不在门里手抄一份 demand|order|capacity|material**。
const sm = src.match(/export const CHAIN_STAGES = \[([\s\S]*?)\] as const;/);
if (!sm) {
  console.error("❌ chain-node-singlesource: 解析不到 CHAIN_STAGES（N 判据的命名空间前缀来自它，解析不到即红）");
  process.exit(1);
}
const stages = [...sm[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
if (stages.length < 4 || !stages.includes("DEMAND") || !stages.includes("MATERIAL")) {
  blind.push(`CHAIN_STAGES 只解析出 [${stages.join(",")}] —— 视野被截断，N 判据会在残缺前缀集上放行`);
}

// 工序动态命名空间前缀：同样现解。
const om = src.match(/export const CHAIN_OP_NODE_PREFIX = "([^"]+)"/);
if (!om || !om[1].includes(".")) {
  console.error("❌ chain-node-singlesource: 解析不到 CHAIN_OP_NODE_PREFIX（动态工序前缀必须单源，解析不到即红）");
  process.exit(1);
}
const OP_PREFIX = om[1];

const known = new Set(registry);
const knownLabels = new Set(labels);
const stagePrefixes = stages.map((s) => s.toLowerCase());
/** N 判据的形状：整串等于 `<stage 小写>.<名>`（**整串匹配**，散文里提到 id 不算词表）。 */
const NODE_SHAPE = new RegExp(`^(?:${stagePrefixes.join("|")})\\.[A-Za-z0-9_][A-Za-z0-9_.#-]*$`);
const isAllowed = (id) => known.has(id) || id.startsWith(OP_PREFIX);

/* ═══════════════ 2 · 字面量提取（TS AST；注释/正则/JSX 由编译器处理） ═══════════════ */
/** 取一个实体名/限定名的**最左**标识符（`C.ChainNodeDef` → `C`；命名空间导入靠这个抓）。 */
function leftmostName(node) {
  let cur = node;
  while (cur !== undefined && (ts.isQualifiedName(cur) || ts.isPropertyAccessExpression(cur))) {
    cur = ts.isQualifiedName(cur) ? cur.left : cur.expression;
  }
  return cur !== undefined && ts.isIdentifier(cur) ? cur.text : "";
}

/**
 * 从一个**声明类型**里剥出「键类型」：
 * `Partial<Record<K,V>>` / `Readonly<Record<K,V>>` / `Record<K,V>` / `{ [P in K]?: V }` → `K`。
 * 别的形状一律返回 `undefined`（不豁免）—— 认不出来就不放行，是 fail-closed 不是漏。
 */
function recordKeyType(typeNode, depth = 0) {
  if (typeNode === undefined || depth > 6) return undefined;
  if (ts.isParenthesizedTypeNode(typeNode)) return recordKeyType(typeNode.type, depth + 1);
  if (ts.isMappedTypeNode(typeNode)) return typeNode.typeParameter?.constraint;
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = leftmostName(typeNode.typeName);
    const args = typeNode.typeArguments ?? [];
    if (name === "Record" && args.length === 2) return args[0];
    if (TRANSPARENT_TYPE_WRAPPERS.has(name) && args.length === 1) return recordKeyType(args[0], depth + 1);
  }
  return undefined;
}

/**
 * 键类型是否**锚在契约上**。三个条件同时成立才算：
 *  ① 解析得到 `@platform/contracts` 的某个导入名（`sawContracts`）；
 *  ② 整棵类型里不出现 `string`/`any`（`sawWide`）—— 实测掺一个 `string` 后 `tsc` 当场不再咬，
 *     编译期包含关系失效，那正是最省事的伪造法；
 *  ③ 类型里**每一个**类型引用都解析得动（`sawUnresolvable`）—— 要么是契约导入名，
 *     要么是本文件里能展开的 `type` 别名。**解析不动就不豁免**（fail-closed）。
 *     ③ 是 ② 的补漏：`Record<Rid | Loose, …>` 里 `Loose` 从别处 import 进来、其定义是 `string`，
 *     本文件 AST 里根本看不见那个 `string` 关键字 ⇒ 只查 ② 会把这张已经被泡宽的表当成锚定的放过。
 * 本地 `type X = …` 别名会**在本文件内**递归展开；跨文件不追（见文件头反伪造 ⑤）。
 */
function keyTypeAnchored(typeNode, contractsNames, localAliases) {
  let sawContracts = false;
  let sawWide = false;
  let sawUnresolvable = false;
  const seen = new Set();
  const walk = (node, depth) => {
    if (node === undefined || depth > 12) {
      sawUnresolvable = true; // 深度兜底也算「看不清」，同样 fail-closed
      return;
    }
    if (WIDE_TYPE_KINDS.has(node.kind)) {
      sawWide = true;
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = leftmostName(node.typeName);
      if (contractsNames.has(name)) sawContracts = true;
      else if (localAliases.has(name)) {
        // 别名已展开过就不重复走（循环别名保护）；首次必须真展开，展不开即不可解析
        if (!seen.has(name)) {
          seen.add(name);
          walk(localAliases.get(name), depth + 1);
        }
      } else sawUnresolvable = true;
      for (const a of node.typeArguments ?? []) walk(a, depth + 1);
      return;
    }
    if (ts.isTypeQueryNode(node)) {
      // `typeof CHAIN_NODE_REGISTRY[number]["nodeId"]` —— 值侧导入同样算锚
      if (contractsNames.has(leftmostName(node.exprName))) sawContracts = true;
      else sawUnresolvable = true;
      return;
    }
    ts.forEachChild(node, (c) => walk(c, depth + 1));
  };
  walk(typeNode, 0);
  return sawContracts && !sawWide && !sawUnresolvable;
}

/**
 * 取管着这个对象字面量的**声明类型**。
 * 只认两种：`const X: T = {…}` 与 `{…} satisfies T`（实测两者都做多余属性检查、都会报 TS2353）。
 * **刻意不认 `as T`** —— 实测强制断言会把不在册的键静默洗白，认它就等于给伪造者留门。
 */
function declaredTypeOfObjectLiteral(objLit) {
  let cur = objLit;
  let p = cur.parent;
  while (p !== undefined && ts.isParenthesizedExpression(p)) {
    cur = p;
    p = p.parent;
  }
  if (p === undefined) return undefined;
  if (ts.isSatisfiesExpression(p) && p.expression === cur) return p.type;
  if (ts.isVariableDeclaration(p) && p.initializer === cur) return p.type;
  return undefined;
}

/**
 * 取一份源码里所有**静态**字符串字面量。
 * - 含 `"…"` / `'…'` / 无插值的模板串 / Record 的字符串键；
 * - **不含**注释里的内容（AST 里根本没有注释节点）、不含带 `${}` 的模板串（那是派生值，不是抄写）。
 * 返回 `{ text, line, role, anchoredKey }`：`role` ∈ {"nodeId","stepId","other"} 供 K 判据与角色排除用；
 * `anchoredKey` = 「处于键位 **且** 该表的声明类型的键类型锚在契约上」，供 C 判据按机制豁免用。
 */
function extractLiterals(code, fileNameHint) {
  const sf = ts.createSourceFile(
    fileNameHint,
    code,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    fileNameHint.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out = [];

  // ── 本文件从 `@platform/contracts` 导入的**局部绑定名** + 本文件的顶层 type 别名 ──────
  //    （`import { ChainNodeDef as X }` 取 `X`；`import * as C` 取 `C`；类型位上出现的就是它们）
  const contractsNames = new Set();
  const localAliases = new Map();
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st)) localAliases.set(st.name.text, st.type);
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== CONTRACTS_MODULE) continue;
    const clause = st.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) contractsNames.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb === undefined) continue;
    if (ts.isNamespaceImport(nb)) contractsNames.add(nb.name.text);
    else for (const sp of nb.elements) contractsNames.add(sp.name.text);
  }

  /** 该字面量是否处于「锚定表的键位」⇒ C 按机制豁免（只豁免键，**值照常计入**）。 */
  const anchoredKeyOf = (node) => {
    let p = node.parent;
    if (p !== undefined && ts.isComputedPropertyName(p) && p.expression === node) p = p.parent;
    if (p === undefined || !ts.isPropertyAssignment(p)) return false;
    const isKeyPosition =
      p.name === node || (ts.isComputedPropertyName(p.name) && p.name.expression === node);
    if (!isKeyPosition) return false;
    const objLit = p.parent;
    if (objLit === undefined || !ts.isObjectLiteralExpression(objLit)) return false;
    const keyType = recordKeyType(declaredTypeOfObjectLiteral(objLit));
    if (keyType === undefined) return false;
    return keyTypeAnchored(keyType, contractsNames, localAliases);
  };

  const roleOf = (node) => {
    const p = node.parent;
    if (!p) return "other";
    // `{ nodeId: "…" }` / `{ stepId: "…" }` —— 属性值位
    if (ts.isPropertyAssignment(p) && p.initializer === node) {
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
      if (NODE_ID_KEYS.has(key)) return "nodeId";
      if (STEP_ID_KEYS.has(key)) return "stepId";
      return "other";
    }
    // `x.nodeId === "…"` —— 比较位（手写常量与 id 比对，也是一种「持有词表」）
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) {
      const other = p.left === node ? p.right : p.left;
      const name = ts.isPropertyAccessExpression(other) ? other.name.text : ts.isIdentifier(other) ? other.text : "";
      if (NODE_ID_KEYS.has(name)) return "nodeId";
      if (STEP_ID_KEYS.has(name)) return "stepId";
    }
    return "other";
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({
        text: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        role: roleOf(node),
        anchoredKey: anchoredKeyOf(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/* ═══════════════ 3 · 词法自检：证明提取器不是哑的（每次运行都跑） ═══════════════ */
{
  const probe = [
    'const A = ["demand.selftest_arr"];',
    'const B: Record<string, number> = { "capacity.selftest_key": 1 };',
    '// const C = ["order.selftest_line_comment"];',
    '/* const D = ["order.selftest_block_comment"]; */',
    'const RE = /["\']/; const E = "material.selftest_after_regex";',
    'const F = { stepId: "order.selftest_step" };',
    'const G = { nodeId: "demand.selftest_key_role" };',
  ].join("\n");
  const got = extractLiterals(probe, "selftest.ts");
  const texts = new Set(got.map((g) => g.text));
  const must = ["demand.selftest_arr", "capacity.selftest_key", "material.selftest_after_regex"];
  const mustNot = ["order.selftest_line_comment", "order.selftest_block_comment"];
  for (const t of must) {
    if (!texts.has(t)) blind.push(`词法自检失败：提取器取不到 ${t} —— 数组/Record 键/正则之后的字面量都提不出来，扩到前端等于没扩`);
  }
  for (const t of mustNot) {
    if (texts.has(t)) blind.push(`词法自检失败：提取器把注释里的 ${t} 也算数了 —— 这正是 check-view-reachable 第一版那个哑匹配的病`);
  }
  const step = got.find((g) => g.text === "order.selftest_step");
  if (!step || step.role !== "stepId") blind.push("词法自检失败：`stepId:` 角色识别不出来 —— 角色排除会退化成「全放」或「全咬」");
  const nid = got.find((g) => g.text === "demand.selftest_key_role");
  if (!nid || nid.role !== "nodeId") blind.push("词法自检失败：`nodeId:` 角色识别不出来 —— K 判据失效");
}

/* ═══════════════ 3b · 类型锚自检：新判据的金丝雀（每次运行都跑） ═══════════════
 *
 * 「C 的类型锚豁免」是新代码，而**豁免逻辑写瞎了的样子和代码干净的样子一模一样**（都是绿的）。
 * 故正反对拍：该豁免的 ⊕ **必须不豁免**的（后者每一段都对应一条实测过的洗白路子）。
 * 任一条对不上 ⇒ 判「门自己瞎了」，不是「代码干净」。
 */
let anchorSelftestPos = 0;
let anchorSelftestNeg = 0;
{
  const IMP = `import { type ChainNodeDef } from "${CONTRACTS_MODULE}";`;
  const ALIAS = 'type Rid = ChainNodeDef["nodeId"];';
  const cases = [
    // ── 该豁免：键位 + 键类型锚在契约上（编译期 TS2353 兜着，改册这里会红）────────
    {
      name: "Partial<Record<锚定联合, …>> 的键",
      lit: "demand.anchor_partial",
      want: true,
      code: `${IMP}\n${ALIAS}\nconst T: Partial<Record<Rid, number>> = { "demand.anchor_partial": 1 };`,
    },
    {
      name: "裸 Record<锚定联合, …> 的键（没套 Partial 也算）",
      lit: "demand.anchor_bare",
      want: true,
      code: `${IMP}\n${ALIAS}\nconst T: Record<Rid, number> = { "demand.anchor_bare": 1 };`,
    },
    {
      name: "`satisfies` 形态（实测同样报 TS2353）",
      lit: "demand.anchor_satisfies",
      want: true,
      code: `${IMP}\n${ALIAS}\nconst T = { "demand.anchor_satisfies": 1 } satisfies Partial<Record<Rid, number>>;`,
    },
    {
      name: "别名链多跳（Rid → Mid → 契约导入）",
      lit: "demand.anchor_chain",
      want: true,
      code: `${IMP}\ntype Mid = ChainNodeDef["nodeId"];\ntype Rid2 = Mid;\nconst T: Partial<Record<Rid2, number>> = { "demand.anchor_chain": 1 };`,
    },
    // ── 必须不豁免：五条洗白路子 ─────────────────────────────────────────────
    {
      name: "**本地伪造** `type Rid = string` 白嫖豁免",
      lit: "demand.forge_string_alias",
      want: false,
      code: `${IMP}\ntype Rid = string;\nconst T: Partial<Record<Rid, number>> = { "demand.forge_string_alias": 1 };`,
    },
    {
      name: "掺 `string` 把联合泡宽（实测 tsc 当场不再咬）",
      lit: "demand.forge_widened",
      want: false,
      code: `${IMP}\n${ALIAS}\nconst T: Partial<Record<Rid | string, number>> = { "demand.forge_widened": 1 };`,
    },
    {
      name: "`as` 强制断言（实测会把不在册的键静默洗白）",
      lit: "demand.forge_as_cast",
      want: false,
      code: `${IMP}\n${ALIAS}\nconst T = { "demand.forge_as_cast": 1 } as Partial<Record<Rid, number>>;`,
    },
    {
      name: "锚定表里的**值**位（值不受键类型约束，那才是真词表）",
      lit: "demand.forge_value_slot",
      want: false,
      code: `${IMP}\n${ALIAS}\nconst T: Partial<Record<Rid, string>> = { "demand.anchor_partial": "demand.forge_value_slot" };`,
    },
    {
      name: "锚点不是 @platform/contracts（从别的文件 re-export 再 import）",
      lit: "demand.forge_local_module",
      want: false,
      code: `import { type ChainNodeDef } from "./chainNodeSemantics";\n${ALIAS}\nconst T: Partial<Record<Rid, number>> = { "demand.forge_local_module": 1 };`,
    },
    {
      // 这条堵的是「② 只查 string 关键字」的漏：`Loose` 的定义在别的文件里（很可能就是 string），
      // 本文件 AST 里看不见任何 `string` 关键字，光靠 ② 会把这张已经泡宽的表当成锚定的放过。
      name: "联合里掺一个**解析不动**的外来类型（string 关键字不在本文件，② 看不见）",
      lit: "demand.forge_unresolvable_union",
      want: false,
      code: `${IMP}\nimport { type Loose } from "./elsewhere";\n${ALIAS}\nconst T: Partial<Record<Rid | Loose, number>> = { "demand.forge_unresolvable_union": 1 };`,
    },
  ];
  for (const c of cases) {
    const hit = extractLiterals(c.code, "selftest-anchor.ts").find((x) => x.text === c.lit);
    if (hit === undefined) {
      blind.push(`类型锚自检失败：样例「${c.name}」里的字面量 ${c.lit} 根本没被提取器取到 —— 自检本身空转`);
      continue;
    }
    if (hit.anchoredKey !== c.want) {
      blind.push(
        `类型锚自检失败：样例「${c.name}」期望 anchoredKey=${String(c.want)}，实得 ${String(hit.anchoredKey)}` +
          (c.want
            ? " —— 豁免没生效，合法写法会被 C 误判成手抄词表（逼出豁免名单 = 把门蛀空）"
            : " —— **豁免被白嫖**：这条路子实测能骗过 tsc，门放过它就等于把 C 拆了"),
      );
    }
  }
  // 计数**从样例表现算**，不在通过行里手抄一个数 —— 治手抄的门自己手抄一个数是同一种病。
  anchorSelftestPos = cases.filter((c) => c.want).length;
  anchorSelftestNeg = cases.length - anchorSelftestPos;
}

/* ═══════════════ 4 · 组装扫描面 ═══════════════ */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "__snapshots__", "coverage"]);
function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const targets = [];
for (const f of SCANNED_FILES) {
  if (!existsSync(f)) blind.push(`点名扫描的文件不存在：${relative(ROOT, f)} —— 文件被挪走了，门却会「没发现问题」`);
  else targets.push(f);
}
const feFiles = [];
for (const t of SCANNED_TREES) {
  if (!existsSync(t) || !statSync(t).isDirectory()) blind.push(`扫描树不存在：${relative(ROOT, t)} —— 前端覆盖面塌成 0`);
  else walk(t, feFiles);
}
if (feFiles.length < MIN_FE_FILES) {
  blind.push(`前端只扫到 ${feFiles.length} 个 ts/tsx（下限 ${MIN_FE_FILES}）—— walker 断了，不是「前端真的没文件」`);
}
const feRel = new Set(feFiles.map((f) => relative(ROOT, f).split(sep).join("/")));
if (!feRel.has(FE_SENTINEL_FILE)) {
  blind.push(`哨兵文件 ${FE_SENTINEL_FILE} 不在前端扫描集里 —— 它是 CHAIN_NODE_REGISTRY 的已知前端消费方，扫不到说明扫描面不对`);
}
targets.push(...feFiles);

/* ═══════════════ 5 · 逐文件判据 K / N / C / L ═══════════════ */
/**
 * 类型锚豁免的实际命中数 —— **打进通过行**，让「豁免有没有真在用」可核对。
 * 不打出来的话，将来某天豁免逻辑坏成恒 false，门照样绿（因为该文件也会被改成别的写法），
 * 没人看得见判据其实已经死了。（同源戒律：绿测试 ≠ 能用。）
 */
let anchoredKeyHits = 0;
const anchoredKeyFiles = new Set();

for (const file of targets) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const isFrontend = feRel.has(rel);
  const lits = extractLiterals(readFileSync(file, "utf8"), file);

  const seenKnownIds = new Map(); // 在册 id -> 首次出现行（C 判据）
  const seenLabels = new Map(); // 在册 label -> 首次出现行（L 判据）

  for (const { text, line, role, anchoredKey } of lits) {
    // ── K：键位判据。任何方言都咬（含无点号的旧 D1 词表 `sop_consensus`）。
    if (role === "nodeId" && !isAllowed(text)) {
      errs.push(
        `${rel}:${line} [K·键位] \`nodeId\` 位上用了不在册的 "${text}" —— ` +
          `全链节点 ID 必须出自 CHAIN_NODE_REGISTRY（契约 §2.5），或属动态工序命名空间 ${OP_PREFIX}*。` +
          `自由串正是 D1/E1 各造一套词表、节拍链整条断开的直接原因。`,
      );
      continue;
    }
    // ── N：命名空间判据。抓 K 看不见的形状（数组字面量 / Record 键 / case）。
    if (role !== "stepId" && NODE_SHAPE.test(text) && !isAllowed(text)) {
      errs.push(
        `${rel}:${line} [N·命名空间] 字面量 "${text}" 占用了全链节点命名空间 <${stagePrefixes.join("|")}>.* ` +
          `却不在 CHAIN_NODE_REGISTRY 在册（也不属 ${OP_PREFIX}*）。` +
          `该命名空间由契约 §2.5 独占；要新增节点请改注册表，不要在消费方就地造串。` +
          `（若这本是 stepId，请写在 \`stepId:\` 属性位上——那是另一个命名空间。）`,
      );
      continue;
    }
    // ── C 的**按机制豁免**：处于「键类型锚在契约上」的表的键位 ⇒ **只**从 C 的抄表数里扣掉。
    //    这类键改册即 TS2353（编译期包含关系），C 的立论「改册时这里不会跟着变」对它不成立。
    //    三条边界，一条都不许含糊：
    //     · K/N 在上面**已经走过**了 —— 不在册的键照样被 N 咬。豁免的是「合法键的计数」，
    //       不是「这张表怎么写都行」；
    //     · **值**不在豁免范围（`anchoredKey` 只在键位为真）——值不受键类型约束，那才是真词表；
    //     · **L 照常计数**（下一行不加条件）：键绑死了不代表值干净，「中文映射表副本」的形态
    //       恰恰是在值位抄 `label`。豁免只回答「键会不会漂」，不回答「值是不是副本」。
    if (known.has(text)) {
      // 只在**豁免真的起了作用**时计数（该字面量确是在册 nodeId、本会被 C 数进去）。
      // 数「所有锚定键」会把 `Record<Verdict, string>` 这种与本门无关的表也算进来 ⇒ 通过行说谎。
      if (anchoredKey === true) {
        anchoredKeyHits += 1;
        anchoredKeyFiles.add(rel);
      } else if (!seenKnownIds.has(text)) {
        seenKnownIds.set(text, line);
      }
    }
    if (knownLabels.has(text) && !seenLabels.has(text)) seenLabels.set(text, line);
  }

  // ── C / L：抄表判据。只对前端 —— 数据侧 cadence.ts 的 CADENCE_NODES 是原创声明不是副本。
  if (!isFrontend) continue;
  if (seenKnownIds.size >= COPY_THRESHOLD) {
    const sample = [...seenKnownIds.entries()].slice(0, 5).map(([id, l]) => `${id}@${l}`).join(", ");
    errs.push(
      `${rel}:${[...seenKnownIds.values()][0]} [C·抄表] 本文件把 ${seenKnownIds.size} 个在册 nodeId 写成了字面量（${sample}…）——` +
        `id 全对也仍然是**第二份注册表**：改册时这里不会跟着变，就退回 D1/E1 各持一套的状态。` +
        `请改成从 \`CHAIN_NODE_REGISTRY\` 派生（见 views/sim/InspectorNodePanel.tsx 的写法）。` +
        `若这本就是一张「按节点写的原创内容表」（键必须逐个写出来、内容派生不出来），` +
        `把它声明成 \`const T: Partial<Record<Rid, …>> = {…}\`（\`Rid\` 由 \`@platform/contracts\` 的 ` +
        `\`ChainNodeDef["nodeId"]\` 派生）—— 键就绑在编译期了，本判据按机制放行。` +
        `⚠ 别用 \`as\` 断言、也别把键类型掺成 \`Rid | string\`：这两条实测都会让 \`tsc\` 不再咬，门也照样不认。`,
    );
  }
  if (seenLabels.size >= COPY_THRESHOLD) {
    const sample = [...seenLabels.entries()].slice(0, 5).map(([id, l]) => `${id}@${l}`).join(", ");
    errs.push(
      `${rel}:${[...seenLabels.values()][0]} [L·抄标签] 本文件把 ${seenLabels.size} 个在册 label 写成了字面量（${sample}…）——` +
        `契约 §2.5 明写「label 人读名，前端**不另维护中文映射表**，一律取这里」。请从 \`chainNodeDef(nodeId).label\` 取。`,
    );
  }
}

/* ═══════════════ 6 · 报告 ═══════════════ */
if (blind.length > 0) {
  console.error("❌ chain-node-singlesource:check 失败 —— **门自己瞎了**（不是「被扫代码有问题」，修法完全不同）：");
  for (const e of blind) console.error("  · " + e);
}
if (errs.length > 0) {
  console.error("❌ chain-node-singlesource:check 失败：");
  for (const e of errs) console.error("  · " + e);
}
if (blind.length > 0 || errs.length > 0) process.exit(1);

console.log(
  `✅ chain-node-singlesource:check 通过（注册表 ${registry.length} 节点 / ${stages.length} 阶段前缀 · ` +
    `扫描 ${targets.length} 个文件：datacore ${SCANNED_FILES.length} + frontend ${feFiles.length} · ` +
    `判据 K 键位 / N 命名空间 / C 抄表 / L 抄标签 · ` +
    `词法自检 + 类型锚自检(${anchorSelftestPos} 正/${anchorSelftestNeg} 反)通过 · ` +
    `C 类型锚豁免命中 ${anchoredKeyHits} 处 / ${anchoredKeyFiles.size} 文件` +
    (anchoredKeyFiles.size > 0 ? `：${[...anchoredKeyFiles].join(", ")}` : "（今天没有任何文件用到该豁免）") +
    `）`,
);
