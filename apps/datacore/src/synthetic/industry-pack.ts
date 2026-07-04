import type { IndustryPack } from "@platform/contracts";
import { IndustryPackSchema } from "@platform/contracts";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { SOLVER_REGISTRY, type SolverDescriptor } from "../solvers/solver-registry.js";
// 电池包的结构层片段仍是 service.ts / 测试的消费点 → 从 pack 文件静态再导出（同一模块实例·identity 不破 R6）。
export { BATTERY_VIEW_FRAGMENTS } from "./packs/battery-manufacturing.pack.js";

/**
 * IndustryPack 加载器（P1 北极星 · R14 零跨文件电池硬编码收口 · 契约 `@platform/contracts industrypack.ts`）。
 *
 * 本模块是**行业栈的单一装配点**：把 5 前置 HARDCODE WO 各自 genericize 的层
 * （派发 SolverDescriptor / 结构 ViewConfig.layout / 阈值 SolverParam / 时间 t0 / 实体 SEG）
 * **收敛为单一声明式 IndustryPack 实例** + 一个 `loadIndustryPack` 加载器。runJob/seed 消费 pack 装配全栈。
 *
 * **目录约定 + auto-discover（C2 真 0 码改·治本）**：行业包外置为 `packs/<industryKey>.pack.{ts,json}`
 *   （`.ts` 可 identity-引用既有常量以保 byte-identical；`.pack.json` 供纯数据行业）。
 *   `PACK_REGISTRY` 由**运行期扫描 `packs/` 目录**构建（`readdirSync` + 动态 `import()`/`readFileSync`），
 *   **非手工登记数组**——新增一个行业 = 往 `packs/**` 放一个文件，**零跨文件代码改动**（既有代码一行不改）。
 *   门 `industry-pack:check` 断言「PACK_REGISTRY === 目录扫描结果」+「industry-pack.ts 无手工 pack 数组」+ battery/logistics 存在且合法。
 *   构建：`tsc` 逐文件产 `dist/synthetic/packs/*.pack.js`（Node 运行期扫描）；`.pack.json` 由 build 脚本拷贝入 dist；
 *   测试（vitest·源码态）扫描 `src/synthetic/packs/*.pack.ts`——同一扫描逻辑两态皆真（无 bundler 打包·非纸面）。
 *
 * **收编（byte-identical·R6）**：电池散落配置以**引用**收入 `packs/battery-manufacturing.pack.ts`（见该文件）；
 *   搬家不改值——现有测试断言不变即证 R6。
 */

// ---------------------------------------------------------------------------
// 目录扫描：packs/<key>.pack.{ts|js|json} → IndustryPack[]（确定性排序·R6）。
// ---------------------------------------------------------------------------
const PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "packs");

/** 扫出的 pack 文件名（含扩展·按文件名稳定排序）。测试/门与运行期共用同一扫描口径。 */
function scanPackFiles(): string[] {
  let names: string[];
  try {
    names = readdirSync(PACKS_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => /\.pack\.(ts|js|json)$/.test(n) && !/\.d\.ts$/.test(n))
    .sort((a, b) => a.localeCompare(b));
}

/** industryKey ← 文件名（去 `.pack.<ext>`）。目录约定：文件名即行业键。 */
function keyFromFile(name: string): string {
  return name.replace(/\.pack\.(ts|js|json)$/, "");
}

async function buildRegistry(): Promise<IndustryPack[]> {
  const out: IndustryPack[] = [];
  for (const name of scanPackFiles()) {
    const abs = join(PACKS_DIR, name);
    if (name.endsWith(".json")) {
      // 纯数据行业包（.pack.json）——直接解析（无 identity 引用需求）。
      const raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
      out.push(IndustryPackSchema.parse(raw));
      continue;
    }
    // 代码行业包（.pack.ts/.js）——动态 import 取 `pack` 具名导出（保留 identity 引用·byte-identical R6，不经 parse 克隆）。
    const mod = (await import(pathToFileURL(abs).href)) as { pack?: IndustryPack; default?: IndustryPack };
    const p = mod.pack ?? mod.default;
    if (!p) throw new Error(`industry-pack: ${name} 未导出 \`pack\`（约定：export const pack: IndustryPack）`);
    out.push(p);
  }
  return out;
}

/** 行业包登记表（目录派生·**非手工数组**）。新增行业 = 加 `packs/<key>.pack.{ts,json}` 一个文件（零码改）。 */
export const PACK_REGISTRY: readonly IndustryPack[] = await buildRegistry();

/** industryKey → 行业包（O(1) 装配路由）。 */
export function loadIndustryPack(industryKey: string): IndustryPack | undefined {
  return PACK_REGISTRY.find((p) => p.industryKey === industryKey);
}

/**
 * 解析行业包消费的平台求解器 descriptor（派发层装配）：
 *  · `solverKeys` 声明 → 从共享 `SOLVER_REGISTRY` 按键过滤（顺序稳定 R6）；
 *  · 省略 → 消费全平台 descriptor（电池包用全集）。
 * **不复制 descriptor 进包**——pack 只按 key 绑定共享单源（R14 平台共享）。
 */
export function packSolverDescriptors(pack: IndustryPack): SolverDescriptor[] {
  if (!pack.solverKeys) return [...SOLVER_REGISTRY];
  const keys = new Set(pack.solverKeys);
  return SOLVER_REGISTRY.filter((d) => keys.has(d.key));
}

// ---------------------------------------------------------------------------
// 具名再导出（back-compat·测试/服务按名消费；均取自目录扫描的同一实例·identity 一致 R6）。
// 目录派生：这些不是「登记表」——新增行业无需在此加行（PACK_REGISTRY 已由扫描自动纳入）。
// ---------------------------------------------------------------------------
/** 电池制造行业包（= PACK_REGISTRY 中扫描所得同一实例·template===BATTERY_TEMPLATE·byte-identical R6）。 */
export const batteryPack: IndustryPack = loadIndustryPack("battery-manufacturing")!;
/** 物流仓配选址行业包（G-12 非电池行业实证·= 扫描所得同一实例）。 */
export const logisticsPack: IndustryPack = loadIndustryPack("logistics-warehouse")!;

/** 目录扫描口径导出（门 `industry-pack:check` 复用·确保门与运行期同一真相源）。 */
export { scanPackFiles, keyFromFile, PACKS_DIR };
