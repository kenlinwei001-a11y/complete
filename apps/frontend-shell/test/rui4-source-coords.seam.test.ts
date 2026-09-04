import { describe, expect, it } from "vitest";
import { checkedTree, commentOnlyCanary, factHits, stripComments, type CodeTree } from "./factlock";

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

/** 唯一一份尺子 —— 金丝雀与主判据共用它，不许各抄一份正则（抄了就是装饰品）。 */
const COORD_RE =
  /(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs):\d+/;

/** 门用指纹属性行（不上屏）。 */
const FINGERPRINT_LINE = /^\s*(file|relativeFromTest)\s*:/;

/** 逐行扫一棵已剥注释的树，返回 `文件:行号 → 命中串`。 */
function coordLines(tree: CodeTree): string[] {
  const out: string[] = [];
  for (const [file, code] of tree) {
    if (file.includes("/src/mocks/")) continue;
    code.split("\n").forEach((line, i) => {
      if (FINGERPRINT_LINE.test(line)) return;
      const m = line.match(COORD_RE);
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
});
