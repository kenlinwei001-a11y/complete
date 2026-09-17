/**
 * WO-SNAPSHOT-RESTORE · 确定性快照还原（阶段② 实现）
 *
 * 原理（账本 docs/evidence/WO-SNAPSHOT-RESTORE-ledger.md §6）：R6 已证同 (industry, scale, seed)
 * 重铺世界字节级一致 ⇒ 各测试文件的世界合成是纯函数重放。本模块把「每个文件自己 seed 一遍」
 * 换成「seed 一次 → v8 字节序列化 → 各文件还原字节」：
 *
 *   - 快照文件是**测试缓存**（os.tmpdir()/dc-world-snapshots/，不进 git）——不是基线/门/棘轮（禁令 3）。
 *   - 快照键 = 快照格式版本 + kind + seed + **种子链全部源文件的内容哈希**
 *     （apps/datacore/src 全部 .ts + packages/contracts/dist + packages/llm-adapters/dist
 *      + test/helpers.ts + 本文件）——链上任何一字节变了快照自动作废（审核硬条件 ③，
 *     ⛔ 不许砍成只哈希入口文件：battery.ts 改了而快照不中 = 假绿温床）。
 *   - 构建点**双跑自证**：每次建快照都真合成两遍、逐表逐字段比对（随机 id 引用图先经
 *     canonicalizeForDiff 归一化、叶子级墙钟/随机盐按 DIFF_POLICY 圈定 —— 两节均有码坐标），
 *     不一致当场抛错 —— 守门员④「两次独立合成字节一致」的证据强度不降格（各文件还原同一批
 *     字节后，文件内两次还原恒等是恒真命题，不再度量「合成是纯函数」；该性质挪到这里，每轮
 *     套件构建快照时仍真测一次）。
 *   - 还原语义**精确对齐 live runJob**（service.ts:228-233 + clearSyntheticTimeseries）：
 *     同一组谓词清 SYNTHETIC（objects/links/rules/合成 TS/aggRuns/aggSpecs/lateArrivals/
 *     forecastSnapshots）→ 快照行 putMany-upsert。测试在 makeApp→seedBattery 之间自建的行
 *     两条路都存活；世界行 id 确定性（R6 前提）⇒ 与 live 逐字节同（账本 §6.2.1 的等价论证）。
 *   - 防污染（验收④）：模块级只许缓存 **Buffer**（字节），⛔ 不许缓存 deserialize 后的对象图
 *     再往外发 —— 每次还原 = 重新 v8.deserialize（全新对象图）+ putMany 再 structuredClone
 *     一遍，文件间/调用间零共享引用。
 *
 * 与 live 的**已知良性差异**（逐条论证过，账本 §5.3/§6.2）：
 *   1. syntheticJobs/outboxEvents 行数：live 每调一次 +1 行（newId 随机 id）；还原是快照那 1 行
 *      反复 upsert（幂等覆盖）。全套件只有 features.test/simclock.test 读「最新一条 job」，
 *      对行数不敏感（账本 §6.2 消费方排查）。
 *   2. epochs：live 重播会让 epoch 继续自增；还原灌回快照值（幂等）。concurrency.test 只读
 *      current() 当查询参数，对绝对值不敏感。
 *   3. users.passwordHash：argon2 随机盐，还原后拿的是快照构建时的 hash —— 仍是 "demo1234"
 *      的有效哈希，登录语义不变（今天两次 fresh makeApp 之间该行字节本来也不同）。
 *
 * ⛔ 红线：本文件不得改生产 seed 路径语义（src/seed*.ts、src/synthetic/**）——快照存的是它们的
 *    **输出**；不得要求 808 处 seedBattery 调用点修改（helpers.seedBattery 内部包一层）。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import { loadConfig } from "../src/config.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { LocalFsBlobStore } from "../src/blob.js";
import { ScriptedLlmClient } from "../src/llm.js";
import { buildApp, type BuiltApp } from "../src/app.js";
import { seedDemo } from "../src/seed.js";
import type { AuthCtx } from "../src/domain.js";
import type { Repos } from "../src/repo/repo.js";
import { BATTERY_TS_AGG_SPECS } from "../src/synthetic/battery.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DATACORE_ROOT = join(TEST_DIR, "..");
const REPO_ROOT = join(DATACORE_ROOT, "..", "..");

/** 快照格式版本 —— 改任何序列化/还原语义先 bump（等于作废全部旧缓存，fail-safe 方向）。 */
const FORMAT_VERSION = 1;
const SNAP_DIR = join(tmpdir(), "dc-world-snapshots");
/** 缓存清扫阈值：超 24h 的快照/锁文件视为垃圾（本机多 worktree 共享 tmpdir，只清自己前缀）。 */
const SWEEP_AGE_MS = 24 * 3600_000;
/** 等锁上限：构建 = 双跑合成，负载下实测 ~60–90s；留足余量但禁止无限等（卡死要能逃）。 */
const LOCK_WAIT_MS = 300_000;
/** 锁文件超 10 分钟没释放 ⇒ 持有进程已死（Ctrl-C 不留 finally 的机会），抢锁重建。 */
const STALE_LOCK_MS = 10 * 60_000;

export interface BareApp extends BuiltApp {
  repos: Repos;
  llm: ScriptedLlmClient;
  adminCtx: AuthCtx;
}

/**
 * 与 helpers.makeApp 同一实现（helpers.makeApp 委托到这里）。放在本模块是为了让快照构建器
 * 能造 app 而不与 helpers 形成 import 环（helpers → world-snapshot → helpers）。
 */
export async function createBareTestApp(opts?: {
  fetchImpl?: typeof fetch;
  seed?: boolean;
  env?: Record<string, string>;
  seeding?: () => boolean;
  bootstrapRequired?: () => Promise<string | null>;
  processClock?: () => Date;
}): Promise<BareApp> {
  const { mkdtemp } = await import("node:fs/promises");
  const blobDir = await mkdtemp(join(tmpdir(), "dc-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    BLOB_DIR: blobDir,
    JWT_SECRET: "test-secret",
    ...(opts?.env ?? {}),
  } as NodeJS.ProcessEnv);
  const repos = createMemoryRepos();
  const llm = new ScriptedLlmClient();
  const built = await buildApp({
    config,
    repos,
    blob: new LocalFsBlobStore(blobDir),
    llm,
    fetchImpl: opts?.fetchImpl,
    seeding: opts?.seeding,
    bootstrapRequired: opts?.bootstrapRequired,
    // WO-PROCESS-INSTANCE：流程运行时的可注入时钟。不传 ⇒ 生产同款真实时钟。
    // 传了才能对「已等多久」做到毫秒级断言 —— 欠账 #141「挂在墙钟上的断言并发时必假红」的对策。
    ...(opts?.processClock ? { processClock: opts.processClock } : {}),
  });
  let adminCtx: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
  if (opts?.seed !== false) adminCtx = await seedDemo(repos);
  return { ...built, repos, llm, adminCtx };
}

// ── 快照键：种子链源文件内容哈希 ─────────────────────────────────────────────

let cachedSourcesHash: string | null = null;

async function walkFiles(dir: string, exts: string[], out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      await walkFiles(p, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(p);
    }
  }
}

/**
 * 种子链全部源文件的内容哈希（审核硬条件 ③）：apps/datacore/src 全量 .ts（synthetic/seed/repo/
 * derivation/timeseries 全在链上，宁可过宽不可漏）+ contracts/llm-adapters 的 **dist**（运行时
 * 真加载的是构建产物）+ helpers.ts 与本文件（工装语义也进键）。
 */
export async function seedChainSourcesHash(): Promise<string> {
  if (cachedSourcesHash) return cachedSourcesHash;
  const files: string[] = [];
  await walkFiles(join(DATACORE_ROOT, "src"), [".ts"], files);
  for (const pkg of ["contracts", "llm-adapters"]) {
    const dist = join(REPO_ROOT, "packages", pkg, "dist");
    if (!existsSync(dist)) throw new Error(`world-snapshot: ${pkg}/dist 不存在 —— 先 pnpm --filter @platform/${pkg} build`);
    await walkFiles(dist, [".js", ".mjs", ".cjs", ".d.ts"], files);
  }
  files.push(join(TEST_DIR, "helpers.ts"), fileURLToPath(import.meta.url));
  files.sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(relative(REPO_ROOT, f));
    h.update("\0");
    h.update(await readFile(f));
    h.update("\0");
  }
  cachedSourcesHash = h.digest("hex");
  return cachedSourcesHash;
}

// ── 仓储序列化（dump）────────────────────────────────────────────────────────
//
// memory.ts 的仓储实现形态（账本 §5.1）：全部纯数据 Map，无函数/闭包/循环引用。
// TS 的 private/protected 是编译期修饰，运行期可枚举 —— 本模块刻意按**运行时形态**分类，
// 任何新表只要还是这些形态就自动纳入；遇到不认识的形态**当场抛错**（fail-loud，
// ⛔ 不许静默跳过 —— 跳了就是「还原的世界缺一张表」的假绿温床）。

type AnyStore = Record<string, unknown>;

interface MemDump {
  shape: "mem";
  /** 按 key 排序的 entries（排序 ⇒ 字节稳定，双跑比对不受插入序扰动）。 */
  entries: [string, unknown][];
}
interface TsPointsDump {
  shape: "tspoints";
  entries: [string, [string, unknown][]][];
}
interface SimDump {
  shape: "sim";
  sessions: [string, unknown][];
  ticks: [string, unknown][];
  checkpoints: [string, unknown][];
  rules: [string, unknown][];
  perturbations: [string, { seq: number; p: unknown }][];
  perturbationSeq: number;
}
export type TableDump = MemDump | TsPointsDump | SimDump;

const sortEntries = <V>(m: Map<string, V>): [string, V][] =>
  [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

export function dumpReposToTables(repos: Repos): Record<string, TableDump> {
  const out: Record<string, TableDump> = {};
  for (const [key, store] of Object.entries(repos) as [string, AnyStore | unknown][]) {
    if (typeof store === "function") continue; // ping / close
    const s = store as AnyStore;
    if (key === "sim") {
      out[key] = {
        shape: "sim",
        sessions: sortEntries(s.sessions as Map<string, unknown>),
        ticks: sortEntries(s.ticks as Map<string, unknown>),
        checkpoints: sortEntries(s.checkpoints as Map<string, unknown>),
        rules: sortEntries(s.rules as Map<string, unknown>),
        perturbations: sortEntries(s.perturbations as Map<string, { seq: number; p: unknown }>),
        perturbationSeq: s.perturbationSeq as number,
      };
    } else if (s.series instanceof Map) {
      // tsPoints: Map<tenant|seriesId, Map<entityId|ts, point>>
      const outer = s.series as Map<string, Map<string, unknown>>;
      out[key] = {
        shape: "tspoints",
        entries: sortEntries(outer).map(([k, inner]) => [k, sortEntries(inner)]),
      };
    } else if (s.items instanceof Map) {
      out[key] = { shape: "mem", entries: sortEntries(s.items as Map<string, unknown>) };
    } else if (s.rows instanceof Map) {
      out[key] = { shape: "mem", entries: sortEntries(s.rows as Map<string, unknown>) };
    } else if (s.counters instanceof Map) {
      out[key] = { shape: "mem", entries: sortEntries(s.counters as Map<string, unknown>) };
    } else if (s.chunks instanceof Map) {
      out[key] = { shape: "mem", entries: sortEntries(s.chunks as Map<string, unknown>) };
    } else {
      throw new Error(
        `world-snapshot: 未识别的仓储形态 "${key}"（自有字段: ${Object.keys(s).join(",")}）——` +
          `新增表必须显式归类进 dump/restore 两侧，⛔ 不许静默跳过（fail-loud，见本文件头注释）`,
      );
    }
  }
  return out;
}

// ── 双跑自证的归一化（随机 id 引用图）────────────────────────────────────────
//
// 探针实证（双跑全量 diff，三轮，证据落账本 §5.3）：合成世界有 8 组 id 是 newId 随机值且**跨表传播**：
//   connections      「合成数据源（确定性生成）」1 条 id = newId("conn")（service.ts:626；
//                    另 7 条 conn-erp 等 id 确定），被 rawDatasets.sourceConnId、tsSeries.connId、
//                    objects.origin.sourceConnId（实测 ×411）、ontologyTypes.sourceBindings.*.connId 引用；
//   rawDatasets      id = newId("rds")（service.ts:719，按 (sourceConnId,name) 幂等复用），
//                    被 objects.origin.rawDatasetId（实测 ×1556）与 rawRows 的行键尾部引用；
//   ontologyTypes    id = newId("otype")（ontology.ts upsertType，按 key 幂等复用）——
//                    随机 id 作 memKey 排序键 ⇒ 两次运行排序不同 ⇒ 位置比对全表错位
//                    （第二轮探针 properties.displayName ×193 等洪峰全是错位伪差，非内容差）；
//   ontologyLinks    id = newId("ltype")（ontology.ts upsertLinkType，同病）；
//   rules            id = newId("rule")（rules.ts:107，第三轮探针 ×29 错位洪峰）；
//   ontologyVersions id = newId("over")（ontology.ts:369，发布快照还整份内嵌类型定义的随机 id）；
//   derivationRuns   id = newId("drun")（ontology.ts:923/935）；
//   objectInterfaces id = newId("oif")（ontology-governance.ts:1007）。
// （objects/links/rules 的 origin.jobId **不是**随机值 —— service.ts:225 刻意用确定性串
//   `synthetic-${industry}-${scale}-${seed}`，这正是 R6 字节一致的前提；探针证实零 diff。
//   tsSeries/tsAggSpecs/tsAggRuns 的 id 均为确定性派生串（tser_/tspec_/tsrun_ 前缀），不在此列。）
//
// 处理 = **归一化而非忽略**，两层机制：
//   ① 规范名换随机 id：由确定性属性派生（连接按 name、原始表按 连接+数据集名、类型/链路按 key、
//      interface 按 key@version、derivationRun 按内容序），并集映射**深度改写所有 mem/sim 表的值**
//      —— 外键引用（对象 backref、sourceBindings、ontologyVersions 内嵌快照）ExactMatch 替换，
//      newId 字符串唯一性 ⇒ 误伤不可能（数据串等于 conn_<hex> 它本身就是引用）。
//   ② 行键同步换名重排（memKey 尾部的 id 段 + rawRows 的「tenant datasetId」键）。
// 归一化后这些表全部回到 strict 逐字节比对 —— 引用完整性仍被全量验证，只有「newId 随出了
// 什么字节」这一个真随机维度被折掉。查不到映射的引用**原样保留**（悬空引用两次运行各随各的，
// diff 当场红，fail-loud 方向）。
// ⛔ 归一化只作用于**比对**（双跑自证 / 验收① 的还原vs新鲜）；快照字节本身保持原样 ——
//    还原必须把快照那套自洽的原 id 原样写回，否则就是引入新的与 live 的差异类。

const NUL = "\u0000";
/** 规范键冲突时 fail-loud（撞名说明「确定性属性」并不确定，不许静默放行）。 */
function canonPut(map: Map<string, string>, seen: Set<string>, oldId: string, canon: string, what: string): void {
  if (seen.has(canon)) throw new Error(`world-snapshot 归一化：${what} 规范键撞名 "${canon}" —— 派生属性不唯一`);
  seen.add(canon);
  map.set(oldId, canon);
}

/** memKey = `${tenant}\0${id}`（memory.ts memKey）—— 只换 id 段，tenant 段原样保留。 */
function rewriteKeyId(key: string, idMap: Map<string, string>): string {
  const sep = key.indexOf(NUL);
  if (sep < 0) return key;
  const canon = idMap.get(key.slice(sep + 1));
  return canon === undefined ? key : key.slice(0, sep + 1) + canon;
}

const resort = (arr: [string, unknown][]): [string, unknown][] =>
  arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/** 深度 ExactMatch 换名：任何字符串**值**整体等于某个随机 id ⇒ 换成其规范名（对象的键不换，键是数据）。 */
function deepRewriteIds(v: unknown, idMap: Map<string, string>): void {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const e = v[i];
      if (typeof e === "string") {
        const canon = idMap.get(e);
        if (canon !== undefined) v[i] = canon;
      } else {
        deepRewriteIds(e, idMap);
      }
    }
    return;
  }
  if (typeof v === "object" && v !== null) {
    for (const [k, e] of Object.entries(v)) {
      if (typeof e === "string") {
        const canon = idMap.get(e);
        if (canon !== undefined) (v as Record<string, unknown>)[k] = canon;
      } else {
        deepRewriteIds(e, idMap);
      }
    }
  }
}

/**
 * 返回一份**比对专用**的归一化视图：外层对象浅拷，仅 6 张随机 id 源头表深拷；
 * 其余 mem/sim 表的值被**原地**深度换名（浅共享 ⇒ 入参 tables 的那些表也会被改）——
 * ⚠️ 因此入参用完必须丢弃，⛔ 不许再落快照（快照要保留原 id 自洽）。
 * 调用纪律：buildWorldTwice 里 diff 用归一化视图、a 本体（未过本函数的干净副本）落盘。
 */
export function canonicalizeForDiff(tables: Record<string, TableDump>): Record<string, TableDump> {
  const out: Record<string, TableDump> = { ...tables };
  const memOf = (name: string): MemDump | null => {
    const d = tables[name];
    if (d === undefined) return null;
    if (d.shape !== "mem") throw new Error(`world-snapshot 归一化："${name}" 应为 mem 形态，实际 ${d.shape}`);
    return d;
  };

  // ① 按确定性属性建映射（顺序有依赖：rds 的规范名内嵌 conn 的规范名）
  const connMap = new Map<string, string>();
  const conns = memOf("connections");
  if (conns) {
    const seen = new Set<string>();
    for (const [, v] of conns.entries) {
      const c = v as { id: string; name: unknown };
      canonPut(connMap, seen, c.id, `conn#${String(c.name)}`, "connections");
    }
  }
  const rdsMap = new Map<string, string>();
  const rawDatasets = memOf("rawDatasets");
  if (rawDatasets) {
    const seen = new Set<string>();
    for (const [, v] of rawDatasets.entries) {
      const d = v as { id: string; sourceConnId: unknown; name: unknown };
      const canonConn = connMap.get(String(d.sourceConnId)) ?? String(d.sourceConnId);
      canonPut(rdsMap, seen, d.id, `rds#${canonConn}#${String(d.name)}`, "rawDatasets");
    }
  }
  const otypeMap = new Map<string, string>();
  const otypes = memOf("ontologyTypes");
  if (otypes) {
    const seen = new Set<string>();
    for (const [, v] of otypes.entries) {
      const r = v as { id: string; key: unknown };
      canonPut(otypeMap, seen, r.id, `otype#${String(r.key)}`, "ontologyTypes");
    }
  }
  const ltypeMap = new Map<string, string>();
  const ltypes = memOf("ontologyLinks");
  if (ltypes) {
    const seen = new Set<string>();
    for (const [, v] of ltypes.entries) {
      const r = v as { id: string; key: unknown };
      canonPut(ltypeMap, seen, r.id, `ltype#${String(r.key)}`, "ontologyLinks");
    }
  }
  const oifMap = new Map<string, string>();
  const oifs = memOf("objectInterfaces");
  if (oifs) {
    const seen = new Set<string>();
    for (const [, v] of oifs.entries) {
      const r = v as { id: string; key: unknown; version: unknown };
      canonPut(oifMap, seen, r.id, `oif#${String(r.key)}#${String(r.version)}`, "objectInterfaces");
    }
  }
  // rules：id = newId("rule")（rules.ts:107），key+version 表内唯一（同 key 多版本共存，旧版 RETIRED 保留）
  const ruleMap = new Map<string, string>();
  const rules = memOf("rules");
  if (rules) {
    const seen = new Set<string>();
    for (const [, v] of rules.entries) {
      const r = v as { id: string; key: unknown; version: unknown };
      canonPut(ruleMap, seen, r.id, `rule#${String(r.key)}#${String(r.version)}`, "rules");
    }
  }
  // ontologyVersions：id = newId("over")（ontology.ts:369），version 号表内唯一（全量内嵌类型快照
  // 里的 otype/ltype 随机 id 由并集深度换名顺带归一，无需特判）
  const overMap = new Map<string, string>();
  const overs = memOf("ontologyVersions");
  if (overs) {
    const seen = new Set<string>();
    for (const [, v] of overs.entries) {
      const r = v as { id: string; version: unknown };
      canonPut(overMap, seen, r.id, `over#${String(r.version)}`, "ontologyVersions");
    }
  }
  // 并集（derivationRuns 不在内 —— 它的规范名按改写后内容派生，见 ④）
  const union = new Map<string, string>([...connMap, ...rdsMap, ...otypeMap, ...ltypeMap, ...oifMap, ...ruleMap, ...overMap]);

  // ② 7 张属性派生源头表：深拷 + 值深度换名（含自身 id —— 并集里有自己的旧 id ⇒ 自动归一）+ 行键换名重排
  const ownKeyMaps: Record<string, Map<string, string>> = {
    connections: connMap,
    rawDatasets: rdsMap,
    ontologyTypes: otypeMap,
    ontologyLinks: ltypeMap,
    objectInterfaces: oifMap,
    rules: ruleMap,
    ontologyVersions: overMap,
  };
  for (const [name, ownMap] of Object.entries(ownKeyMaps)) {
    const src = memOf(name);
    if (!src) continue;
    const clone = structuredClone(src);
    for (const [, v] of clone.entries) deepRewriteIds(v, union);
    clone.entries = resort(clone.entries.map(([k, v]) => [rewriteKeyId(k, ownMap), v] as [string, unknown]));
    out[name] = clone;
  }

  // ③ 其余 mem 表 + sim 表：值原地深度换名（浅共享 ⇒ 改的是入参那份，调用方必须弃之，见头注）。
  //    tspoints 跳过：点值只含 seriesId/entityId/数值，皆确定性派生，不可能含此 6 组随机 id。
  for (const [name, d] of Object.entries(out)) {
    if (name in ownKeyMaps || name === "derivationRuns") continue;
    if (d.shape === "mem") {
      for (const [, v] of d.entries) deepRewriteIds(v, union);
    } else if (d.shape === "sim") {
      for (const sub of [d.sessions, d.ticks, d.checkpoints, d.rules] as const) {
        for (const [, v] of sub) deepRewriteIds(v, union);
      }
      for (const [, e] of d.perturbations) deepRewriteIds(e.p, union);
    }
  }

  // ④ derivationRuns：id 无确定属性可派生 ⇒ 深拷换名后按确定内容（updatedObjects/order/status/error）
  //    排序编序号 drun#<i>。内容不同 ⇒ strict 红；行数不同 ⇒ 数组长度红。
  const druns = memOf("derivationRuns");
  if (druns) {
    const clone = structuredClone(druns);
    for (const [, v] of clone.entries) deepRewriteIds(v, union);
    const ordered = clone.entries
      .map(([k, v], i) => {
        const d = v as Record<string, unknown>;
        return { i, k, content: JSON.stringify([d.updatedObjects, d.order, d.status, d.error ?? null]) };
      })
      .sort((a, b) => (a.content < b.content ? -1 : a.content > b.content ? 1 : a.i - b.i));
    const drMap = new Map<string, string>();
    ordered.forEach(({ k }, idx) => {
      const sep = k.indexOf(NUL);
      if (sep >= 0) drMap.set(k.slice(sep + 1), `drun#${idx}`);
    });
    for (const [, v] of clone.entries) {
      const d = v as { id: string };
      d.id = drMap.get(d.id) ?? d.id;
    }
    clone.entries = resort(clone.entries.map(([k, v]) => [rewriteKeyId(k, drMap), v] as [string, unknown]));
    out.derivationRuns = clone;
  }

  // ⑤ rawRows 行键 = `${tenant} ${datasetId}`（restore 侧同一切分；service.ts:727 的落库键）。
  //    值是原始业务行（不含 rds id），已在 ③ 随 mem 表换名（无命中 = 无操作）。行键原地重排。
  const rawRows = memOf("rawRows");
  if (rawRows) {
    rawRows.entries = resort(
      rawRows.entries.map(([k, v]) => {
        const sep = k.indexOf(" ");
        if (sep < 0) return [k, v] as [string, unknown];
        const canon = rdsMap.get(k.slice(sep + 1));
        return [canon === undefined ? k : `${k.slice(0, sep)} ${canon}`, v] as [string, unknown];
      }),
    );
  }

  return out;
}

// ── 双跑自证的差异口径（叶子级非确定残留）────────────────────────────────────
//
// 归一化（上节）折掉的是「随机 id 引用图」；本表圈的是**叶子级**非确定：墙钟与随机盐。
// 快照还原**原样保留**这些字节（快照内部自洽），只有「双跑自证 / 验收①」的比对跳过它们 ——
// 它们今天在同一台机两次新鲜合成之间也不同（账本 §5.3，逐条有码坐标）。
//
// 口径分三档（默认档 = strict，⛔ 未列名的表一律 strict —— 新表冒出非确定字段会当场红，
// 逼人来这里显式登记，fail-loud 方向）：
//   "countOnly"  —— 行内含随机 id（newId）/墙钟，且 id 会被别的行当外键引用，逐字节无意义；
//                   只比行数（世界规模对得上，引用目标存在性由快照自洽性保证）。
//   ignorePaths  —— 表整体确定，个别字段是墙钟/随机盐；逐字段比对时跳过这些叶子路径。
//   strict       —— 逐表逐行逐字段字节相等（世界态口径，守门员④ 同口径）。
const DIFF_POLICY: Record<string, "countOnly" | { ignorePaths: RegExp[] }> = {
  // service.ts:214/220 · job id = newId("job")（randomBytes）、createdAt = 墙钟
  syntheticJobs: "countOnly",
  // service.ts:336 · runJob 尾 emit dataset.regenerated（事件 id/at 含墙钟 + payload 嵌随机 job id）
  outboxEvents: "countOnly",
  // service.ts:632/672 · lastSyncAt = 墙钟（连接的随机 id 已由归一化折掉，其余字段 strict）
  connections: { ignorePaths: [/\.lastSyncAt$/] },
  // service.ts:724 · syncedAt = 墙钟（id/sourceConnId 由归一化折掉，fields/rowCount 仍 strict）
  rawDatasets: { ignorePaths: [/\.syncedAt$/] },
  // ontology.ts:925-926 · startedAt/finishedAt = 墙钟（id 由归一化折掉）
  derivationRuns: { ignorePaths: [/\.startedAt$/, /\.finishedAt$/] },
  // ontology-governance.ts:1018-1019 · createdAt/updatedAt = 墙钟（id 由归一化折掉）
  objectInterfaces: { ignorePaths: [/\.createdAt$/, /\.updatedAt$/] },
  // ontology.ts:372 · createdAt = 墙钟（id 由归一化折掉；snapshot 内嵌类型定义的随机 id 亦由归一化折掉）
  ontologyVersions: { ignorePaths: [/\.createdAt$/] },
  // timeseries.ts:283/340 · runAt = 墙钟（实测 153,920 行每行一次；id/rowsIn/value 全确定）
  tsAggRuns: { ignorePaths: [/\.runAt$/] },
  // timeseries.ts:380 · lastRunAt 零数据点时回落墙钟 runAt（有数据点时是确定的最大点 ts）
  tsAggSpecs: { ignorePaths: [/\.lastRunAt$/] },
  // timeseries.ts:151 · ingestedAt = 墙钟（writePoints 给每个落库点盖收到戳；ts/values/tick 全确定）
  tsPoints: { ignorePaths: [/\.ingestedAt$/] },
  // users：argon2 随机盐（auth.ts:67）—— 同行其余字段全确定
  users: { ignorePaths: [/\.passwordHash$/] },
  // service.ts:430 · updatedAt = 墙钟（params 本体 = BATTERY_SOLVER_PARAMS 常数，strict 比对）
  solverParams: { ignorePaths: [/\.updatedAt$/] },
  // service.ts:309-310 · createdAt/updatedAt = 墙钟
  scenarioPackages: { ignorePaths: [/\.createdAt$/, /\.updatedAt$/] },
  // service.ts:612 · createdAt = 墙钟（domains 其余字段确定）
  domains: { ignorePaths: [/\.createdAt$/] },
};

export interface DiffReport {
  /** 命中 ignorePaths / countOnly 的差异（预期内，计数备查）。 */
  ignored: string[];
  /** 口径外差异 —— 非空即 R6 破了，必须抛错。 */
  unexpected: string[];
}

function walkDiff(
  path: string,
  x: unknown,
  y: unknown,
  ignore: RegExp[] | undefined,
  report: DiffReport,
  cap = 50,
): void {
  if (report.unexpected.length >= cap) return; // 默认 50 条足够定位，别糊屏；探针可放宽
  if (Object.is(x, y)) return;
  if (ignore?.some((re) => re.test(path))) {
    if (report.ignored.length < 200) report.ignored.push(path);
    return;
  }
  const xObj = typeof x === "object" && x !== null;
  const yObj = typeof y === "object" && y !== null;
  if (xObj && yObj && Array.isArray(x) === Array.isArray(y)) {
    const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)]);
    for (const k of [...keys].sort()) {
      walkDiff(`${path}.${k}`, (x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], ignore, report, cap);
    }
    return;
  }
  report.unexpected.push(path);
}

export function diffTables(
  a: Record<string, TableDump>,
  b: Record<string, TableDump>,
  policyOverride?: Record<string, "countOnly" | { ignorePaths: RegExp[] }>,
  cap = 50,
): DiffReport {
  const policyOf = (key: string) => (policyOverride ?? DIFF_POLICY)[key];
  const report: DiffReport = { ignored: [], unexpected: [] };
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const policy = policyOf(key);
    const da = a[key];
    const db = b[key];
    if (!da || !db) {
      report.unexpected.push(`${key}: 一侧缺席`);
      continue;
    }
    if (da.shape !== db.shape) {
      report.unexpected.push(`${key}: shape 不同`);
      continue;
    }
    if (policy === "countOnly") {
      const countOf = (d: TableDump): number =>
        d.shape === "tspoints"
          ? d.entries.reduce((n, [, inner]) => n + inner.length, 0)
          : d.shape === "sim"
            ? d.sessions.length + d.ticks.length + d.checkpoints.length + d.rules.length + d.perturbations.length
            : d.entries.length;
      const ca = countOf(da);
      const cb = countOf(db);
      if (ca !== cb) report.unexpected.push(`${key}: 行数 ${ca} ≠ ${cb}`);
      continue;
    }
    const ignore = typeof policy === "object" ? policy.ignorePaths : undefined;
    if (da.shape === "sim" && db.shape === "sim") {
      walkDiff(`${key}.perturbationSeq`, da.perturbationSeq, db.perturbationSeq, ignore, report, cap);
      for (const sub of ["sessions", "ticks", "checkpoints", "rules", "perturbations"] as const) {
        walkDiff(`${key}.${sub}`, da[sub], db[sub], ignore, report, cap);
      }
    } else {
      walkDiff(key, (da as MemDump | TsPointsDump).entries, (db as MemDump | TsPointsDump).entries, ignore, report, cap);
    }
  }
  return report;
}

// ── 快照文件结构 ─────────────────────────────────────────────────────────────

interface SnapshotFile {
  format: number;
  kind: string;
  seed: number;
  sourcesSha256: string;
  tables: Record<string, TableDump>;
}

export interface EnsureResult {
  buf: Buffer;
  /** true = 本进程现建（双跑自证付了一次）；false = 读盘/进程内缓存命中。 */
  built: boolean;
  path: string;
}

/** 进程内缓存：**只许是 Buffer**（防污染判据 —— 对象图一律现 deserialize，见文件头）。 */
const procCache = new Map<string, Buffer>();

async function sweepStale(): Promise<void> {
  try {
    const now = Date.now();
    for (const f of await readdir(SNAP_DIR)) {
      if (!/^world-.*\.(bin|lock|tmp)$/.test(f)) continue;
      const p = join(SNAP_DIR, f);
      try {
        const { stat } = await import("node:fs/promises");
        const st = await stat(p);
        if (now - st.mtimeMs > SWEEP_AGE_MS) await rm(p, { force: true });
      } catch {
        /* 单个文件清不掉不挡路 */
      }
    }
  } catch {
    /* 目录不存在等 —— 清扫永远 best-effort */
  }
}

/** POST /a/v1/synthetic/jobs —— 与 helpers.seedBattery 原实现同一条活路（路由→runJob 同步跑完）。 */
export async function postSyntheticJob(t: BareApp, seed: number): Promise<void> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/synthetic/jobs",
    headers: { "x-debug-user": "demo:admin:admin" },
    payload: { industry: "battery-manufacturing", scale: "S", seed },
  });
  if (res.statusCode !== 202) throw new Error(`world-snapshot 构建失败：synthetic job ${res.statusCode} ${res.body}`);
}

/**
 * 双跑自证构建：真合成**两遍**，按 DIFF_POLICY 口径逐表比对 —— 这是「合成是纯函数」在每轮
 * 套件里的真实测点（守门员④ 性质挪到构建点，见文件头）。不一致 = R6 破了，当场抛错，
 * ⛔ 不许落成快照（落了就是拿非确定字节当确定世界喂全套件 = 假绿温床）。
 */
async function buildWorldTwice(kind: string, seed: number, sourcesSha256: string): Promise<Buffer> {
  const buildOnce = async (): Promise<Record<string, TableDump>> => {
    const t = await createBareTestApp();
    try {
      await postSyntheticJob(t, seed);
      // kind 预留学生链复合层（sibling 分支 sim-real-cells 的 25 规格 + recompute 并入后在此叠加，
      // 审核硬条件 ⑤：本基线只有 "base" 一种，⛔ 不预实现未并入分支的链）。
      if (kind !== "base") throw new Error(`world-snapshot: 未知 kind "${kind}"`);
      return dumpReposToTables(t.repos);
    } finally {
      await t.app.close();
    }
  };
  const a = await buildOnce();
  const b = await buildOnce();
  // ⛔ 顺序是正确性的一部分：先把 a 的**干净字节**序列化出来（快照要保留原 id 自洽），
  // 再做归一化比对 —— canonicalizeForDiff 会**原地改写**浅共享的 mem 表值（见该函数头注），
  // 先比对后序列化 = 把规范名写进快照 = 还原出的世界与 live 多出一整类差异。
  const clean = v8.serialize({ format: FORMAT_VERSION, kind, seed, sourcesSha256, tables: a } satisfies SnapshotFile);
  const report = diffTables(canonicalizeForDiff(a), canonicalizeForDiff(b));
  if (report.unexpected.length > 0) {
    throw new Error(
      `world-snapshot 双跑自证失败（合成非纯函数，R6 破）：\n  ${report.unexpected.slice(0, 50).join("\n  ")}`,
    );
  }
  return clean;
}

/**
 * 取快照：进程内缓存 → 读盘 → （持锁）双跑构建 + 原子落盘。
 * 并发纪律：多 worker 同时 miss 时，持锁者构建、其余轮询等产物（⛔ 不许两个 worker 同时
 * 双跑 —— 4 核机上 4 份世界合成并发 = 本单要治的病原地复发）。锁超龄（进程死）可抢。
 */
export async function ensureWorldSnapshot(kind: string, seed: number): Promise<EnsureResult> {
  const sourcesSha256 = await seedChainSourcesHash();
  const tag = `world-v${FORMAT_VERSION}-${kind}-s${seed}-${sourcesSha256.slice(0, 16)}`;
  const cached = procCache.get(tag);
  if (cached) return { buf: cached, built: false, path: "(proc-cache)" };

  await mkdir(SNAP_DIR, { recursive: true });
  await sweepStale();
  const file = join(SNAP_DIR, `${tag}.bin`);
  const lock = join(SNAP_DIR, `${tag}.lock`);
  const tmp = join(SNAP_DIR, `${tag}.${process.pid}.tmp`);

  if (existsSync(file)) {
    const buf = await readFile(file);
    procCache.set(tag, buf);
    return { buf, built: false, path: file };
  }

  // 抢锁（wx = 原子创建）。拿不到就等持锁者落盘。
  let held: Awaited<ReturnType<typeof open>> | null = null;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      held = await open(lock, "wx");
      break;
    } catch {
      if (existsSync(file)) {
        const buf = await readFile(file);
        procCache.set(tag, buf);
        return { buf, built: false, path: file };
      }
      // 锁超龄 ⇒ 持锁进程已死，抢过来
      try {
        const { stat } = await import("node:fs/promises");
        const st = await stat(lock);
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          await rm(lock, { force: true });
          continue;
        }
      } catch {
        continue; // 锁刚好被释放/删除 —— 重试
      }
      if (Date.now() > deadline) {
        // 等不到也不许并发双跑全部世界？—— 到这一步说明持锁者异常活跃地慢；
        // 宁可本进程自己建（正确性不依赖锁，锁只是省 CPU），也不许把测试吊死。
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  try {
    const buf = await buildWorldTwice(kind, seed, sourcesSha256);
    await writeFile(tmp, buf);
    await rename(tmp, file); // 原子发布：读者永远只见到完整文件
    procCache.set(tag, buf);
    return { buf, built: true, path: file };
  } finally {
    if (held) await held.close().catch(() => undefined);
    await rm(lock, { force: true }).catch(() => undefined);
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

// ── 还原 ─────────────────────────────────────────────────────────────────────

/**
 * 与 live runJob 完全同一组幂等清理谓词（service.ts:229-233 + clearSyntheticTimeseries:400-422
 * + seedViewConfigs 的 viewConfigs 清理 :1903-1904）。
 * ⛔ 改这里 = 改「还原 ≡ live」的等价论证 —— 谓词必须与 runJob 逐条对得上，对不上先停手。
 */
async function clearSyntheticLikeRunJob(repos: Repos, tenantId: string): Promise<void> {
  await repos.objects.removeWhere(tenantId, (o) => o.origin.type === "SYNTHETIC");
  await repos.links.removeWhere(tenantId, (l) => l.origin.type === "SYNTHETIC");
  const oldRules = await repos.rules.list(tenantId, (r) => r.origin.type === "SYNTHETIC");
  for (const r of oldRules) await repos.rules.remove(tenantId, r.id);

  // service.ts:1903-1904 · seedViewConfigs 开头的清理（runJob ⑤ 的唯一额外 clear-and-reseed；
  // vc_${tenant}_${role} id 虽确定、upsert 已等价，但补上清理使等价论证不依赖「id 集跨 seed 不变」）
  const oldViews = await repos.viewConfigs.list(tenantId, (v) => v.origin === "SYNTHETIC");
  for (const v of oldViews) await repos.viewConfigs.remove(tenantId, v.id);

  const series = await repos.tsSeries.list(tenantId, (s) => s.origin === "SYNTHETIC");
  const ids = new Set(series.map((s) => s.id));
  if (ids.size > 0) {
    await repos.tsPoints.removeWhere(tenantId, (p) => ids.has(p.seriesId));
    for (const s of series) await repos.tsSeries.remove(tenantId, s.id);
  }
  const specKeys = new Set(BATTERY_TS_AGG_SPECS.map((s) => s.key));
  for (const run of await repos.tsAggRuns.list(tenantId, (r) => specKeys.has(r.specKey))) {
    await repos.tsAggRuns.remove(tenantId, run.id);
  }
  for (const spec of await repos.tsAggSpecs.list(tenantId, (s) => specKeys.has(s.key))) {
    await repos.tsAggSpecs.remove(tenantId, spec.id);
  }
  for (const late of await repos.tsLateArrivals.list(tenantId)) {
    await repos.tsLateArrivals.remove(tenantId, late.id);
  }
  for (const f of await repos.forecastSnapshots.list(tenantId)) {
    await repos.forecastSnapshots.remove(tenantId, f.id);
  }
}

const CHUNK = 10_000;

/**
 * 还原世界字节到 fresh repos：清 SYNTHETIC（同 live）→ 快照行 upsert。
 * 每次调用重新 v8.deserialize —— 调用方拿到的是全新对象图，再经 putMany 的 structuredClone
 * 才进 Map，两层隔离 ⇒ 调用间/文件间零共享引用（验收④ 机制）。
 */
export async function restoreWorldFromSnapshot(repos: Repos, buf: Buffer): Promise<void> {
  const snap = v8.deserialize(buf) as SnapshotFile;
  if (snap.format !== FORMAT_VERSION) {
    throw new Error(`world-snapshot: 格式版本不符（文件 ${snap.format} ≠ 代码 ${FORMAT_VERSION}）`);
  }
  const tenantId = "demo"; // seedBattery 永远打 demo 租户（helpers 原实现 ADMIN 头）
  await clearSyntheticLikeRunJob(repos, tenantId);

  for (const [key, dump] of Object.entries(snap.tables)) {
    const store = (repos as unknown as Record<string, unknown>)[key];
    if (typeof store === "function" || store == null) throw new Error(`world-snapshot: repos 缺席 "${key}"`);
    if (dump.shape === "sim") {
      const sim = repos.sim;
      for (const [, s] of dump.sessions) await sim.createSession(s as never);
      for (const [, ts] of dump.ticks) await sim.putTickState(ts as never);
      for (const [, cp] of dump.checkpoints) await sim.createCheckpoint(cp as never);
      for (const [, r] of dump.rules) await sim.putPropagationRule(r as never);
      // 插入序即 seq 序（dump 时已按 key 排序但 seq 语义在建单先后 —— 按 seq 显式排，R6）
      const ps = [...dump.perturbations].sort((a, b) => a[1].seq - b[1].seq);
      for (const [, e] of ps) await sim.createPerturbation(e.p as never);
      continue;
    }
    if (dump.shape === "tspoints") {
      for (const [outerKey, inner] of dump.entries) {
        const sep = outerKey.indexOf("|");
        const tenant = outerKey.slice(0, sep);
        const points = inner.map(([, p]) => p);
        for (let i = 0; i < points.length; i += CHUNK * 2) {
          await repos.tsPoints.upsert(tenant, points.slice(i, i + CHUNK * 2) as never);
        }
      }
      continue;
    }
    // mem 形态按 key 分发到对应批量口
    const rows = dump.entries.map(([, v]) => v);
    if (key === "rawRows") {
      for (const [k, v] of dump.entries) {
        const sep = k.indexOf(" ");
        await repos.rawRows.replace(k.slice(0, sep), k.slice(sep + 1), v as never);
      }
    } else if (key === "epochs") {
      for (const [tenant, v] of dump.entries) {
        const target = v as number;
        while ((await repos.epochs.current(tenant)) < target) await repos.epochs.next(tenant);
      }
    } else if (key === "kbChunks") {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await repos.kbChunks.upsert(rows.slice(i, i + CHUNK) as never);
      }
    } else {
      const st = store as { putMany: (items: unknown[]) => Promise<void> };
      if (typeof st.putMany !== "function") throw new Error(`world-snapshot: "${key}" 无 putMany`);
      for (let i = 0; i < rows.length; i += CHUNK) {
        await st.putMany(rows.slice(i, i + CHUNK));
      }
    }
  }
}
