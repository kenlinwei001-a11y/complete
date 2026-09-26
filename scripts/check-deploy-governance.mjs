#!/usr/bin/env node
/**
 * deploy-governance:check — 「代码里写了部署态建议，出货配置没照做」守门。
 *
 * 病历（#88）：`apps/agentcore/src/config.ts` 里五个 Loop Control 开关都是 **opt-in（缺省不设 = 不限）**，
 * 每个的 JSDoc 都白纸黑字写了「部署态建议 `X=N`」，而 `docker-compose.yml` 的 agentcore environment 里
 * **一个都没有**——出货容器只带第一层治理（超时），环检测/盲扫配额/per-tool 刷屏/有界重试全是死开关。
 * 这与「gate 标签写死 13 条而实际 15 条」同族：**声明与出货态各说各话，且没有任何东西会红**。
 *
 * 不变量：**config.ts 的「部署态建议」是单一来源**——凡在 env 的 JSDoc 里声明了建议值的开关，
 * 必须在 docker-compose.yml 对应服务的 environment 里显式出现，且**出货默认值等于建议值**
 * （允许 `${VAR:-建议值}` 形态：运维可用 .env 覆写，但删掉行 = 退回「一个都没设」→ 本门红）。
 *
 * 解析口径（保持窄而可判别，防"解析漂了却静默通过"）：
 *   ① 取 config.ts 的 JSDoc 块；块内含 `部署态…建议` 者，抽出其中所有 `` `VAR=value` ``（反引号包裹）。
 *   ② 抽到的 VAR 必须真在 ConfigSchema 里声明（防注释里写了个拼错的名字，永远无人消费）。
 *   ③ 含 `部署态` 标记却抽不出任何 `VAR=value` → 判为**解析漂移**报错（不是"没有建议 → 通过"）。
 * 纯静态（无网络/时钟/随机·可复现）。
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
  console.error(`⛔ check-deploy-governance.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_REL = "docker-compose.yml";

/**
 * 出货态映射（**现算** · WO-GATE-ROSTER-SWEEP-3）：`apps/<app>/src/config.ts` 存在 ⇒ 该 app 进治理面，
 * service 名 = 目录名（compose 服务与 app 目录同名是本仓约定；compose 查无此服务会当场红，见下）。
 * 新加一个 app 的配置源**自动**进面，不再靠人想起来回这里登记 —— 手抄名册的病正是
 * 「不在名单里的对象永远绿」（本体 §8 G-GATE-ROSTER-HANDCOPIED）。
 * 口径刻意只取**顶层** `src/config.ts`：嵌套子模块配置（如 `datacore/src/calibration/config.ts`）
 * 不产「部署态建议」，由现算规则本身排除，不靠手抄豁免。
 */
const APPS = (() => {
  const appsDir = join(ROOT, "apps");
  const out = [];
  for (const name of readdirSync(appsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const configRel = `apps/${name.name}/src/config.ts`;
    if (existsSync(join(ROOT, configRel))) out.push({ configRel, service: name.name });
  }
  return out.sort((a, b) => (a.service < b.service ? -1 : 1));
})();
/** 现算面下界（金丝雀 · 失败的危险方向）：枚举一坏集合就空 ⇒ 门恒绿且一声不吭。实测 2026-08-19 为 2。 */
const MIN_APPS = 2;

const errors = [];
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ---------------------------------------------------------------------------
// compose：抽出每个 service 的 environment 映射（缩进敏感的最小 YAML 走查，不引依赖）。
// ---------------------------------------------------------------------------
const composeSrc = readFileSync(join(ROOT, COMPOSE_REL), "utf8");

function envBlockOf(service) {
  const lines = composeSrc.split("\n");
  const svcIdx = lines.findIndex((l) => new RegExp(`^ {2}${service}:\\s*$`).test(l));
  if (svcIdx < 0) return null;
  let envIdx = -1;
  for (let i = svcIdx + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break; // 下一个 service，本服务结束
    if (/^ {4}environment:\s*$/.test(lines[i])) {
      envIdx = i;
      break;
    }
  }
  if (envIdx < 0) return { map: new Map(), lineNo: svcIdx + 1 };
  const map = new Map();
  for (let i = envIdx + 1; i < lines.length; i++) {
    if (!/^ {6}\S/.test(lines[i])) {
      if (/^\s*(#.*)?$/.test(lines[i])) continue; // 空行/注释穿过
      break; // 缩进退出 environment 块
    }
    const m = lines[i].match(/^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (m) map.set(m[1], { raw: m[2], lineNo: i + 1 });
  }
  return { map, lineNo: envIdx + 1 };
}

/** compose 值 → 出货默认值（无 .env 覆写时容器实际拿到的字符串）。 */
function shippedDefault(raw) {
  const interp = raw.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.*)\}$/);
  const v = interp ? interp[1] : raw;
  return v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
}

// ---------------------------------------------------------------------------
// config.ts：抽「部署态建议」→ (VAR, 建议值)
// ---------------------------------------------------------------------------
// 现算面下界自证：枚举塌陷时报「工具坏了」（RC=2），不许报「没有要守的配置」。
if (APPS.length < MIN_APPS) {
  console.error(`⛔ deploy-governance:check **工具坏了**：现算配置源只有 ${APPS.length} 个（下界 ${MIN_APPS}）——`);
  console.error("   apps/ 目录枚举坏了，不是「没有要守的部署建议」。本次结论作废，不许读作「通过」。");
  process.exit(2);
}
let totalRecs = 0;
const report = [];

for (const { configRel, service } of APPS) {
  let src;
  try {
    src = readFileSync(join(ROOT, configRel), "utf8");
  } catch {
    errors.push(`${configRel} · 配置源读取失败（现算刚枚举到却读不出 —— 竞态或权限问题）`);
    continue;
  }

  const recs = [];
  let sawMarker = false;
  for (const block of src.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const text = block[0];
    if (!/部署态[^\n]{0,12}建议/.test(text)) continue;
    sawMarker = true;
    for (const p of text.matchAll(/`([A-Z][A-Z0-9_]{2,})=([^`]+)`/g)) {
      recs.push({ name: p[1], value: p[2].trim(), lineNo: lineOf(src, block.index) });
    }
  }

  // ③ 解析漂移自检：有标记却零产出 = 注释格式变了而门失明，必须红，不能"没抽到 → 通过"。
  if (sawMarker && recs.length === 0) {
    errors.push(`${configRel} · 含「部署态…建议」标记却抽不出任何 \`VAR=value\`（解析漂移·门已失明）`);
    continue;
  }
  if (recs.length === 0) continue;

  const env = envBlockOf(service);
  if (env === null) {
    errors.push(`${COMPOSE_REL} · 找不到 service \`${service}\`（现算配置面里有 ${configRel}，compose 却没有同名服务 —— 新 app 须同批接 compose，或服务名与目录名对齐）`);
    continue;
  }

  for (const r of recs) {
    totalRecs++;
    // ② 注释里的名字必须真是 schema 声明的 env（防拼错 → 永远无人消费）
    if (!new RegExp(`^\\s{2}${r.name}:\\s*z\\.`, "m").test(src)) {
      errors.push(`${configRel}:${r.lineNo} · 注释建议的 \`${r.name}\` 未在 ConfigSchema 声明（拼错或已删）`);
      continue;
    }
    const got = env.map.get(r.name);
    if (!got) {
      errors.push(
        `${COMPOSE_REL} service ${service} environment（:${env.lineNo}）缺 \`${r.name}\`` +
          ` —— ${configRel}:${r.lineNo} 写了「部署态建议 ${r.name}=${r.value}」，出货配置没照做（该治理开关在容器里是死的）`,
      );
      continue;
    }
    const shipped = shippedDefault(got.raw);
    if (shipped !== r.value) {
      errors.push(
        `${COMPOSE_REL}:${got.lineNo} · ${r.name} 出货默认值 \`${shipped}\` ≠ ` +
          `${configRel}:${r.lineNo} 的部署态建议 \`${r.value}\`（两处各说各话，改一处要改两处或改建议）`,
      );
      continue;
    }
    report.push(`${service}/${r.name}=${r.value}`);
  }
}

// 零建议 = 单源被整体删空（或解析全线漂移）→ 不允许静默通过。
if (totalRecs === 0) {
  errors.push("未从任何 config.ts 抽到「部署态建议」（单源为空 = 本门无物可守，判红而非静默通过）");
}

if (errors.length > 0) {
  console.error("✗ deploy-governance:check 失败：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ deploy-governance:check 通过（${totalRecs} 条部署态建议全部在出货 compose 中落地）`);
for (const r of report) console.log(`    · ${r}`);
