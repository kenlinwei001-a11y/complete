#!/usr/bin/env node
/**
 * 迁移号唯一门（治理 · 欠账 #74）—— **一个 migrations 目录内，一个编号只许属于一个文件**。
 *
 * ## 由来：三条挂起分支各占一个 `028`，而 git 一声不吭
 *
 * 并线对账（`docs/MAINLINE-RECONCILE-2026-08-06.md` §3.3）实测：
 *   · `claude/handoff-wo-66-rules-p1p2`          → `apps/datacore/migrations/028_solver_rule_bindings.sql`
 *   · `claude/handoff-wo-69-p3-interface`        → `apps/datacore/migrations/028_object_interfaces.sql`
 *   · `claude/handoff-sandbox-action-propagation`→ `apps/datacore/migrations/028_sim_action_propagation_rule.sql`
 *   · `claude/handoff-wo-aip-cap0`               → `apps/agentcore/migrations/010_plan_builder_canvases.sql`
 *                                                  （与现役 `010_multi_intent_plan.sql` 同号）
 *
 * **三个文件名互不相同 ⇒ git 合并不产生任何冲突**，安静地留下三个 028。
 * 没有任何一层会喊一声：不是编译错误、不是测试失败、不是 merge conflict。
 *
 * ## 撞号的真实后果（读迁移器实现得来，非推测）
 *
 * 两个迁移器（`apps/datacore/src/repo/pg.ts:558 runMigrations` /
 * `apps/agentcore/src/persistence/pg.ts:36 runMigrations`）逻辑逐字同构：
 *
 *     const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
 *     for (const f of files) { if (已在 schema_migrations) continue; await pool.query(sql); }
 *
 * 三条事实，每条都决定了修法：
 *  ① **去重键是完整文件名**（`schema_migrations(name TEXT PRIMARY KEY)`，`name` 存的是 `f` 整个文件名）
 *     ⇒ 同号不同名 = 三条不同记录 = **三个都会跑**。撞号从来不是"覆盖"，是"全跑"。
 *  ② **排序键也是完整文件名**（裸 `.sort()` 字典序，不解析编号）
 *     ⇒ 三个 028 的相对顺序由**编号后面那段文字**偶然决定，实测：
 *        `028_object_interfaces` → `028_sim_action_propagation_rule` → `028_solver_rule_bindings`
 *        （"ob" < "si" < "so"）——与任何人的依赖意图无关。
 *  ③ **最阴的一条：新库与老库的执行顺序会不一样。**
 *     老库上先并的那个已在 `schema_migrations` 里，后并的那个只能排在它后面（**按并线时间**）；
 *     全新库（CI / `docker compose up` / 新环境）则是**全部按字典序重跑**。
 *     两者顺序可以相反 ⇒ 典型的"我这儿好好的"。这才是撞号真正的危险，不是"跑不跑得起来"。
 *
 * **顺序不是学术问题——本仓已有跨文件顺序依赖**：`ts_points` 由 `002_addendum.sql` 建表、
 * 由 `007_lived_in.sql` `ALTER TABLE ts_points ADD COLUMN`。002 若排到 007 之后，007 直接炸。
 * 即：迁移号是**执行顺序的唯一表达**，撞号 = 把顺序交给字典序抽签。
 *
 * ## 判据
 *
 * 每个 `apps/<app>/migrations/` 目录内，`.sql` 文件的**数字前缀唯一**。
 * 真值源 = `readdirSync` 真实文件系统 —— 与迁移器**同一个来源**（它也是 `readdir`），
 * 不读任何清单、不读 git、不读文档。门与被守对象看同一份事实，是这道门不会变哑的根据。
 *
 * ## 存量豁免（`KNOWN_DUPLICATES`）为什么不是"把门放宽"
 *
 * 存量双 013 已在正线、且已在生产库跑过。**不能靠改名修**——去重键是文件名（事实①），
 * 改名 = 新名字不在 `schema_migrations` 里 = **在所有已部署的库上重跑一遍**。
 * 故豁免是"承认存量"，不是"放过同类"。豁免按**精确文件集合**匹配，不是按编号放行：
 * 013 组只要多出/换掉任何一个文件，集合不再相等 → **照样红**。
 * 即：存量两条被点名赦免，**第三条 013 一样是增量，一样红**。
 *
 * ## 诚实边界
 *
 * · 只看单个工作树。**看不见未合并的分支**——这正是它的设计：三个 028 分散在三条分支上时
 *   互不可见也无危害，**危害发生在它们落进同一棵树的那一刻**，而那一刻门就在这里等着。
 *   门把"安静的合并"变成"当场的红"，这是能拿到的最早的信号。
 * · 只断言**编号唯一**，不断言编号连续。跳空（如 005 缺失）不影响执行顺序的确定性，
 *   故只作信息打印**不判红**——把不影响正确性的事判红会逼出豁免名单，门就开始腐坏。
 * · 不校验 SQL 内容、不校验依赖方向。"028 该不该在 027 之后"属人的判断，门只保证
 *   **编号能表达顺序**（唯一），不保证**顺序表达得对**。
 *
 * 用法：node scripts/check-migration-numbering.mjs   ·   pnpm migration-numbering:check
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
  console.error(`⛔ check-migration-numbering.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APPS = join(ROOT, "apps");

/**
 * 存量撞号基线 —— 逐条写清「为什么豁免」「什么时候能清」。
 *
 * 匹配规则是**精确文件集合相等**（见顶注）：多一个文件即不匹配即红。
 * 新增撞号一律没有入口——本常量是手写的存量清单，不接受任何自动扩容。
 */
const KNOWN_DUPLICATES = {
  "apps/datacore/migrations": {
    "013": {
      files: ["013_data_builder.sql", "013_pipeline.sql"],
      why:
        "历史遗留，正线既有、且已在生产库跑过。两文件是**纯 CREATE TABLE IF NOT EXISTS 且表集合不相交**" +
        "（data_builder_agents/build_plans/build_jobs ⊥ ontology_workflows），彼此无 ALTER、无 FK、" +
        "无任何顺序依赖 ⇒ 字典序谁先谁后都等价，是撞号里**碰巧无害**的那一种。",
      whenCanClear:
        "无法靠改名清理：去重键是完整文件名，改名会让新名字在所有已部署库上重跑一遍。" +
        "只有在一次带 schema_migrations 数据迁移的正式版本升级里（同批 UPDATE 掉旧 name）才能重编号；" +
        "在那之前保留豁免。**注意这两条之所以安全是因为无顺序依赖——" +
        "若将来有人给这两张表加跨文件 ALTER，本豁免立即失效，必须重新评估。**",
    },
  },
};

/** 迁移文件名规范：`<数字>_<描述>.sql`。数字前缀是执行顺序的唯一表达。 */
const NAME_RE = /^(\d+)_[^/]*\.sql$/;

const fail = [];
const info = [];

/** 找出所有 apps/<app>/migrations 目录（自动发现——新 app 天然纳管，不靠有人记得改门）。 */
function findMigrationDirs() {
  if (!existsSync(APPS)) return [];
  const out = [];
  for (const app of readdirSync(APPS).sort()) {
    const dir = join(APPS, app, "migrations");
    if (existsSync(dir) && statSync(dir).isDirectory()) out.push(`apps/${app}/migrations`);
  }
  return out;
}

const dirs = findMigrationDirs();
if (dirs.length === 0) {
  console.error("✗ migration-numbering:check：一个 migrations 目录都没找到 —— 门找不到守的对象即红，不许空跑通过");
  process.exit(1);
}

let totalFiles = 0;
let totalDupGroups = 0;

for (const rel of dirs) {
  const abs = join(ROOT, rel);
  // 与迁移器同源同法：readdir + 过滤 .sql + 裸 .sort()（字典序，正是它的真实执行顺序）
  const files = readdirSync(abs).filter((f) => f.endsWith(".sql")).sort();
  totalFiles += files.length;

  // 命名规范：不合规的文件排序位置无法预期，直接红（它连"有没有撞号"都无从判断）
  const malformed = files.filter((f) => !NAME_RE.test(f));
  for (const f of malformed) {
    fail.push(
      `【命名不合规】${rel}/${f}\n` +
        `    迁移文件必须形如 <数字>_<描述>.sql —— 数字前缀是执行顺序的唯一表达；` +
        `没有前缀的文件在字典序里的位置无法预期。`,
    );
  }

  // 按编号分组（前缀数字按字面分组：028 与 28 视为不同字面量，但都会被下方 numeric 视图捕捉）
  const byNum = new Map();
  for (const f of files) {
    const m = NAME_RE.exec(f);
    if (!m) continue;
    const num = m[1];
    if (!byNum.has(num)) byNum.set(num, []);
    byNum.get(num).push(f);
  }

  const dupGroups = [...byNum.entries()].filter(([, fs]) => fs.length > 1).sort();
  const exempt = KNOWN_DUPLICATES[rel] || {};

  for (const [num, group] of dupGroups) {
    totalDupGroups++;
    const known = exempt[num];
    // 豁免按**精确集合相等**匹配：多一个/换一个文件 → 不再匹配 → 红
    const sameSet =
      known &&
      known.files.length === group.length &&
      [...known.files].sort().every((f, i) => f === [...group].sort()[i]);

    if (sameSet) {
      info.push(`  · ${rel} 编号 ${num}：${group.length} 个文件（存量豁免）— ${group.join(" , ")}`);
      continue;
    }

    // 打印**真实执行顺序**——让读门的人直接看见后果，而不是只看见"撞号了"
    const order = [...group].sort();
    let msg =
      `【编号撞车】${rel} 编号 ${num} 被 ${group.length} 个文件同时占用：\n` +
      order.map((f, i) => `      ${i + 1}. ${f}`).join("\n") +
      `\n    迁移器（apps/*/src/**/pg.ts runMigrations）以**完整文件名**去重并排序：\n` +
      `      · 去重键是文件名 ⇒ 这 ${group.length} 个**全都会跑**（不是互相覆盖）；\n` +
      `      · 排序键是文件名 ⇒ 上面就是它们在**全新库**上的真实执行顺序，由编号后那段文字的字典序决定，与依赖意图无关；\n` +
      `      · 老库上已跑过的会被跳过 ⇒ **老库按并线时间、新库按字典序，两者可能相反**（"我这儿好好的"由此而来）。\n` +
      `    修法：给后到的那个改成**尚未占用的编号**（见下方各目录的下一个可用号），不要动已并线/已部署的那个。`;
    if (known) {
      msg +=
        `\n    ⚠ 本目录编号 ${num} 存在存量豁免，但豁免按精确文件集合匹配，当前集合与豁免集合不符：\n` +
        `      豁免集合：${[...known.files].sort().join(" , ")}\n` +
        `      实际集合：${[...group].sort().join(" , ")}\n` +
        `      ⇒ 这是在存量撞号上**又叠了一个**，属增量，不在豁免范围。`;
    }
    fail.push(msg);
  }

  // 信息面：跳空 + 下一个可用号（红时给修法用）
  const nums = [...byNum.keys()].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const width = Math.max(3, ...[...byNum.keys()].map((s) => s.length));
  const next = nums.length ? String(nums[nums.length - 1] + 1).padStart(width, "0") : "001".padStart(width, "0");
  const gaps = [];
  for (let n = (nums[0] ?? 1) + 1; n < (nums[nums.length - 1] ?? 0); n++) {
    if (!nums.includes(n)) gaps.push(String(n).padStart(width, "0"));
  }
  info.push(
    `· ${rel}：${files.length} 个迁移 · 编号 ${nums.length ? String(nums[0]).padStart(width, "0") : "-"}…` +
      `${nums.length ? String(nums[nums.length - 1]).padStart(width, "0") : "-"} · 撞号组 ${dupGroups.length} · ` +
      `跳空 ${gaps.length ? gaps.join(",") : "无"} · **下一个可用号 ${next}**`,
  );
}

console.log(`· 迁移号唯一门：扫描 ${dirs.length} 个 migrations 目录 · 共 ${totalFiles} 个迁移文件 · 撞号组 ${totalDupGroups}`);
for (const line of info) console.log(line);

if (fail.length) {
  console.error(`\n✗ migration-numbering:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error(`  - ${m}`);
  console.error(
    `\n  ⚠ 为什么这条必须红：迁移号是**执行顺序的唯一表达**。同号不同内容时，顺序由文件名字典序偶然决定，` +
      `\n    而不是由依赖关系决定 —— 今天能跑通是运气（本仓已有真实跨文件顺序依赖：` +
      `\n    ts_points 由 002_addendum.sql 建表、由 007_lived_in.sql ALTER）。且 pg 模式**启动即自动迁移**，` +
      `\n    没有人工确认环节能兜住。` +
      `\n  ⚠ 不要用"加进 KNOWN_DUPLICATES"来消红：那个常量是**存量清单**，不是逃生舱。` +
      `\n    新撞号一律改号——改号成本是一次重命名，撞号成本是一次线上顺序不可复现。`,
  );
  process.exit(1);
}
console.log("\n✓ migration-numbering:check 通过：每个 migrations 目录内编号唯一（存量豁免按精确集合匹配）。");
