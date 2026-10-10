import { describe, expect, it } from "vitest";
import { checkedTree, commentOnlyCanary, factHits, readRepo, stripComments, type CodeTree } from "./factlock";

/**
 * **R-UI-4 · 源码坐标不上屏**（WO-RUI4-SOURCE-COORDS）。
 *
 * ── 病样（2026-09-04 真浏览器实测，非 grep）─────────────────────────────────────
 * 从登录走起逐页取 `document.body.innerText` + 全部 `[title]`，83 个导航可达路由里
 * **4 页共 69 处**把源码文件名/行号打在了用户屏上：
 *   `/v/node-inspector` 34 · `/v/sim-sandbox` 21 · `/admin/boundary` 10 · `/v/transit-flow` 4。
 * 例：因子证据栏里直接印着 `apps/datacore/src/sim/propagation.ts:73`。
 *
 * ── 这道门守的是「换掉」，不是「删掉」───────────────────────────────────────────
 * CLAUDE.md 铁律 1.5 判据二**要求**溯源层必须给出规则 key / 切片 key / 系数值 / 耗时 / 条数
 * —— 它们是业务事实。删成空白会把「能溯源」变成「不能溯源」，比违规更糟。
 * 故修法是把源码坐标**换成业务标识**（契约名 / 对象类型.属性 / 求解器 key / 规则 key / 因子册），
 * 本门只咬「坐标还在不在」这一件事。
 *
 * ── 扫描面为什么是这两条排除，而不是文件白名单 ─────────────────────────────────
 * 白名单迟早被例外吃光；这里用**语法上下文**排除，对新文件照样生效：
 *  ① `src/mocks/`：MSW 只在 `VITE_MOCK=1` 下替换后端，**交付验证禁用 mock**（铁律 1.5 判据三），
 *     且其中的串是后端原串的镜像 —— 单方面改它会让 mock 比后端「更正确」，那是另一种病。
 *  ② `file:` / `relativeFromTest:` 属性行：source-parity 门用来定位源文件核对镜像的**指纹**，
 *     不上屏（真浏览器实测 `/v/physical-topology` 命中 0）。契约侧同源字段亦然 ——
 *     `BoundaryConsumer` 已拆成上屏的 `surface` 与门用的 `file` 两栏。
 *
 * 🚦 金丝雀（铁律 0.6）：报「0 处」这种否定结论前先自证尺子没坏 —— 见 §0。
 * 🚦 变异反证：把任一处业务标识改回 `apps/datacore/src/sim/propagation.ts:73`，§1 必须红。
 */

/**
 * 唯一一份尺子 —— 金丝雀与主判据共用它，不许各抄一份正则（抄了就是装饰品）。
 *
 * ⚠ **第三档（裸文件名）是 2026-09-06 真浏览器实测补上的**，不是补全强迫症：
 * 原尺子只认「带路径前缀」或「带 `:行号`」两档，于是 `battery.ts` / `service.ts` /
 * `cadence.ts` / `chain-sim.ts` 这种**光秃秃的源码文件名**一个都不中 ——
 * 门全绿，而真浏览器在 7 个页面上抓到 **17 处**（`/v/chain-line-map` 8 · `/v/process-wait` 3 ·
 * `/v/node-inspector` 2 · `/admin/boundary` 2 · `/v/sim-sandbox` 1 · `/v/physical-topology` 1）。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 * **「我用『门绿了』当作『屏上没有源码文件名』的证据，而前者并不度量后者 —— 尺子少一档。」**
 */
const COORD_RE =
  /(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs|js):\d+/;

/**
 * 第三档 · **裸文件名**（`battery.ts` / `synthetic/cadence.ts`），只在**字符串字面量里**才算数。
 *
 * ⚠ 这条「只在串里」不是保守，是**必需**：`.ts` 同样是一个合法的属性名 ——
 * 本仓实测 `this.ts = deps.ts`（合成时钟字段）与 `p.ts.slice(0, 10)`（时序点时间戳）
 * 各自会被裸文件名档命中。**按语法上下文排除，不开文件白名单**（白名单迟早被例外吃光）。
 */
const BARE_FILE_RE = /\b[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(ts|tsx|mjs)\b/;

/**
 * 取出一行里所有**字符串字面量的内容**（模板串的 `${…}` 插值段剔除 —— 那里面是代码不是文案）。
 * 上屏文案只可能从这里来；`this.ts` 那种成员访问天然落在串外。
 */
function stringLiterals(line: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const q = line[i];
    if (q !== '"' && q !== "'" && q !== "`") { i++; continue; }
    i++;
    let buf = "";
    while (i < line.length && line[i] !== q) {
      if (line[i] === "\\") { i += 2; continue; }
      if (q === "`" && line[i] === "$" && line[i + 1] === "{") {   // 插值段是代码，跳过
        let depth = 1; i += 2;
        while (i < line.length && depth > 0) { if (line[i] === "{") depth++; else if (line[i] === "}") depth--; i++; }
        continue;
      }
      buf += line[i]; i++;
    }
    i++;
    out.push(buf);
  }
  return out.join("\n");
}

/**
 * 门用指纹属性（不上屏）—— `file:` / `relativeFromTest:` 的**值**。
 *
 * ⚠ 剔的是**那个属性的值**，不是整行。整行跳过在契约册里会漏判：
 * `{ surface: "…", file: "apps/…/battery.ts", binding: "…" }` 写在**同一行**上，
 * 整行跳过 ⇒ 同一行里真正上屏的 `surface` / `downstream` 文案也一起免检了。
 */
const FINGERPRINT_PROP = /\b(file|relativeFromTest)\s*:\s*(["'`])(?:\\.|(?!\2).)*\2/g;
const stripFingerprints = (line: string): string => line.replace(FINGERPRINT_PROP, "");

/** 逐行扫一棵已剥注释的树，返回 `文件:行号 → 命中串`。 */
function coordLines(tree: CodeTree): string[] {
  const out: string[] = [];
  for (const [file, code] of tree) {
    if (file.includes("/src/mocks/")) continue;
    code.split("\n").forEach((raw, i) => {
      const line = stripFingerprints(raw);
      const m = line.match(COORD_RE) ?? stringLiterals(line).match(BARE_FILE_RE);
      if (m) out.push(`${file}:${i + 1} → ${m[0]}`);
    });
  }
  return out;
}

describe("R-UI-4 · 源码坐标不得渲染到用户屏上", () => {
  const tree = checkedTree("apps/frontend-shell/src", "evidence", 200);

  it("§0 金丝雀：尺子对一段已知含坐标的文本必须命中，对纯注释必须不中", () => {
    const known = "apps/datacore/src/sim/propagation.ts:73";
    expect(COORD_RE.test(known), "金丝雀①：已知必中的源码坐标零命中 ⇒ 尺子坏了，本文件一切否定结论作废").toBe(true);
    expect(COORD_RE.test("求解器 capacity_rollup · 规则 C18.cashFloor"), "金丝雀②：业务标识被误判成源码坐标").toBe(false);
    // 金丝雀①b：**裸文件名**这一档 —— 真浏览器抓到的 17 处里有 8 处是这种形态，
    // 少了这一档，下面所有「0 处」都只是「我这把尺看不见」。走的是与 §1/§2/§3 同一个 coordLines()。
    expect(coordLines([["c.ts", `const s = "由 synthetic/cadence.ts 推导";`]]).length, "金丝雀①b：带目录的裸文件名漏网").toBe(1);
    expect(coordLines([["c.ts", `const s = "型号→基地映射（battery.ts）";`]]).length, "金丝雀①b：光秃秃的裸文件名漏网").toBe(1);
    // 反例②b：**串外**的 `.ts` 是属性名不是文件名（本仓真有 `this.ts` / `p.ts.slice(0,10)`）。
    expect(coordLines([["c.ts", "this.ts = deps.ts ?? this.ts;"]]), "金丝雀②b：成员访问被误判成文件名").toEqual([]);
    expect(coordLines([["c.ts", "const d = p.ts.slice(0, 10);"]]), "金丝雀②b：成员访问被误判成文件名").toEqual([]);
    // 反例②c：模板串的 `${…}` 插值段里是代码，不是上屏文案。
    expect(coordLines([["c.ts", "const s = `第 ${p.ts} 天`;"]]), "金丝雀②c：插值段被当成文案").toEqual([]);
    expect(coordLines([["c.ts", `const s = "参数版本 v2.1 · Quote.marginPct < Quote.floorPct";`]]), "金丝雀②d：业务标识被误判").toEqual([]);
    // 金丝雀②e / ①c：门用指纹 `file:` 的值免检，但**同一行**上屏的 `surface`/`downstream` 文案照查。
    const fp = `{ surface: "DataCore · 合成种子", file: "apps/datacore/src/synthetic/battery.ts", binding: "BASES" },`;
    expect(coordLines([["c.ts", fp]]), "金丝雀②e：门用指纹 file: 的值应免检").toEqual([]);
    expect(
      coordLines([["c.ts", fp.replace("DataCore · 合成种子", "见 battery.ts")]]).length,
      "金丝雀①c：整行跳过会连同一行上屏文案一起免检 ⇒ 指纹必须按属性剔、不按行跳",
    ).toBe(1);
    // 注释里提一嘴不算上屏：剥注释管线活着才允许报 0。
    expect(factHits(commentOnlyCanary(known), known), "金丝雀③：注释被当成了代码 ⇒ stripComments 坏了").toEqual([]);
    // 尺子必须能在真代码里抓到它 —— 否则 §1 的绿只是「什么都没扫」。
    expect(coordLines([["canary.ts", stripComments(`const e = "证据：${known}";\n`)]]).length).toBe(1);
  });

  it("§1 前端可执行代码里不得有源码坐标形态的串（mocks 与门用指纹行除外）", () => {
    const hits = coordLines(tree);
    expect(hits, `R-UI-4 违规：这些串会随载荷/文案渲染到屏上。修法是换成业务标识（契约名 / 对象类型.属性 / 求解器 key / 规则 key），不是删空：\n${hits.join("\n")}`).toEqual([]);
  });

  /**
   * §2 后端载荷侧。**这一节是被真浏览器逼出来的，不是补全强迫症**：
   * 92 条导航可达路由扫完，前端侧已归零，仍有 2 处坐标上屏
   * （`/admin/connections/<synthetic>/schema` 印 `schedule.ts:216` · `engine.ts:640`）——
   * 源头在后端 `CADENCE_NODES` 的 `note` / `probed`，这些串**原样下发**、前端只负责渲染。
   * ⇒ 只守前端的门，对这条路径是**结构性瞎的**。
   *
   * 扫描面取 `apps/datacore/src/synthetic` 整个目录而非单文件：合成数据模块的
   * `note` / `probed` / `evidence` 串是**产品载荷**（用户屏上的溯源层），不是内部日志；
   * 按目录守才对新增的同类文件照样生效，按文件白名单守则一加文件就漏。
   */
  const backend = checkedTree("apps/datacore/src/synthetic", "CADENCE_NODES", 10);

  it("§2 后端合成数据载荷（note/probed/evidence 原样下发上屏）里不得有源码坐标", () => {
    const hits = coordLines(backend);
    expect(hits, `R-UI-4 违规（后端载荷侧）：这些串会随 API 响应原样打到用户屏上。换成业务标识（调度作业 key / 出厂配置项 / 求解器册 / 对象类型.属性 / 种子集合名），不是删空：\n${hits.join("\n")}`).toEqual([]);
  });

  /**
   * §3 **逐字透传上屏的后端诊断载荷**。§2 只守合成数据那一棵树，而 2026-09-06 真浏览器实测
   * 抓到的 17 处里有 **12 处**根本不在那棵树上 —— 它们来自「缺席行 / 缺口说明」这一族字段，
   * 前端**明写不改写、不截断、不概括**地原样渲染：
   *
   *  | 后端产地 | 上屏渲染点 | 实测页 |
   *  |---|---|---|
   *  | `solvers/chain-loss.ts` `STRUCTURAL_GAPS.reason/probe` → `empty[]` | `InspectorNodePanel`「取证：」· `ChainLineMapView` 悬停「取证：」· `SandboxConsole`「探针：」 | `/v/chain-line-map` 8 处 |
   *  | `ontology/slice-layers.ts` `absentReason` | 切片分层面板 | `/v/process-wait` 3 处 |
   *  | `decision/causal-graph.ts` 段落 `missing/needs` | 沙盘诊断区 | `/v/sim-sandbox` 1 处 |
   *
   * 按**整文件**守而不是按字段名守：这一族字段是多行 `+` 拼串，按字段名切会漏掉续行；
   * 而这三个文件本来就是「诊断文案的产地」，整棵守对新增的同类文案照样生效。
   */
  /**
   * 单文件扫描面。`checkedTree` 走的是 `readdirSync`（只吃目录），而这三份是**点名的单文件** ——
   * 整个 `solvers/` / `ontology/` 目录里绝大多数串不上屏，整棵扫会把门变成噪声。
   * 每份都自带「已知必中」金丝雀：抽不到那个锚点串 ⇒ 报「工具坏了」，不许报「干净」。
   */
  const checkedFile = (rel: string, knownHit: string): CodeTree => {
    const code = stripComments(readRepo(rel));
    expect(code.includes(knownHit), `扫描面塌了：${rel} 里抽不到锚点「${knownHit}」⇒ 文件改名/搬家/被摘，本节否定结论作废`).toBe(true);
    return [[rel, code]];
  };
  const diagnostics: CodeTree = [
    ...checkedFile("apps/datacore/src/solvers/chain-loss.ts", "STRUCTURAL_GAPS"),
    ...checkedFile("apps/datacore/src/ontology/slice-layers.ts", "absentReason"),
    ...checkedFile("apps/datacore/src/decision/causal-graph.ts", "NO_SOURCE_WIRED"),
    // 契约册的 `BOUNDARY_IMPACT.downstream[]` 直接上 `/admin/boundary` 的「下游受影响面」。
    // ⚠ **这一份是变异反证逼出来的**：把 `battery.ts` 重新注回去，门**照样全绿** ——
    // §1 只扫前端、§2 只扫合成数据树，`packages/contracts/src` 一棵都没扫，
    // 于是我刚在 `/admin/boundary` 上真删掉的两处，门根本没资格说它们不会回潮。
    // 形态：**「我用『门绿了』当作『这处改动被守住了』的证据，而那处根本不在扫描面里。」**
    // （`consumers[].file` 是门用指纹、由 FINGERPRINT_LINE 排除，与上屏的 `surface`/`downstream` 分属两栏。）
    ...checkedFile("packages/contracts/src/base-registry.ts", "BOUNDARY_IMPACT"),
  ];

  it("§3 逐字透传上屏的诊断载荷（缺席行 reason/probe · absentReason · 段落 missing/needs）里不得有源码坐标", () => {
    const hits = coordLines(diagnostics);
    expect(hits, `R-UI-4 违规（诊断载荷侧·前端逐字透传）：这些串会原样打到用户屏上。换成业务标识（对象类型.属性 / 规则 key / 求解器 key / 端点 / 条数），不是删空 —— 铁律 1.5 判据二要求溯源层给得出业务事实：\n${hits.join("\n")}`).toEqual([]);
  });
});
