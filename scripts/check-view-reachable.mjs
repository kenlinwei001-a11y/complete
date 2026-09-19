#!/usr/bin/env node
/**
 * 视图可达门（治理）—— **每个视图模块都必须有生产调用方**。
 *
 * ## 由来：同一个病三次（F3 → F4 → F2），三次都靠人肉发现
 *
 * `apps/frontend-shell/src/views/registry.ts` 是一张**手工登记的字符串键表**，没有自动扫描。
 * 于是「写了一个视图」和「这个视图能被打开」是两件互不相关的事：
 *
 *   · WO-SANDBOX-F3 `PhysicalTopologyView` —— 实现有、测试 29 例全绿、**零生产调用方**
 *   · WO-SANDBOX-F4 `InspectorNodePanel`   —— 实现有、SEAM 38 例全绿、**零生产调用方**
 *   · WO-SANDBOX-F2 `TransitFlowLayer`     —— 实现有、SEAM 全绿、**零生产调用方**
 *     （这个还更阴：组件顶注**自述**「我是线路图的图层、不是独立 view，故不进 registry」，
 *      而设想中的宿主 `ChainLineMapView` **从未挂载过它** —— 自述不是证据。）
 *
 * 三次的共同形态 = 本仓记的假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：
 * **测试咬的是组件，不是链路**。组件永远绿、页面永远打不开，四包 gate 全绿放过。
 *
 * 三次都是人在并线时偶然发现的。按本仓规矩：**同一个病出现第二次就交给机器判**，
 * 这道门已经欠了一次。
 *
 * ## 判据
 *
 * `src/views/**` 下的每个模块，必须被 `src/` 下**别的**文件引用（静态 import / 动态 import() /
 * re-export 皆可）。`registry.ts` 里的 `() => import("./sim/Xxx")` 天然满足 —— 那正是接线本身。
 * 一个都没有 = 孤儿 = 没接线。
 *
 * 刻意**不**去猜「哪个文件算 renderer」（按默认导出签名猜既脆又会漏）：
 * 直接问模块图「有没有人引用你」，这个问题对图层、宿主、工具模块一视同仁，且不可能被自述糊弄。
 *
 * ## 诚实边界
 *
 * · 只看**静态可见**的引用。若将来引入 `import.meta.glob` 或字符串键动态拼路径，本门会误报 ——
 *   届时应扩本门去认那种形态，而不是把文件加进豁免（豁免会把真孤儿一起放过）。
 * · 只管 frontend-shell 的 views/。别的包有别的门。
 *
 * 用法：node scripts/check-view-reachable.mjs
 * 退出码非 0 即失败。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-view-reachable.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = "apps/frontend-shell/src";
const VIEWS = join(ROOT, "views");
const EXT = [".ts", ".tsx"];

/** 递归收集 dir 下的 .ts/.tsx（跳过测试与样式）。 */
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXT.some((x) => e.endsWith(x)) && !/\.(test|spec)\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const allSrc = walk(ROOT);
const viewFiles = allSrc.filter((f) => f.startsWith(VIEWS + "/"));

/** 把一个 import 说明符解析成仓内文件路径（解析不出返回 null —— 第三方包/裸模块）。 */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else return null; // 第三方包
  const cands = [base, ...EXT.map((x) => base + x), ...EXT.map((x) => join(base, "index" + x))];
  for (const c of cands) {
    try {
      if (statSync(c).isFile()) return relative(process.cwd(), c);
    } catch {
      /* 不存在，继续试下一个候选 */
    }
  }
  return null;
}

/**
 * 去掉注释再扫 —— **这一步是命门，第一版没有它，门是哑的**。
 *
 * 实测（写这道门时的第一次变异反证）：把 registry.ts 的三行登记注释掉，
 * 门**照样报 0 孤儿、照样绿**。因为裸文本匹配对
 *   `// registerRenderer("transit-flow", () => import("./sim/TransitFlowLayer"));`
 * 和没注释的那一行**完全一样**——「登记被注释掉」与「登记还在」在它眼里无差别。
 *
 * 也就是说：第一版这道门本身就是它要治的那种东西 ——
 * **一个存在、会跑、永远绿、但证明不了它所断言之事的门**。留此注释以免有人再把它删了图省事。
 */
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // 行注释（`[^:]` 避免砍掉 http:// 这类）

// 收集全 src 的引用边（静态 import / 动态 import() / re-export）
const referenced = new Set();
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
for (const f of allSrc) {
  const src = stripComments(readFileSync(f, "utf8"));
  for (const m of src.matchAll(SPEC_RE)) {
    const target = resolveSpec(m[1], f);
    // 自引用不算「有调用方」
    if (target && target !== relative(process.cwd(), f)) referenced.add(target);
  }
}

const orphans = viewFiles.map((f) => relative(process.cwd(), f)).filter((f) => !referenced.has(f)).sort();

console.log(`· 视图模块 ${viewFiles.length} 个 · 被 src 引用 ${viewFiles.length - orphans.length} 个 · 孤儿 ${orphans.length} 个`);

if (orphans.length) {
  console.error("\n✗ 视图可达门未通过 —— 下列模块**零生产调用方**（实现再全、测试再绿，也没有任何路由渲染得到它）：");
  for (const o of orphans) console.error(`  - ${o}`);
  console.error(
    "\n  修法：在 apps/frontend-shell/src/views/registry.ts 补一行 registerRenderer(\"<key>\", () => import(\"./<路径>\"))，" +
      "\n       并补一条**可达门测试**（照 test/transit-flow-reachable.test.tsx：从注册表的字符串键出发真渲染，" +
      "\n       而不是直接 import 组件——直接 import 咬的是组件、不是链路）。" +
      "\n  ⚠ 若该模块确实不该是独立视图（纯工具/子组件），**把它移出 src/views/**，不要在此加豁免：" +
      "\n     豁免名单会把将来的真孤儿一起放过，那正是这道门存在的原因。",
  );
  process.exit(1);
}
console.log("✓ 视图可达门通过：src/views 下每个模块都有生产调用方。");
