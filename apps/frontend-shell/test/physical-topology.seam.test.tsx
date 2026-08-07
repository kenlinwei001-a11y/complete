import { WORKSHOP_REGISTRY, EQUIPMENT_TYPE_BY_PROCESS } from "@platform/contracts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * WO-SANDBOX-F3 · 物理拓扑视图 —— SEAM + 诚实性 + 三色系 + 缩放数学 + 定时器纪律。
 *
 * ── SEAM 的咬点（"证明是派生不是手抄"）─────────────────────────────────────
 *  ① 基地轴：`vi.mock` 换掉 `@platform/contracts` 的 `BASE_REGISTRY` → 渲染出的行必须跟着变。
 *     变异反证：把 physicalTopology.ts 的 `BASE_REGISTRY.map(...)` 换成内联 13 元素数组 →
 *     mock 失效 → 本组用例全红（已亲手跑过，原文见交付说明）。
 *  ② 工序轴：跨 app 不许 import 源码（contracts-only-shared），所以工序链在前端是**镜像**；
 *     本文件读 `apps/datacore/src/synthetic/battery.ts` 源文件逐条比对，改了源不改镜像 → 红。
 *     这条门把"手抄"降级成"受门守护的镜像"，不假装它是 import。
 */

// vi.mock 工厂在 import 之前执行，普通 const 会 TDZ → 用 vi.hoisted 提升这只可变盒子。
const holder = vi.hoisted(() => ({ bases: [] as Record<string, unknown>[], real: [] as Record<string, unknown>[] }));

vi.mock("@platform/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/contracts")>();
  if (holder.real.length === 0) {
    holder.real = actual.BASE_REGISTRY as unknown as Record<string, unknown>[];
    holder.bases.push(...holder.real);
  }
  return { ...actual, BASE_REGISTRY: holder.bases };
});

// 被测模块在 mock 之后 import（vitest 会保证 mock 先生效）。
import { HINT_MS, PhysicalTopologyView } from "@/views/sim/PhysicalTopologyView";
import {
  buildTopology,
  fitTransform,
  heatBand,
  PROCESS_CHAIN,
  PROCESS_BY_EQUIPMENT_TYPE,
  resolveBottleneck,
  SEGMENTS,
  zoomAt,
  ZOOM_LIMITS,
  __mirrors,
} from "@/views/sim/physicalTopology";

/** 把注入的基地册换成任意集合（in-place，保持 mock 的引用同一性）。 */
function injectBases(rows: Record<string, unknown>[]): void {
  holder.bases.splice(0, holder.bases.length, ...rows);
}
function restoreBases(): void {
  holder.bases.splice(0, holder.bases.length, ...holder.real);
}

const fakeBase = (o: Partial<Record<string, unknown>> & { baseId: string; name: string }) => ({
  kind: "动力",
  position: "动力",
  lon: 0,
  lat: 0,
  util: 61,
  gwh: 12.5,
  bottleneck: "化成柜",
  lines: 4,
  prodYear: 2024,
  mainProduct: "TEST-LFP",
  ...o,
});

/**
 * 仓根 = 自**本测试文件**向上第一个含 pnpm-workspace.yaml 的目录。
 * ⚠ 这里刻意**不用 `process.cwd()`**：cwd 是启动 vitest 的那个 shell 的目录，隔离 worktree 里跑时
 * 它仍指向主 checkout —— 曾据此读错文件，导致「改了 battery.ts，source-parity 门却全绿」的假绿
 * （本单变异反证②当场抓到）。改成从 import.meta.url 起步，门才咬在自己那份源码上。
 */
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[physical-topology.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

afterEach(() => {
  restoreBases();
  document.documentElement.removeAttribute("data-theme");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM：基地轴真派生自 BASE_REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 基地轴派生自 BASE_REGISTRY（改册 → 视图跟着变）", () => {
  it("真册基线：13 个基地（不是 12），逐个 baseId 都渲染出一行", () => {
    const names = holder.real.map((b) => b.name as string);
    expect(holder.real).toHaveLength(13);
    expect(names).toEqual(["常州", "厦门", "成都", "眉山", "武汉", "江门", "合肥", "信阳", "枣庄", "邯郸", "自贡", "金华", "扬州"]);

    render(<PhysicalTopologyView />);
    for (const b of holder.real) {
      expect(screen.getByTestId(`phys-topo-row-${b.baseId as string}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("row")).toHaveLength(13);
  });

  it("注入 3 个虚构基地 → 视图只剩这 3 行、格数 = 3×工序数（内联数组会让本例红）", () => {
    injectBases([
      fakeBase({ baseId: "seam-alpha", name: "接缝甲", util: 51 }),
      fakeBase({ baseId: "seam-beta", name: "接缝乙", util: 77, bottleneck: "涂布机" }),
      fakeBase({ baseId: "seam-gamma", name: "接缝丙", util: 93, bottleneck: "老化库" }),
    ]);
    render(<PhysicalTopologyView />);

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByTestId("phys-topo-row-seam-alpha")).toBeInTheDocument();
    expect(screen.getByText("接缝乙")).toBeInTheDocument();
    // 真册里的基地一个都不该出现（内联回潮 = 这里立刻红）
    expect(screen.queryByTestId("phys-topo-row-changzhou")).toBeNull();
    expect(screen.queryByText("常州")).toBeNull();
    expect(screen.getAllByRole("gridcell")).toHaveLength(3 * PROCESS_CHAIN.length);
  });

  it("改册字段（util / bottleneck）→ 行首真值与瓶颈定位同步变", () => {
    injectBases([fakeBase({ baseId: "seam-only", name: "唯一基地", util: 42, gwh: 7.25, lines: 3, bottleneck: "分切机" })]);
    render(<PhysicalTopologyView />);

    const head = screen.getByTestId("phys-topo-rowhead-seam-only");
    expect(head).toHaveTextContent("利用率 42%");
    expect(head).toHaveTextContent("7.25GWh");
    expect(head).toHaveTextContent("3 线");
    // 瓶颈落在「分切机」→ 定位到 slitting 列，那一格 data-bottleneck=1，其余为 0
    expect(screen.getByTestId("phys-topo-cell-seam-only-slitting")).toHaveAttribute("data-bottleneck", "1");
    expect(screen.getByTestId("phys-topo-cell-seam-only-coating")).toHaveAttribute("data-bottleneck", "0");
  });

  it("册长为 0（极端注入）→ 0 行 0 格，不造假行", () => {
    injectBases([]);
    render(<PhysicalTopologyView />);
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.queryAllByRole("gridcell")).toHaveLength(0);
    expect(screen.getByTestId("phys-topo-placeholder-banner")).toBeInTheDocument();
  });

  it("buildTopology 也走同一册（纯派生层与视图层同源）", () => {
    injectBases([fakeBase({ baseId: "only-one", name: "独苗" })]);
    const m = buildTopology(42);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.base.baseId).toBe("only-one");
    expect(m.stats.cellCount).toBe(PROCESS_CHAIN.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SEAM：工序轴镜像 datacore 合成种子（source-parity 门）
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM · 工序轴与设备型表**从 contracts 单源派生**（再内联一次 → 红）", () => {
  const src = readRepo("apps/datacore/src/synthetic/battery.ts");

  // 并线记录（审核方）：本块原为「镜像 vs 源文件逐条比对」。debattery:check 判红后，
  // 工序表与设备型表已上提 packages/contracts（WORKSHOP_REGISTRY / EQUIPMENT_TYPE_BY_PROCESS），
  // 两侧改为派生 —— 镜像消失，比对门失去对象。
  // **没有删测试变绿**（那是本体明令禁止的），而是换成更强的断言：
  // 旧门只保证「漂了能发现」，新门保证「**结构上不可能有第二份**」。

  it("前端工序链 === contracts 单源（顺序即工艺链·10 道）", () => {
    expect(WORKSHOP_REGISTRY).toHaveLength(10);
    expect(__mirrors.workshopDefs).toEqual(
      WORKSHOP_REGISTRY.map((w) => ({ type: w.type, suffix: w.suffix })),
    );
    expect(PROCESS_CHAIN.map((p) => p.name)).toEqual(WORKSHOP_REGISTRY.map((w) => w.type));
  });

  it("datacore 侧也从同一单源派生（不是各写一份）", () => {
    expect(
      /const WORKSHOP_DEFS = WORKSHOP_REGISTRY\.map\(/.test(src),
      "battery.ts 的 WORKSHOP_DEFS 不再从 WORKSHOP_REGISTRY 派生 —— 有人把它内联回去了",
    ).toBe(true);
    expect(
      /const typeMap: Record<string, string> = EQUIPMENT_TYPE_BY_PROCESS;/.test(src),
      "battery.ts 的 typeMap 不再从 EQUIPMENT_TYPE_BY_PROCESS 派生 —— 有人把它内联回去了",
    ).toBe(true);
  });

  it("前端设备型表 === contracts 单源（键集刻意与工序链不同，勿对齐）", () => {
    expect(__mirrors.equipmentTypeByProcess).toEqual({ ...EQUIPMENT_TYPE_BY_PROCESS });
    // 这两套是 Workshop 层与 Process 层两个口径：有 aging，无 slurry/grading。
    // 差异是真实的建模事实，不是笔误 —— 「老化库」瓶颈因此在工序矩阵定位不到列，标 EMPTY 而非硬塞一列。
    expect(Object.keys(EQUIPMENT_TYPE_BY_PROCESS)).toContain("aging");
    expect(Object.keys(EQUIPMENT_TYPE_BY_PROCESS)).not.toContain("slurry");
    expect(Object.keys(EQUIPMENT_TYPE_BY_PROCESS)).not.toContain("grading");
  });

  it("四段覆盖工序链全集且不重不漏；段序 = 工艺序", () => {
    const all = SEGMENTS.flatMap((s) => s.members);
    expect([...all].sort()).toEqual([...PROCESS_CHAIN.map((p) => p.suffix)].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(SEGMENTS.map((s) => s.label)).toEqual(["前道·电极", "中道·装配", "后道·电化学", "后道·成组"]);
    // 段内工序在链上必须连续（段带 colSpan 才有意义）
    let cursor = 0;
    for (const seg of SEGMENTS) {
      const slice = PROCESS_CHAIN.slice(cursor, cursor + seg.members.length).map((p) => p.suffix);
      expect(slice).toEqual(seg.members);
      cursor += seg.members.length;
    }
  });

  it("视图列头 = 工序链（含设备型；链上有而 typeMap 无的工序显 —，不编设备型）", () => {
    render(<PhysicalTopologyView />);
    for (const p of PROCESS_CHAIN) {
      const col = screen.getByTestId(`phys-topo-col-${p.suffix}`);
      expect(col).toHaveTextContent(p.name);
    }
    // 制浆 / 分容 在 battery.ts typeMap 里没有条目 → 显 "—"
    expect(PROCESS_CHAIN.find((p) => p.suffix === "slurry")!.equipmentType).toBeNull();
    expect(PROCESS_CHAIN.find((p) => p.suffix === "grading")!.equipmentType).toBeNull();
    expect(within(screen.getByTestId("phys-topo-col-slurry")).getByText(/—/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 诚实性：占位显式标注 / EMPTY 不补 0 / 真值与占位分层
// ═══════════════════════════════════════════════════════════════════════════════
describe("诚实性 · 占位值不冒充实测，算不出来标 EMPTY", () => {
  it("常驻横幅明说占位 + 列出接真值入口（三个已存在的对象/求解器）", () => {
    render(<PhysicalTopologyView />);
    const banner = screen.getByTestId("phys-topo-placeholder-banner");
    expect(banner).toHaveTextContent("格内数值为占位值（未接真实数据）");
    expect(banner).toHaveTextContent("不是实测");
    expect(banner).toHaveTextContent("EMPTY");
    const entries = screen.getByTestId("phys-topo-entrypoints");
    expect(within(entries).getByText("capacity_rollup")).toBeInTheDocument();
    expect(within(entries).getByText("bottleneck_matrix")).toBeInTheDocument();
    expect(within(entries).getByText("EquipmentOEE")).toBeInTheDocument();
  });

  it("每一格都带「占位」角标（不存在没标注的格）", () => {
    injectBases([fakeBase({ baseId: "b1", name: "甲" }), fakeBase({ baseId: "b2", name: "乙" })]);
    render(<PhysicalTopologyView />);
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(2 * PROCESS_CHAIN.length);
    for (const c of cells) {
      expect(c).toHaveAttribute("data-provenance", "placeholder");
      expect(c).toHaveTextContent("占位");
    }
  });

  it("节拍无数据源 → 详情面板显 EMPTY 且 value===null（不补 0、不给假默认）", async () => {
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "b1", name: "甲" })]);
    render(<PhysicalTopologyView />);
    await user.hover(screen.getByTestId("phys-topo-cell-b1-coating"));

    const takt = screen.getByTestId("phys-topo-detail-takt");
    expect(takt).toHaveAttribute("data-provenance", "empty");
    expect(takt).toHaveTextContent("EMPTY");
    expect(takt).not.toHaveTextContent(/\b0\s*s\/电芯/);
    expect(takt).toHaveTextContent(/无 Equipment\.ctSeconds 接口/);

    // 派生层同口径：takt.value 必须是 null，不是 0
    const m = buildTopology(42);
    for (const row of m.rows) for (const c of row.cells) expect(c.takt.value).toBeNull();
  });

  it("详情面板逐项区分来源：格内 = 占位·未接真值；基地级 = 真值·基地册", async () => {
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "b1", name: "甲", util: 66 })]);
    render(<PhysicalTopologyView />);
    await user.hover(screen.getByTestId("phys-topo-cell-b1-winding"));

    expect(screen.getByTestId("phys-topo-detail-util")).toHaveAttribute("data-provenance", "placeholder");
    expect(screen.getByTestId("phys-topo-detail-oee")).toHaveAttribute("data-provenance", "placeholder");
    expect(screen.getByTestId("phys-topo-detail-wip")).toHaveAttribute("data-provenance", "placeholder");
    expect(screen.getByTestId("phys-topo-detail-base-util")).toHaveAttribute("data-provenance", "registry");
    expect(screen.getByTestId("phys-topo-detail-base-util")).toHaveTextContent("66 %");
    expect(screen.getByTestId("phys-topo-detail-base-util")).toHaveTextContent("真值·基地册");
    expect(screen.getByTestId("phys-topo-detail-util")).toHaveTextContent("占位·未接真值");
  });

  it("瓶颈设备型定位不到工序列（老化库）→ 明说定位不到，不挑一列点亮", async () => {
    const user = userEvent.setup();
    // 真册里成都/江门/邯郸 三个基地的瓶颈就是「老化库」，而十车间链上没有老化车间
    const aging = holder.real.filter((b) => b.bottleneck === "老化库");
    expect(aging.length).toBeGreaterThan(0);
    expect(PROCESS_BY_EQUIPMENT_TYPE["老化库"]).toBeUndefined();
    expect(resolveBottleneck("老化库").processSuffix).toBeNull();
    expect(resolveBottleneck("老化库").reason).toMatch(/无对应列/);

    render(<PhysicalTopologyView />);
    const target = aging[0]!;
    const bn = screen.getByTestId(`phys-topo-bn-${target.baseId as string}`);
    expect(bn).toHaveAttribute("data-located", "0");
    expect(bn).toHaveTextContent("本图定位不到列");
    // 该基地整行没有任何一格被标成瓶颈（没有"猜一个"）
    const row = screen.getByTestId(`phys-topo-row-${target.baseId as string}`);
    expect(within(row).queryAllByRole("gridcell").filter((c) => c.getAttribute("data-bottleneck") === "1")).toHaveLength(0);

    await user.hover(within(row).getAllByRole("gridcell")[0]!);
    expect(screen.getByTestId("phys-topo-detail-bn-unlocated")).toHaveTextContent(/无对应列/);
  });

  it("占位值确定性（R6）：同 seed 字节一致；换 seed 必变", () => {
    const a = JSON.stringify(buildTopology(42));
    const b = JSON.stringify(buildTopology(42));
    const c = JSON.stringify(buildTopology(7));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("热力分档：EMPTY 走 empty 档，不被涂成「低载」", () => {
    expect(heatBand({ value: null, provenance: "empty", unit: "%" })).toBe("empty");
    expect(heatBand({ value: 95, provenance: "placeholder", unit: "%" })).toBe("over");
    expect(heatBand({ value: 85, provenance: "placeholder", unit: "%" })).toBe("tight");
    expect(heatBand({ value: 70, provenance: "placeholder", unit: "%" })).toBe("normal");
    expect(heatBand({ value: 55, provenance: "placeholder", unit: "%" })).toBe("idle");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 三色系：零硬编码颜色 + 用到的 token 必须在 :root 定义（三套主题共同继承）
// ═══════════════════════════════════════════════════════════════════════════════
describe("三色系 · dark / light / warm 全过", () => {
  const cssPath = "apps/frontend-shell/src/views/sim/PhysicalTopologyView.module.css";
  const tsxPath = "apps/frontend-shell/src/views/sim/PhysicalTopologyView.tsx";
  const tsPath = "apps/frontend-shell/src/views/sim/physicalTopology.ts";
  const css = readRepo(cssPath);
  const tsx = readRepo(tsxPath);
  const ts = readRepo(tsPath);
  const tokens = readRepo("apps/frontend-shell/src/styles/tokens.css");

  /** tokens.css 的 `:root { … }` 首块 = 三套主题共同继承的基座。 */
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("组件与样式里零硬编码颜色（hex / rgb / hsl / 具名色）", () => {
    // 允许的非 token 颜色关键字：transparent / currentColor / inherit / none（不是配色决策）
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `样式里出现硬编码 hex：${hex.join(", ")}`).toEqual([]);
    const fn = css.match(/\b(rgba?|hsla?)\s*\(/g) ?? [];
    expect(fn, `样式里出现硬编码 ${fn.join(", ")}`).toEqual([]);
    // 组件源码（含内联 style）不许出现颜色字面量
    for (const [name, src] of [["tsx", tsx], ["ts", ts]] as const) {
      expect(src.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${name} 里出现硬编码 hex`).toEqual([]);
      expect(src.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${name} 里出现硬编码 rgb/hsl`).toEqual([]);
    }
  });

  it("样式里用到的每个 CSS 变量都定义在 tokens.css 的 :root（否则某套主题下取不到值）", () => {
    const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, ""); // 注释里的示例 var(--token) 不参与判定
    const used = new Set([...cssNoComment.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    const missing = [...used].filter((t) => !rootTokens.has(t));
    expect(missing, `这些 token 不在 :root（只在某个 data-theme 分支里定义 → 其它主题下失效）：${missing.join(", ")}`).toEqual([]);
  });

  it("三套主题下都能渲染出完整矩阵（dark 无属性 / light / warm）", () => {
    injectBases([fakeBase({ baseId: "t1", name: "主题基地" })]);
    for (const theme of [null, "light", "warm"] as const) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = render(<PhysicalTopologyView />);
      expect(screen.getByTestId("phys-topo")).toBeInTheDocument();
      expect(screen.getAllByRole("gridcell")).toHaveLength(PROCESS_CHAIN.length);
      expect(screen.getByTestId("phys-topo-placeholder-banner")).toBeInTheDocument();
      // 语义档位在三套皮下同键（theme-invariant），前端只写 data-band，配色由 token 决定
      expect(screen.getByTestId("phys-topo-legend-over")).toBeInTheDocument();
      unmount();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 缩放 / 平移
// ═══════════════════════════════════════════════════════════════════════════════
describe("缩放 / 平移", () => {
  it("zoomAt：光标下的内容点缩放前后停在同一屏幕位置", () => {
    const t0 = { k: 1, x: 0, y: 0 };
    const [cx, cy] = [300, 120];
    const u = { x: (cx - t0.x) / t0.k, y: (cy - t0.y) / t0.k };
    const t1 = zoomAt(t0, cx, cy, 1.2);
    expect(t1.k).toBeCloseTo(1.2, 6);
    expect(u.x * t1.k + t1.x).toBeCloseTo(cx, 6);
    expect(u.y * t1.k + t1.y).toBeCloseTo(cy, 6);
    // 连续缩放仍保持锚点
    const t2 = zoomAt(t1, cx, cy, 1.2);
    expect(u.x * t2.k + t2.x).toBeCloseTo(cx, 6);
  });

  it("zoomAt 夹到上下限；触限后返回原状态（不做无效重排）", () => {
    let t = { k: 1, x: 0, y: 0 };
    for (let i = 0; i < 40; i++) t = zoomAt(t, 100, 100, 1.2);
    expect(t.k).toBeCloseTo(ZOOM_LIMITS.max, 6);
    const same = zoomAt(t, 100, 100, 1.2);
    expect(same).toBe(t);
    for (let i = 0; i < 60; i++) t = zoomAt(t, 100, 100, 1 / 1.2);
    expect(t.k).toBeCloseTo(ZOOM_LIMITS.min, 6);
  });

  it("fitTransform：可测 → 居中铺满；不可测（jsdom rect=0）→ 退回 1.00× 并诚实标 measured=false", () => {
    const ok = fitTransform(800, 400, 1600, 800);
    expect(ok.measured).toBe(true);
    expect(ok.transform.k).toBeCloseTo(0.5, 6);
    expect(ok.transform.x).toBeCloseTo(0, 6);
    const bad = fitTransform(0, 0, 1600, 800);
    expect(bad.measured).toBe(false);
    expect(bad.transform).toEqual({ k: 1, x: 0, y: 0 });
    expect(Number.isFinite(bad.transform.k)).toBe(true); // 0 除不许漏成 Infinity
  });

  it("按钮 ＋ / － 改变缩放读数", async () => {
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "z1", name: "缩放" })]);
    render(<PhysicalTopologyView />);
    const canvas = screen.getByTestId("phys-topo-canvas");
    expect(canvas).toHaveAttribute("data-zoom", "1.00");

    await user.click(screen.getByTestId("phys-topo-zoom-in"));
    expect(canvas).toHaveAttribute("data-zoom", "1.20");
    expect(screen.getByTestId("phys-topo-zoom-readout")).toHaveTextContent("1.20×");

    await user.click(screen.getByTestId("phys-topo-zoom-out"));
    expect(canvas).toHaveAttribute("data-zoom", "1.00");
  });

  it("快捷键 + / - / 0（画布获焦后生效）", async () => {
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "k1", name: "快捷" })]);
    render(<PhysicalTopologyView />);
    const canvas = screen.getByTestId("phys-topo-canvas");
    canvas.focus();

    await user.keyboard("+");
    expect(canvas).toHaveAttribute("data-zoom", "1.20");
    await user.keyboard("+");
    expect(canvas).toHaveAttribute("data-zoom", "1.44");
    await user.keyboard("-");
    expect(canvas).toHaveAttribute("data-zoom", "1.20");
    await user.keyboard("0"); // 适应画布（jsdom 不可测 → 复位 1.00 且给出诚实提示）
    expect(canvas).toHaveAttribute("data-zoom", "1.00");
    expect(screen.getByTestId("phys-topo-hint")).toHaveTextContent("画布尺寸不可测");
  });

  it("拖拽平移：pointer 位移直接落到 translate", async () => {
    // 用 user-event 的 pointer API（它会造出带 button/clientX 的完整指针事件；
    // jsdom 没有 PointerEvent，裸 fireEvent.pointerDown 造出来的事件连 button 都没有 → 不能用它测主键拖拽）。
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "p1", name: "平移" })]);
    render(<PhysicalTopologyView />);
    const canvas = screen.getByTestId("phys-topo-canvas");

    await user.pointer([
      { keys: "[MouseLeft>]", target: canvas, coords: { clientX: 100, clientY: 100 } },
      { target: canvas, coords: { clientX: 160, clientY: 130 } },
    ]);
    expect(canvas).toHaveAttribute("data-pan-x", "60");
    expect(canvas).toHaveAttribute("data-pan-y", "30");

    await user.pointer([{ keys: "[/MouseLeft]", target: canvas, coords: { clientX: 160, clientY: 130 } }]);
    await user.pointer([{ target: canvas, coords: { clientX: 400, clientY: 400 } }]);
    expect(canvas).toHaveAttribute("data-pan-x", "60"); // 抬起后不再跟手
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 定时器纪律（覆盖 ref 前先 clear · 卸载清）
// ═══════════════════════════════════════════════════════════════════════════════
describe("定时器纪律 · 提示条", () => {
  beforeEach(() => {
    injectBases([fakeBase({ baseId: "tm", name: "定时" })]);
  });

  it("连点适应画布：ref 被覆盖前先 clear，不留孤儿句柄（leakGuard 在 afterEach 收割）", async () => {
    const user = userEvent.setup();
    render(<PhysicalTopologyView />);
    const fit = screen.getByTestId("phys-topo-fit");
    await user.click(fit);
    await user.click(fit);
    await user.click(fit);
    expect(screen.getByTestId("phys-topo-hint")).toBeInTheDocument();
    // 本用例结束时 setup.ts 的 leakGuard 会断言进程里没有 app 侧存活定时器；
    // 若 flashHint 覆盖 ref 前漏了 clearTimeout，这里就会红。
  });

  /**
   * ⚠ 本例是欠账 #120 的原发处：同一 commit、零代码改动，gate 首跑红、随后 4 次全绿。
   *   已在本机复现原红（负载 ~25 下 40 次连跑中 1 次红，报错原文与 gate 完全一致：
   *   `physical-topology.seam.test.tsx:495 · expected <div class="_hint_b31b9a" …> to be null`）。
   *
   * ── 旧写法为什么是不确定判据（两条独立的病，实测取证，非推理）───────────────────
   * 旧：`vi.useFakeTimers({ shouldAdvanceTime: true })` + `await vi.advanceTimersByTimeAsync(2000)`。
   *  ① **`shouldAdvanceTime: true` = 在测试之外挂了一条真实时钟。**
   *     读 vitest 内联的 `@sinonjs/fake-timers`：该选项在 hijack **之前**用**真** `setInterval`
   *     注册一条 20ms 的定时器，回调是同步的 `clock.tick(20)`。
   *     实测：装上假时钟后只等真实 2500ms（测试一次 advance 都不调），假时钟自己走了 2420ms，
   *     `phys-topo-hint` 自己就消隐了、`getTimerCount()` 归零。
   *     ⇒ 「谁烧掉 app 那个句柄」不由本用例决定，由机器忙不忙决定。
   *  ② **`advanceTimersByTimeAsync` 不在 `act()` 里。**
   *     定时器回调里的 `setHint(null)` 何时落到 DOM，靠的是 React 异步刷新与 sinon 内部
   *     「烧完一个定时器就让出一个宏任务」之间的**顺风车**，本用例从未显式驱动它。
   *     实测：同步 tick 之后**同一个同步块内** DOM 仍是旧的（`getTimerCount()` 已 1→0，
   *     但 `phys-topo-hint` 还在），要跨一个任务边界才刷新。
   *  ①×② 合起来：只要那条真实 interval 在「`advanceTimersByTimeAsync` 已排好自己的宏任务、
   *  但还没跑」这个窗口里替测试烧掉句柄，`doTick` 就发现区间内无定时器可烧 → 不再让出宏任务
   *  → 直接 resolve，断言便落在 DOM 尚未刷新的那一瞬 ⇒ 「该消隐的提示条还在」。
   *  这也解释了为什么它**不跟负载单调相关**（红那次负载反而更低）：它咬的是一个窗口的相位，
   *  不是一个时长的阈值 —— 所以"加大超时"这类改法一点用都没有。
   *
   * ── 新写法为什么消除了不确定性（逐条对上）─────────────────────────────────────
   *  ① `vi.useFakeTimers()` **不带 `shouldAdvanceTime`** ⇒ 进程里不存在那条真实 interval，
   *     假时钟**只可能**被本用例的 `advanceTimersByTime` 推动。没有第二个推动者 = 没有窗口可抢。
   *  ② 交互改 `fireEvent`（同步派发 + RTL 自带 `act` 包装），**不用 `userEvent`**：
   *     `userEvent` 的 `wait()` 走 `globalThis.setTimeout`，纯假时钟下推不动
   *     （实测：`await user.click(...)` 直接挂到 20s 超时）—— 用它就必须把 `shouldAdvanceTime`
   *     请回来，等于把病根请回来。这不是洁癖，是二选一。
   *  ③ 推进一律裹 `act()`：`act` 退出时 React **同步** flush 掉这次推进产生的全部更新，
   *     断言点看到的 DOM 必然是已刷新的 —— 不再依赖任何宏任务/微任务的先后。
   *  ⇒ 三条合起来，本例从头到尾**没有一个判据落在真实时钟上**：同一输入必然同一结果。
   *
   * ── 顺带把判据咬紧（旧写法证不到的）──────────────────────────────────────────
   *  旧的「推 2000ms 然后断言消隐」只证明「推得够久就消」，证不了「**到点**才消」——
   *  把 HINT_MS 改成 10ms 或 1500ms 它都照绿。新写法按 `HINT_MS-1` / `+1` 两步推，
   *  并咬死句柄计数 0→1→0→1→0：挂载不排、点一次恰好排一个、到点自注销、卸载带走。
   */
  it("提示条到点自动消隐，且卸载后不再有句柄存活", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<PhysicalTopologyView />);
      expect(vi.getTimerCount(), "挂载本身不该排定时器").toBe(0);

      fireEvent.click(screen.getByTestId("phys-topo-fit"));
      expect(screen.getByTestId("phys-topo-hint")).toBeInTheDocument();
      expect(vi.getTimerCount(), "点一次 = 恰好一个句柄").toBe(1);

      // 差 1ms 不消隐 —— 咬的是「到点」，不是「推进过就消」
      act(() => void vi.advanceTimersByTime(HINT_MS - 1));
      expect(screen.getByTestId("phys-topo-hint")).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.queryByTestId("phys-topo-hint")).toBeNull();
      expect(vi.getTimerCount(), "到点后句柄自注销").toBe(0);

      // 提示条还亮着就卸载 → 卸载清理必须把句柄带走
      fireEvent.click(screen.getByTestId("phys-topo-fit"));
      expect(screen.getByTestId("phys-topo-hint")).toBeInTheDocument();
      expect(vi.getTimerCount(), "卸载前确有一个活句柄（否则下面那条 0 是空过）").toBe(1);
      unmount();
      expect(vi.getTimerCount(), "卸载清理必须把句柄带走").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 悬停详情
// ═══════════════════════════════════════════════════════════════════════════════
describe("悬停出该工序详情", () => {
  it("悬停任一格 → 详情面板显示 基地·工序·段·序号；移开回到空态", async () => {
    const user = userEvent.setup();
    injectBases([fakeBase({ baseId: "h1", name: "悬停基地" })]);
    render(<PhysicalTopologyView />);
    expect(screen.getByTestId("phys-topo-detail-idle")).toBeInTheDocument();

    await user.hover(screen.getByTestId("phys-topo-cell-h1-formation"));
    const title = screen.getByTestId("phys-topo-detail-title");
    expect(title).toHaveTextContent("悬停基地");
    expect(title).toHaveTextContent("化成");
    expect(screen.getByTestId("phys-topo-detail")).toHaveTextContent("后道·电化学");
    expect(screen.getByTestId("phys-topo-detail")).toHaveTextContent("第 8 道");
    // 该基地瓶颈=化成柜 → 落在本格
    expect(screen.getByTestId("phys-topo-detail-bottleneck")).toBeInTheDocument();

    await user.unhover(screen.getByTestId("phys-topo-cell-h1-formation"));
    expect(screen.getByTestId("phys-topo-detail-idle")).toBeInTheDocument();
  });

  it("键盘 Tab 聚焦格子同样出详情（不只靠鼠标）", async () => {
    const { fireEvent } = await import("@testing-library/react");
    injectBases([fakeBase({ baseId: "h2", name: "键盘基地" })]);
    render(<PhysicalTopologyView />);
    const cell = screen.getByTestId("phys-topo-cell-h2-pack");
    cell.focus();
    // React 17+ 的 onFocus 挂在 focusin 上；jsdom 的 HTMLElement.focus() **不派发 focusin**
    // （真浏览器一定派发）→ 这里显式补一发，等价于真浏览器聚焦行为，而非绕过组件逻辑。
    fireEvent.focusIn(cell);
    expect(document.activeElement).toBe(cell);
    expect(screen.getByTestId("phys-topo-detail-title")).toHaveTextContent("PACK");
  });
});
