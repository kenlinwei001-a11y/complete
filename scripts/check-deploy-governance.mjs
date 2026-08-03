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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_REL = "docker-compose.yml";

/** 出货态映射：哪个服务的配置源 ↔ compose 里哪个 service。新增服务须在此登记，否则它的建议值无人守。 */
const APPS = [
  { configRel: "apps/agentcore/src/config.ts", service: "agentcore" },
  { configRel: "apps/datacore/src/config.ts", service: "datacore" },
];

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
let totalRecs = 0;
const report = [];

for (const { configRel, service } of APPS) {
  let src;
  try {
    src = readFileSync(join(ROOT, configRel), "utf8");
  } catch {
    errors.push(`${configRel} · 配置源不存在（APPS 登记表已过期）`);
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
    errors.push(`${COMPOSE_REL} · 找不到 service \`${service}\`（APPS 登记表与 compose 不一致）`);
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
