#!/usr/bin/env node
/**
 * boot-log.mjs · 容器回收节律的**累积台账**（不是一次性统计）
 *
 * ## 为什么需要它
 *
 * 本沙箱是托管的一次性容器，**按设计定期回收**。2026-08-06 一天回收 10+ 次，
 * 每次把正在跑的 gate 与全部后台 dev 一起杀掉。我一整天都在**事后**发现重启
 * （而且好几次是仓主问了才去查）。事后发现的代价是实的：一个 dev 的产出从没 push、随重启归零。
 *
 * 正确做法不是「更频繁地问它死了没」——重启是**瞬间**杀进程，轮询再密也只是**更早知道它死了**。
 * 正确做法是**知道自己大概还剩多少时间**，据此决定「现在起不起这个 40 分钟的活」。
 *
 * ## 判据（每次调用都记一笔，样本自己会长出来）
 *
 * 每次运行：读 `/proc/uptime` 算出本次 boot 时刻，若与台账最后一条不同则**追加一条新纪元**。
 * 因为 boot 时刻在同一个容器生命周期内是常数，所以「出现新的 boot 时刻」= 发生过一次回收。
 * 台账落在 scratchpad（实测跨重启存活），所以样本会跨容器累积。
 *
 * ## 诚实边界（重要，别把这个工具用成占卜）
 *
 * · 它**只能观测到「我跑过它的那些时刻」之间的重启**。两次调用之间若重启了两次，只会记成一次。
 *   ⇒ 记录的「存活时长」是**下界**，不是真值。
 * · 回收策略是平台侧的，可能与空闲时长相关而非固定周期。样本少时**不要**当周期用。
 *   本脚本因此只报**分位数与最小值**，不报「平均每 N 分钟重启一次」——
 *   后者会诱使人拿一个均值去赌一个尾部事件。
 * · 决策该用**保守下界**（p10 / 最小值），不是均值：赌均值意味着一半的情况会输。
 *
 * 用法：
 *   node scripts/boot-log.mjs          # 记一笔 + 报统计
 *   node scripts/boot-log.mjs --quiet  # 只记不报（给守护/钩子用）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEDGER =
  process.env.BOOT_LOG ??
  "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/boot-ledger.json";
const quiet = process.argv.includes("--quiet");

const uptimeSec = Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]));
const nowMs = Date.now();
const bootMs = nowMs - uptimeSec * 1000;
// 秒级抖动会让同一 boot 算出不同毫秒值 → 需要归一。
// ⚠ **只归到分钟不够**：/proc/uptime 的读数与 Date.now() 之间有亚秒漂移，
//   03:06:29 与 03:06:31 会被 round 到 03:06 与 03:07 两个不同的键 ⇒ **同一个容器被记成两条纪元**。
//   台账第一次跑就造出了一条「存活 1 分钟」的幽灵纪元 —— 一个统计工具，第一次运行就产出了假数据。
//   故：同一纪元的判定改为**容差窗口**（见下 SAME_EPOCH_MS），不是键相等。
const SAME_EPOCH_MS = 5 * 60 * 1000; // 5 分钟内的 boot 读数视为同一容器（远小于任何真实回收间隔）
const bootIso = new Date(bootMs).toISOString();

mkdirSync(dirname(LEDGER), { recursive: true });
/** @type {{boot:string, firstSeen:string, lastSeen:string, observedAliveMin:number}[]} */
let epochs = [];
if (existsSync(LEDGER)) {
  try {
    epochs = JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    epochs = []; // 台账损坏不该阻断调用方；重新开始记比抛异常有用
  }
}

const nowIso = new Date(nowMs).toISOString();
const last = epochs[epochs.length - 1];
if (last && Math.abs(Date.parse(last.boot) - bootMs) < SAME_EPOCH_MS) {
  // ⚠ 采样密度必须记下来，否则「存活时长」这个数是**被污染的**：
  //   我不在场时（会话空闲）容器很可能早已被回收、我回来才起了新的，
  //   于是「两次 boot 观测之间的间隔」被当成「容器活了这么久」。
  //   实测栽过：一段 11 小时的空闲被记成「存活 671 分钟」——
  //   拿它算规律会得出「能活 11 小时」这个恰好相反的结论。
  //   有了 samples + maxGapMin，就能把「密集观测下的真存活」与「稀疏观测下的猜测」分开。
  const gapMin = Math.round((nowMs - Date.parse(last.lastSeen)) / 60000);
  last.maxGapMin = Math.max(last.maxGapMin ?? 0, gapMin);
  last.samples = (last.samples ?? 1) + 1;
  last.lastSeen = nowIso;
  last.observedAliveMin = Math.round((nowMs - Date.parse(last.firstSeen)) / 60000);
} else {
  epochs.push({ boot: bootIso, firstSeen: nowIso, lastSeen: nowIso, observedAliveMin: 0, samples: 1, maxGapMin: 0 });
}
writeFileSync(LEDGER, JSON.stringify(epochs, null, 2) + "\n");

if (quiet) process.exit(0);

const hhmm = (iso) => new Date(iso).toISOString().slice(5, 16).replace("T", " ");
console.log(`═══ 容器回收台账 · ${epochs.length} 个纪元 · 台账 ${LEDGER} ═══`);
for (const e of epochs.slice(-12)) {
  console.log(`  boot ${hhmm(e.boot)}  观测存活 ${String(e.observedAliveMin).padStart(4)} min  （首见 ${hhmm(e.firstSeen)} · 末见 ${hhmm(e.lastSeen)}）`);
}

// 只统计**已经结束且观测密集**的纪元：
//   · 最后一条还活着 → 不计入（会拉低下界）
//   · maxGapMin 过大 → 该纪元有一大段没人看，它的「存活时长」是猜的不是测的，**必须剔除**
const DENSE_GAP_MIN = 10; // 观测断档超过这个就不算密集（autosave 每 60s 打一次，正常远小于它）
const usable = epochs.slice(0, -1).filter((e) => e.observedAliveMin > 0 && (e.maxGapMin ?? 999) <= DENSE_GAP_MIN);
const dropped = epochs.slice(0, -1).length - usable.length;
const closed = usable.map((e) => e.observedAliveMin).sort((a, b) => a - b);
console.log(`\n· 已结束纪元 ${epochs.slice(0, -1).length} 个 · 其中观测密集可用 ${closed.length} 个（剔除 ${dropped} 个观测有断档的 —— 那些的"存活时长"是猜的不是测的）`);
if (closed.length < 3) {
  console.log("· 样本不足 3 个 —— **拒绝给建议**。样本少时报出来的「规律」只是噪声，");
  console.log("  照它排期比不排期更糟（会给出一个有信心的错数）。继续积累。");
  process.exit(0);
}
const q = (p) => closed[Math.min(closed.length - 1, Math.floor(closed.length * p))];
console.log(`· 观测存活（分钟）：最小 ${closed[0]} · p10 ${q(0.1)} · 中位 ${q(0.5)} · 最大 ${closed[closed.length - 1]}`);
console.log(`\n【怎么用】决策用**保守下界 p10 = ${q(0.1)} min**，不是中位数 ——`);
console.log(`  赌中位数意味着一半的情况会输，而输一次的代价是整个长跑作废重来。`);
console.log(`  · 手上活 ≤ ${q(0.1)} min：直接干`);
console.log(`  · 手上活 > ${q(0.1)} min：**必须先拆成可续跑的段**（如 scripts/gate-resumable.sh 的逐包记账），`);
console.log(`    否则大概率跑不完；已知 pnpm -r test 一次约 35–40 min，就是被这条打死的。`);
console.log(`⚠️ 观测存活是**下界**：两次调用之间若重启两次只会记成一次。真实间隔只会更短，不会更长。`);
