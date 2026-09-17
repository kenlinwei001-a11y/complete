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
 *   - 构建点**双跑自证**：每次建快照都真合成两遍、逐表逐字段比对（DIFF_POLICY 口径），
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
type TableDump = MemDump | TsPointsDump | SimDump;

const sortEntries = <V>(m: Map<string, V>): [string, V][] =>
  [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

function dumpReposToTables(repos: Repos): Record<string, TableDump> {
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

// ── 双跑自证的差异口径 ───────────────────────────────────────────────────────
//
// 非确定残留（账本 §5.3，逐条有码坐标）：快照还原**原样保留**这些字节（快照内部自洽），
// 只有「双跑自证」的比对需要圈掉它们 —— 它们今天在同一台机两次新鲜合成之间也不同。
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
  // service.ts:336 · runJob 尾 emit dataset.regenerated（事件 id/at 含墙钟）
  outboxEvents: "countOnly",
  // service.ts:626/632 · 「合成数据源」连接 id = newId("conn")、lastSyncAt = 墙钟；
  // conn-erp 等 8 条 id 确定但 lastSyncAt 仍是墙钟 ⇒ 整表 countOnly（id 作为 key 一半随机一半确定，混排无意义）
  connections: "countOnly",
  // users：argon2 随机盐（auth.ts:67）—— 同行其余字段全确定
  users: { ignorePaths: [/^\.passwordHash$/] },
  // service.ts:430 · updatedAt = 墙钟（params 本体 = BATTERY_SOLVER_PARAMS 常数，strict 比对）
  solverParams: { ignorePaths: [/^\.updatedAt$/] },
  // service.ts:309-310 · createdAt/updatedAt = 墙钟
  scenarioPackages: { ignorePaths: [/^\.createdAt$/, /^\.updatedAt$/] },
  // service.ts:612 · createdAt = 墙钟（domains 其余字段确定）
  domains: { ignorePaths: [/^\.createdAt$/] },
};

interface DiffReport {
  /** 命中 ignorePaths / countOnly 的差异（预期内，计数备查）。 */
  ignored: string[];
  /** 口径外差异 —— 非空即 R6 破了，必须抛错。 */
  unexpected: string[];
}

function walkDiff(path: string, x: unknown, y: unknown, ignore: RegExp[] | undefined, report: DiffReport): void {
  if (report.unexpected.length >= 50) return; // 报 50 条足够定位，别糊屏
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
      walkDiff(`${path}.${k}`, (x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], ignore, report);
    }
    return;
  }
  report.unexpected.push(path);
}

function diffTables(a: Record<string, TableDump>, b: Record<string, TableDump>): DiffReport {
  const report: DiffReport = { ignored: [], unexpected: [] };
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const policy = DIFF_POLICY[key];
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
      const na = JSON.stringify(da).length; // 行数比较：用 entries 长度而非字节长
      const ca = da.shape === "tspoints" ? da.entries.reduce((n, [, inner]) => n + inner.length, 0) : da.entries.length;
      const cb = db.shape === "tspoints" ? db.entries.reduce((n, [, inner]) => n + inner.length, 0) : db.entries.length;
      void na;
      if (ca !== cb) report.unexpected.push(`${key}: 行数 ${ca} ≠ ${cb}`);
      continue;
    }
    const ignore = typeof policy === "object" ? policy.ignorePaths : undefined;
    if (da.shape === "sim" && db.shape === "sim") {
      walkDiff(`${key}.perturbationSeq`, da.perturbationSeq, db.perturbationSeq, ignore, report);
      for (const sub of ["sessions", "ticks", "checkpoints", "rules", "perturbations"] as const) {
        walkDiff(`${key}.${sub}`, da[sub], db[sub], ignore, report);
      }
    } else {
      walkDiff(key, (da as MemDump | TsPointsDump).entries, (db as MemDump | TsPointsDump).entries, ignore, report);
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
async function postSyntheticJob(t: BareApp, seed: number): Promise<void> {
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
  const report = diffTables(a, b);
  if (report.unexpected.length > 0) {
    throw new Error(
      `world-snapshot 双跑自证失败（合成非纯函数，R6 破）：\n  ${report.unexpected.slice(0, 50).join("\n  ")}`,
    );
  }
  const file: SnapshotFile = { format: FORMAT_VERSION, kind, seed, sourcesSha256, tables: a };
  return v8.serialize(file);
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
 * 与 live runJob 完全同一组幂等清理谓词（service.ts:229-233 + clearSyntheticTimeseries:400-422）。
 * ⛔ 改这里 = 改「还原 ≡ live」的等价论证 —— 谓词必须与 runJob 逐条对得上，对不上先停手。
 */
async function clearSyntheticLikeRunJob(repos: Repos, tenantId: string): Promise<void> {
  await repos.objects.removeWhere(tenantId, (o) => o.origin.type === "SYNTHETIC");
  await repos.links.removeWhere(tenantId, (l) => l.origin.type === "SYNTHETIC");
  const oldRules = await repos.rules.list(tenantId, (r) => r.origin.type === "SYNTHETIC");
  for (const r of oldRules) await repos.rules.remove(tenantId, r.id);

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
