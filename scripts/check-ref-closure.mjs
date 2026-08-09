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
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = "apps/agentcore/src/server.ts";
const RESOURCES = "apps/agentcore/src/resources.ts";

/** 必须被探针守住的发布路（新增一条发布路就该进这张表——表本身是可 review 的边界）。 */
const GUARDED_PUBLISH_ROUTES = [
  { label: "agent 发布", route: '"/b/v1/agents/:id/publish"' },
  { label: "workflow 发布", route: '"/b/v1/workflows/:id/publish"' },
  { label: "skill 发布", route: '"/b/v1/skills/:id/publish"', persistCall: "repos.skills.update" },
];

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
 * 唯一检测实现。返回 { violations: string[], toolBroken: string[] }。
 * **金丝雀与主逻辑共用本函数** —— 改这里的判据，金丝雀自动跟着变。
 */
function scan(raw) {
  const violations = [];
  const toolBroken = [];
  // 全程只看**剥掉注释后**的源码：注释里的提及不算接线，被注释掉的调用也不算存在。
  const server = stripComments(raw.server);
  const resources = stripComments(raw.resources);

  // ① 每条发布路都必须调探针（不是"探针有几个调用方"，而是"每条路是否被守住"）
  for (const { label, route, persistCall } of GUARDED_PUBLISH_ROUTES) {
    const body = sliceHandler(server, route);
    if (body === null) {
      toolBroken.push(`抽取不到发布 handler ${route}（route 字面量改了？文件挪了？）—— 报「工具坏了」，不报「没有违规」`);
      continue;
    }
    if (!body.includes("probeMissingRefs(")) {
      violations.push(
        `D1 摘门：${label}（${route}）的 handler 里没有 probeMissingRefs( —— ` +
          `该路可发布引用不存在的求解器/规则/对象类型（死路）。修：照另两条发布路补上探针调用。`,
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

  return { violations, toolBroken };
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
const server = read(SERVER);
const resources = read(RESOURCES);
if (server === null || resources === null) {
  console.error(`✗ ref-closure:check：读不到被守文件（${SERVER} / ${RESOURCES}）—— 报「工具坏了」，不报「代码干净」`);
  process.exit(1);
}
const real = { server, resources };

// 1) 金丝雀（门自己会瞎）与 2) 真扫，先各自跑完再定性 —— 顺序不决定结论，证据才决定。
const { failures: selftestFailures, vacuous } = selftest(real);
const { violations, toolBroken } = scan(real);

// 真违规是**主信号**：它存在时先报它（金丝雀空转往往正是"那条线已经被摘了"的副作用）。
if (violations.length > 0) {
  console.error(`✗ ref-closure:check 未通过（${violations.length} 条）：`);
  for (const m of violations) console.error(`  - ${m}`);
  if (vacuous.length > 0) {
    console.error(`  · 附：${vacuous.length} 条金丝雀空转（目标片段已不在源码里——与上面的违规同源，非门失灵）`);
  }
  console.error("\n  → 复验：pnpm --filter agentcore test skill-ref-closure（接缝测试从 HTTP 发布端点驱动）");
  process.exit(1);
}

// 到这里主扫描是"干净"的 —— 那么金丝雀与抽取器必须先自证可信，才准把"干净"读作"合规"。
if (selftestFailures.length > 0 || vacuous.length > 0) {
  console.error("⛔ ref-closure:check 门自己瞎了（金丝雀未被咬 / 空转）——本次结论作废，不许读作「代码干净」：");
  for (const f of [...selftestFailures, ...vacuous]) console.error(`  - ${f}`);
  process.exit(1);
}
if (toolBroken.length > 0) {
  console.error("⛔ ref-closure:check 工具坏了（抽取不到被测对象）——不许读作「没有违规」：");
  for (const m of toolBroken) console.error(`  - ${m}`);
  process.exit(1);
}

console.log(`· 金丝雀：${SELFTEST_TOTAL}/${SELFTEST_TOTAL} 变异全部被咬（摘探针 / 注释掉探针 / 空集放行 / 静默 catch / 抽取器失灵）—— 扫描器可信`);
console.log(`· 发布路守护：${GUARDED_PUBLISH_ROUTES.map((g) => g.label).join(" / ")} 共 ${GUARDED_PUBLISH_ROUTES.length} 条，均已抽取到 handler`);
console.log("\n✓ ref-closure:check 通过（三条发布路均接探针 · 两层 fail-open 均关死 · skill 路拦在落库之前）。");
