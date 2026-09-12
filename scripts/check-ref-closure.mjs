#!/usr/bin/env node
/**
 * 门 `ref-closure:check` · 引用可校验门的防退化门（WO-SKILL-REFCLOSURE-A）
 *
 * ── 治什么（两种退化，形态不同、修法不同，故分开报）──────────────────────────
 *  D1 **摘门**：某条发布路把 `probeMissingRefs` 调用摘了 / 新增一条发布路忘了接。
 *      历史实况：探针 2026-08-09 之前接了 agent 发布与 workflow 发布两路，**唯独 skill 发布路没接**，
 *      于是技能引用一个根本不存在的求解器照样发布成功。这是「接了线接错地方」——
 *      grep 得到「probeMissingRefs 有 2 个调用方」这个**看起来很健康的数字**，
 *      而它并不度量「每条发布路都被守住了」。本门直接量后者。
 *  D2 **fail-open 回潮**：探针内部两层放行任一被重新打开。
 *      第一层 `catch` 静默吞（读不出注册表就放行）；
 *      第二层 `if (known.size > 0)`（注册表**返回空集**也放行）。第二层更毒：
 *      注册表一读不出东西门就整体失效，且**没有任何信号**。
 *      本仓一直在猎的形态：**「我没找到」和「它不存在」是两个不同的命题。**
 *
 * ── 金丝雀（铁律 0.6 落地机制：扫描类结论一律先自证工具）────────────────────
 * 本门开跑前先跑 `selftest()`：把**当前真实源码**按历史病灶各变异一次，喂给**同一个** `scan()`，
 * 任一变异没被咬 ⇒ 打印「⛔ 门自己瞎了」并 exit 1，**不许**报「代码干净」。
 * 金丝雀与主逻辑**共用同一份 `scan()`**（不是各抄一份正则）——抄了就是装饰品：
 * 改主正则时金丝雀拿旧的去测、照样绿。
 * 另：抽取不到发布 handler（route 字面量改了 / 文件挪了）一律报「工具坏了」，不报「没有违规」。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────
 *  ① 三条发布路（agents / workflows / skills）的 handler 体内都必须出现 `probeMissingRefs(`
 *  ② 探针实现区内不得出现 `known.size > 0` 形态的空集放行
 *  ③ 探针实现区内不得存在**不抛异常的 catch**（静默吞）
 *  ④ 探针实现区必须同时具备两条不可用红线：注册表抛错 → throw；注册表空集 → throw
 *  ⑤ skill 发布路必须在**落库之前**拦（`probeMissingRefs` 出现在 `repos.skills.update` 之前）
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（本门所闭断点）。
 * 用法：node scripts/check-ref-closure.mjs   ·   pnpm ref-closure:check
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
  console.error(`⛔ check-ref-closure.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = "apps/agentcore/src/server.ts";
const RESOURCES = "apps/agentcore/src/resources.ts";

/**
 * ══ WO-GATE-ROSTER-SWEEP 修（2026-08-16）· 名册从**手抄 3 条**改成**现算全部发布路** ══════
 *
 * **病**（本体 §8 `G-GATE-ROSTER-HANDCOPIED`）：这张表原文自陈
 * 「新增一条发布路就该进这张表——表本身是可 review 的边界」，而这句话**恰恰是病灶**：
 * 它把「谁该被守」的判定交给了人的记性。本门 D1 号称治「新增一条发布路忘了接探针」，
 * 可**忘了接的那条同时也会忘了进这张表**，于是它一次都不会被问 —— 门只守住它记得的那 3 条。
 *
 * **形态**（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『名单里那 3 条都接了探针』当作『每条发布路都被守住了』的证据，而前者并不度量后者。」**
 *   这与本门文件头已经点名的那个病**一模一样**（"grep 得到 probeMissingRefs 有 2 个调用方
 *   这个看起来很健康的数字，而它并不度量每条发布路都被守住了"）——
 *   旧实现只是把同一个错从「数调用方」挪到了「数名单」。
 *
 * **实测差集**（2026-08-16，全部追到调用点的条件才下的结论，不是 grep 命中数）：
 * `apps/agentcore/src/server.ts` 里 `app.post` 的发布路由共 **9 条**，名册只有 3 条。
 * 逐条追过一层后，**至少 1 条是真洞**：
 *   · `/api/v1/catalog/plans/:planId/publish` → `catalog/service.ts` 的 `publishPlan`
 *     **确证携带规则引用**（`planStepRuleRefs(published.steps)` 并 `reportRefs` 上报 A），
 *     却**从不调 `probeMissingRefs`** ⇒ 引用一条不存在的规则照样发布成功。
 *     这正是 D1 要治的形态，而名单手抄让它从未被问过。
 *   · `/b/v1/plan-builders/:id/publish` → `publishCanvas` → `publishPlan`，同路同病。
 *   · `/b/v1/scenarios/:key/publish` 另有 `scenarioClosure` 闭合守卫（**不同机制，非缺口**）。
 *   · `/api/v1/catalog/intents/:intentId/publish` / `/b/v1/mcp-configs/:id/publish` /
 *     `/b/v1/scenarios/:key/publish-chain` —— 今天未测出携带 solver/rule/objectType 引用。
 *
 * **修法**：
 *   ① 受检集合 = 从 `server.ts` **现算**全部 `app.post("…publish…")` 路由（名册不再决定问谁）；
 *   ② `GUARDED_ROUTE_SPECS` 降级为**附加判据表**：只登记「这条路除了要有探针、还要满足什么」
 *      （如 skill 路必须拦在 `repos.skills.update` 之前）。它是判据，不是受检集合；
 *   ③ 未守的路进**棘轮基线** `scripts/ref-closure-baseline.json`，逐条带 `why`，**只降不升**；
 *   ④ 现算路由数低于下界 ⇒ 报 **RC=2「工具坏了」**，不许报「每条发布路都守住了」。
 *
 * ⚠ **本门只让洞可见，没有把洞补上**：真正把 `probeMissingRefs` 接到 plan 发布路上要动
 * `apps/agentcore/src`，超出 WO-GATE-ROSTER-SWEEP 的范围边界（纯门单）。
 * 收口 = 接探针 → 删基线对应条目 → 跑 `--tighten`，额度当场收回。
 */

/** 发布路由的**现算判据**（形状而非名单）：`app.post("<路径含 publish>"`。 */
const PUBLISH_ROUTE_RE = /app\.post\(\s*"([^"]*\/publish(?:-[a-z]+)?)"/g;
/** 现算路由数下界（金丝雀）：低于它说明抽取器坏了 —— 集合塌陷 ⇒ 差集恒空 ⇒ 门恒绿。 */
const MIN_PUBLISH_ROUTES = 5;

/**
 * **附加判据表**（判据，非受检集合）：某条路除「必须有探针」外还要满足的额外约束。
 * 现算出的路由若不在此表，只受「必须有探针」这一条约束。
 */
const GUARDED_ROUTE_SPECS = {
  '"/b/v1/skills/:id/publish"': { label: "skill 发布", persistCall: "repos.skills.update" },
  '"/b/v1/agents/:id/publish"': { label: "agent 发布" },
  '"/b/v1/workflows/:id/publish"': { label: "workflow 发布" },
};

const read = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
};

/* ══════════════════════════════════════════════════════════════════════════
 * 抽取器（唯一实现，主逻辑与金丝雀共用）
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 剥注释（保留字符串字面量原样）。**这一步不是洁癖，是本门自己踩过的坑**：
 *  · 首版没剥注释，被**自己写的那句注释**「…且远在 `repos.skills.update` 之前」骗出一条假阳性
 *    ——「提及 ≠ 读取」，`indexOf` 命中的是注释里的字符串，不是那次调用。
 *  · 更要命的反向坑：`probeMissingRefs(` 若被**注释掉**，不剥注释的 `includes()` 依然为真
 *    ⇒ 门会给一条已经摘了的线判绿（假绿）。
 * 用逐字符小状态机而非正则：正则会把字符串里的 `//`（如 `http://`）误当注释起点。
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 取某条路由 handler 的源码切片：从 `app.post(<route>` 起，到**下一个同级路由声明**（`\n  app.`）为止。
 * 抽不到返回 null —— 调用方必须把 null 当作「工具坏了」，不许当作「没有违规」。
 */
function sliceHandler(server, route) {
  const start = server.indexOf(`app.post(${route}`);
  if (start === -1) return null;
  const rest = server.slice(start + 1);
  const nextIdx = rest.search(/\n {2}app\.(post|get|put|delete|patch)\(/);
  return nextIdx === -1 ? server.slice(start) : server.slice(start, start + 1 + nextIdx);
}

/**
 * 取探针实现区 = 三个锚点里最靠前的那个，到 `probeMissingRefs` 函数体结束（花括号配平）。
 * 三个锚点缺任一即返回 null（当作「工具坏了」）——探针被改名/拆走时不许静默判绿。
 * 注：区必须**含 `probeUnavailable`**，否则「503 错误码是否还在」这条判据会落在区外，
 * 只能靠 doc 注释里的提及蒙混过关（首版就是这么假绿的，剥注释后当场暴露）。
 */
function sliceProbeRegion(resources) {
  const anchors = ["function probeUnavailable", "function knownKeys", "export async function probeMissingRefs"];
  const idxs = anchors.map((a) => resources.indexOf(a));
  if (idxs.some((i) => i === -1)) return null;
  const start = Math.min(...idxs);
  const probeAt = idxs[2];
  // 从 probeMissingRefs 的第一个 `{` 起配平花括号，找到函数体结束
  const bodyStart = resources.indexOf("{", resources.indexOf(")", probeAt));
  if (bodyStart === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < resources.length; i++) {
    const ch = resources[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null;
  return resources.slice(start, end);
}

/** 区内是否存在**不抛异常的 catch**（静默吞）。返回命中的原文片段数组。 */
function silentCatches(region) {
  const hits = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(region)) !== null) {
    const bodyStart = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = bodyStart; i < region.length; i++) {
      if (region[i] === "{") depth++;
      else if (region[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) continue;
    const body = region.slice(bodyStart, end);
    if (!/\bthrow\b/.test(body)) hits.push(region.slice(m.index, end).replace(/\s+/g, " ").slice(0, 120));
  }
  return hits;
}

/**
 * **现算**全部发布路由（本单的核心改动：名册不再决定问谁）。
 * 返回带引号的 route 字面量数组（与 `sliceHandler` 的入参形状一致），去重且保持源码顺序。
 */
function livePublishRoutes(server) {
  const out = [];
  PUBLISH_ROUTE_RE.lastIndex = 0;
  let m;
  while ((m = PUBLISH_ROUTE_RE.exec(server)) !== null) {
    const lit = `"${m[1]}"`;
    if (!out.includes(lit)) out.push(lit);
  }
  return out;
}

/**
 * 唯一检测实现。返回 { violations: string[], toolBroken: string[], routes: string[] }。
 * **金丝雀与主逻辑共用本函数** —— 改这里的判据，金丝雀自动跟着变。
 */
function scan(raw) {
  const violations = [];
  const toolBroken = [];
  // 全程只看**剥掉注释后**的源码：注释里的提及不算接线，被注释掉的调用也不算存在。
  const server = stripComments(raw.server);
  const resources = stripComments(raw.resources);

  // ① 每条发布路都必须调探针（不是"探针有几个调用方"，也不是"名单里那几条"，
  //    而是**现算出来的每一条**是否被守住）。
  const routes = livePublishRoutes(server);
  if (routes.length < MIN_PUBLISH_ROUTES) {
    toolBroken.push(
      `现算只抽出 ${routes.length} 条发布路由（下界 ${MIN_PUBLISH_ROUTES}）—— 抽取器坏了，不是路由没了。` +
        `集合塌陷会让差集恒空、门恒绿，那是失败的危险方向。`,
    );
    return { violations, toolBroken, routes: [] };
  }
  for (const route of routes) {
    const spec = GUARDED_ROUTE_SPECS[route] ?? {};
    const label = spec.label ?? route.replace(/"/g, "");
    const persistCall = spec.persistCall;
    const body = sliceHandler(server, route);
    if (body === null) {
      toolBroken.push(`抽取不到发布 handler ${route}（route 字面量改了？文件挪了？）—— 报「工具坏了」，不报「没有违规」`);
      continue;
    }
    if (!body.includes("probeMissingRefs(")) {
      violations.push(
        `D1 摘门：${label}（${route}）的 handler 里没有 probeMissingRefs( —— ` +
          `该路可发布引用不存在的求解器/规则/对象类型（死路）。修：照另几条发布路补上探针调用。`,
      );
      continue;
    }
    // ⑤ skill 路：必须拦在落库之前（"返回 422" 和 "真没落库" 是两个命题）
    if (persistCall) {
      const probeAt = body.indexOf("probeMissingRefs(");
      const persistAt = body.indexOf(persistCall);
      if (persistAt !== -1 && probeAt > persistAt) {
        violations.push(`D1 顺序错：${label} 的 probeMissingRefs 出现在 ${persistCall} 之后 —— 拒发布必须发生在落库之前。`);
      }
    }
  }

  // ②③④ fail-open 回潮
  const region = sliceProbeRegion(resources);
  if (region === null) {
    toolBroken.push("抽取不到探针实现区（knownKeys / probeMissingRefs 改名或挪走了）—— 报「工具坏了」");
  } else {
    if (/known\.size\s*>\s*0/.test(region)) {
      violations.push(
        "D2 第二层 fail-open 回潮：探针实现区出现 `known.size > 0` 形态 —— " +
          "注册表返回**空集**时跳过比对 = 门整体失效且无信号。" +
          "「我没找到」≠「它不存在」：空集必须视为门不可用而红。",
      );
    }
    const silent = silentCatches(region);
    for (const s of silent) {
      violations.push(`D2 第一层 fail-open 回潮：探针实现区存在不抛异常的 catch（静默吞）：\`${s}\` —— 探针出错必须 red 并说清哪一步失败。`);
    }
    if (!/REGISTRY_ERROR/.test(region) || !/REGISTRY_EMPTY/.test(region)) {
      violations.push("D2 红线缺失：探针实现区必须同时具备 REGISTRY_ERROR（读取失败）与 REGISTRY_EMPTY（空集）两条不可用红线。");
    }
    if (!/REF_PROBE_UNAVAILABLE/.test(region)) {
      violations.push("D2 红线缺失：探针实现区未见 REF_PROBE_UNAVAILABLE —— 门不可用时必须有可诊断的错误码，不许静默放行。");
    }
    if (!/known\.size\s*===\s*0/.test(region)) {
      violations.push("D2 红线缺失：探针实现区未见 `known.size === 0` 的空集判定 —— 空集放行正是第二层 fail-open 的本体。");
    }
  }

  return { violations, toolBroken, routes };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 金丝雀：拿**当前真实源码**按历史病灶各变异一次，喂给同一个 scan()
 * ════════════════════════════════════════════════════════════════════════ */
let SELFTEST_TOTAL = 0;

function selftest(real) {
  const cases = [
    {
      name: "M1 摘掉 skill 发布路的探针调用（2026-08-09 之前的真实状态）",
      mutate: (s) => {
        const body = sliceHandler(s.server, '"/b/v1/skills/:id/publish"');
        if (body === null) return null;
        return { ...s, server: s.server.replace(body, body.replace(/probeMissingRefs\(/g, "__probe_removed__(")) };
      },
      expect: /D1 摘门：skill 发布/,
    },
    {
      // 反向坑：不剥注释的话，被注释掉的调用依然 `includes()` 为真 ⇒ 门给已摘的线判绿。
      //
      // ⚠️ 变异点必须**从抽取器现算**，不许写死语句字面量（WO-REFGATE-ENT · F14 实测踩到）：
      // 原实现锚在 `const deadRefs = await probeMissingRefs(` 这一句上。F14 把发布门判据抽进
      // `skill-publish-gate.ts` 后，调用形态变成 `probe: (want) => probeMissingRefs(...)`，
      // 那句字面量随之消失 ⇒ 金丝雀**构造不出变异**、本门自报「门瞎了」。
      // 这次报得对（它确实不该在锚点失效时判绿），但根因是**金丝雀自带了一份会过期的副本**——
      // 正是铁律 0.6 点名的「抄一份就是装饰品」。改成按行现找：只要那条线还接着，就一定找得到。
      name: "M1b 把 skill 发布路的探针调用**注释掉**（注释 ≠ 接线）",
      mutate: (s) => {
        const rawBody = sliceHandler(s.server, '"/b/v1/skills/:id/publish"');
        if (rawBody === null) return null;
        const lines = rawBody.split("\n");
        // 只挑**真代码行**：注释行里提及探针名不算接线（本门自己就是靠这条区分的）。
        const idx = lines.findIndex((l) => {
          const t = l.trimStart();
          return l.includes("probeMissingRefs(") && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        });
        if (idx === -1) return null;
        const mutatedBody = [...lines.slice(0, idx), `// ${lines[idx]}`, ...lines.slice(idx + 1)].join("\n");
        return { ...s, server: s.server.replace(rawBody, mutatedBody) };
      },
      expect: /D1 摘门：skill 发布/,
    },
    {
      name: "M2 重开第二层 fail-open（known.size > 0 空集放行）",
      mutate: (s) => ({ ...s, resources: s.resources.replace("if (known.size === 0) throw", "if (known.size > 0) return known;\n  if (false) throw") }),
      expect: /D2 第二层 fail-open 回潮/,
    },
    {
      name: "M3 重开第一层 fail-open（catch 静默吞）",
      mutate: (s) => ({
        ...s,
        resources: s.resources.replace(
          /catch \(e\) \{\s*throw probeUnavailable\(scope, "REGISTRY_ERROR"[^}]*\}/,
          "catch {\n    keys = [];\n  }",
        ),
      }),
      expect: /D2 第一层 fail-open 回潮/,
    },
    {
      name: "M4 探针实现区整体被挪走（抽取器必须报「工具坏了」而非「干净」）",
      mutate: (s) => ({ ...s, resources: s.resources.replace("function knownKeys", "function __renamed_knownKeys") }),
      expectBroken: /抽取不到探针实现区/,
    },
  ];

  SELFTEST_TOTAL = cases.length;
  const failures = [];
  const vacuous = [];
  for (const c of cases) {
    const mutated = c.mutate(real);
    if (mutated === null) {
      // 「构造不出这个变异」有两种成因，必须分开（否则真违规会被误报成"门瞎了"）：
      //   · 真源码里那个东西**本来就不在了** → 主扫描会直接报违规，本条金丝雀只是空转；
      //   · 抽取器失灵 → 才是门瞎了。
      // 故此处只登记为"空转"，由主程序结合主扫描结果定性。
      vacuous.push(`${c.name}：变异构造失败（目标片段不存在——可能它已经被摘了）`);
      continue;
    }
    const r = scan(mutated);
    const hay = [...r.violations, ...r.toolBroken].join("\n");
    const want = c.expect ?? c.expectBroken;
    if (!want.test(hay)) failures.push(`${c.name}：变异后**没有**被本门咬到（期望匹配 ${want}）`);
  }
  return { failures, vacuous };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 主程序
 * ════════════════════════════════════════════════════════════════════════ */
const BASELINE = join(ROOT, "scripts/ref-closure-baseline.json");
const BASELINE_NOTE =
  "① 本文件是 `check-ref-closure.mjs` 的**未守发布路存量棘轮**。受检集合（问哪些发布路）由门**现算**" +
  "（扫 server.ts 的 `app.post(\"…/publish\")`），本文件里一条路由都不当名单用 —— 名单一手抄，" +
  "**忘了接探针的那条同时也会忘了进名单**，于是它一次都不会被问（本体 §8 G-GATE-ROSTER-HANDCOPIED）。" +
  "② 每条必须写 `why`：**无理由白名单正是棘轮要治的病**，要说清「这条路凭什么今天可以没有探针」——" +
  "是它压根不携带引用，还是它另有等价守卫，还是**它就是个真洞**（真洞必须写明代价）。" +
  "③ `maxEntries` 恒等于 entries 条数；评审唯一必须拒绝的一行就是把它调大。" +
  "④ `--tighten` **只删不加**：接上探针即收回额度；新增未守的发布路**不自动收编**，当场红。";

function bail1(lines, hint) {
  for (const m of lines) console.error(`  - ${m}`);
  if (hint) console.error(hint);
  process.exit(1);
}

function mainRefClosure() {
  const argv = process.argv.slice(2);
  const server = read(SERVER);
  const resources = read(RESOURCES);
  if (server === null || resources === null) {
    // 读不到被守文件 = **工具没准备好**，不是代码有问题。旧版这里退 1，方向正好相反。
    console.error(`⛔ ref-closure:check 工具坏了：读不到被守文件（${SERVER} / ${RESOURCES}）`);
    console.error("   本次结论作废：**不许**读作「代码干净 / 每条发布路都守住了」。");
    return 2;
  }
  const real = { server, resources };

  // 1) 金丝雀（门自己会瞎）与 2) 真扫，先各自跑完再定性 —— 顺序不决定结论，证据才决定。
  const { failures: selftestFailures, vacuous } = selftest(real);
  const { violations, toolBroken, routes } = scan(real);

  if (argv.includes("--census")) {
    console.log(`· 现算发布路由 ${routes.length} 条（名册不再决定问谁）：`);
    for (const r of routes) {
      const body = sliceHandler(stripComments(server), r);
      const guarded = body !== null && body.includes("probeMissingRefs(");
      console.log(`    ${guarded ? "[已守]" : "[❗未守·旧名册够不着]"} ${r.replace(/"/g, "")}`);
    }
    return 0;
  }

  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
  // 违规 id 用**路由字面量**，稳定且与行号无关。
  const liveUnguarded = new Map();
  for (const v of violations) {
    const m = /（("[^"]+")）/.exec(v);
    if (/^D1 摘门/.test(v) && m) liveUnguarded.set(m[1], v);
  }
  const otherViolations = violations.filter((v) => !(/^D1 摘门/.test(v) && /（"[^"]+"）/.test(v)));

  if (argv.includes("--seed") || argv.includes("--tighten")) {
    // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现，不另抄）——
    // 不过 ⇒ RC=2「门自己坏了」：写入器一坏会静默吞掉人手挂账的 why，
    // 而 why 恰恰是棘轮唯一能被人审的部分，吞掉它等于把棘轮降级成白名单。
    const bc = baselineDocCanary();
    if (!bc.ok) {
      console.error(`⛔ ref-closure:check 工具坏了：基线写入器金丝雀${bc.got}`);
      console.error("   本次不写基线（写了会吞掉人手 why）。");
      return 2;
    }
    const isTighten = argv.includes("--tighten");
    const prev = base?.entries ?? {};
    const next = {};
    for (const [id] of liveUnguarded) {
      if (isTighten && !(id in prev)) continue; // 新增未守的不自动收编（收编 = 买绿）
      next[id] = prev[id] ?? { why: "【待人补】--seed 落的机器事实，尚未写明「这条路凭什么今天可以没有探针」。" };
    }
    // ⚠ `buildBaselineDoc(` 必须**内联在写入表达式里**：`baseline-writer-honesty:check` 判的是
    //   「写的那一刻用没用共享写入器」，先赋值给中间变量再写会被判 HAND_ROLLED。
    writeFileSync(
      BASELINE,
      JSON.stringify(buildBaselineDoc({
        prev: base,
        generatedBy: `node scripts/check-ref-closure.mjs ${isTighten ? "--tighten" : "--seed"}`,
        prose: { note: BASELINE_NOTE },
        computed: { entries: next, maxEntries: Object.keys(next).length, liveRouteCount: routes.length },
      }), null, 2) + "\n",
    );
    console.log(`✓ 基线已写：${Object.keys(next).length} 条未守发布路（${isTighten ? "只删不加" : "首次建账"}）· 现算路由 ${routes.length} 条`);
    return 0;
  }

  if (!base) {
    console.error("⛔ ref-closure:check 工具坏了：找不到 scripts/ref-closure-baseline.json —— 棘轮基线是判据①的输入");
    console.error("   先跑：node scripts/check-ref-closure.mjs --seed");
    return 2;
  }
  const known = new Map(Object.entries(base.entries ?? {}));
  const fails = [...otherViolations];
  if (typeof base.maxEntries === "number" && base.maxEntries !== known.size) {
    fails.push(`棘轮自洽：maxEntries=${base.maxEntries} ≠ entries 条数 ${known.size}（改额度必须是一处显眼 diff）`);
  }
  for (const [id, e] of known) {
    if (!e || typeof e.why !== "string" || e.why.trim().length < 10) fails.push(`棘轮条目 ${id} 缺 why —— 无理由白名单正是棘轮要治的病`);
  }
  for (const [id, msg] of liveUnguarded) if (!known.has(id)) fails.push(`${msg}\n      （该路不在棘轮基线里 = **新增**未守发布路，当场红）`);
  for (const id of known.keys()) {
    if (!liveUnguarded.has(id)) fails.push(`棘轮松弛：基线仍挂着 ${id}，但现算它已被探针守住 —— 那是一张能随时退回去的免检名额，请跑 --tighten 收紧`);
  }

  if (fails.length > 0) {
    console.error(`✗ ref-closure:check 未通过（${fails.length} 条）：`);
    bail1(fails, "\n  → 复验：pnpm --filter agentcore test skill-ref-closure（接缝测试从 HTTP 发布端点驱动）");
  }

  // 到这里主扫描是"干净"的 —— 那么金丝雀与抽取器必须先自证可信，才准把"干净"读作"合规"。
  if (selftestFailures.length > 0 || vacuous.length > 0) {
    console.error("⛔ ref-closure:check 门自己瞎了（金丝雀未被咬 / 空转）——本次结论作废，不许读作「代码干净」：");
    for (const f of [...selftestFailures, ...vacuous]) console.error(`  - ${f}`);
    return 2;
  }
  if (toolBroken.length > 0) {
    console.error("⛔ ref-closure:check 工具坏了（抽取不到被测对象）——不许读作「没有违规」：");
    for (const m of toolBroken) console.error(`  - ${m}`);
    return 2;
  }

  console.log(`· 金丝雀：${SELFTEST_TOTAL}/${SELFTEST_TOTAL} 变异全部被咬（摘探针 / 注释掉探针 / 空集放行 / 静默 catch / 抽取器失灵）—— 扫描器可信`);
  console.log(
    `· 发布路守护：**现算** ${routes.length} 条发布路由（非手抄名册）· 已守 ${routes.length - liveUnguarded.size} 条 · ` +
      `未守 ${liveUnguarded.size} 条全部在棘轮基线内且各有 why，无新增、无松弛`,
  );
  console.log("\n✓ ref-closure:check 通过（现算发布路守护到位 · 两层 fail-open 均关死 · skill 路拦在落库之前）。");
  return 0;
}

/* ── 顶层兜底（Program 直接子语句）：未预期异常一律归 RC=2「工具坏了」，不是 RC=1「代码坏了」。 */
try {
  process.exit(mainRefClosure());
} catch (e) {
  gateToolBroken(e);
}
