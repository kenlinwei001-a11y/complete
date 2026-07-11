#!/usr/bin/env node
/**
 * 门 `feature-parity:check`（堵根门·防"未注册键恒真陷阱"·系统性根治 L2-1/L1B-3 同类复发）：
 * 守**跨系统暗发 feature 键**在 DataCore(features.ts·权威源) ↔ AgentCore(registry.ts·镜像) 双注册一致。
 *
 * 根因（agentcore/src/features/registry.ts `featureEnabled`）：
 *   if (!def) return true;   ← BY_KEY 里查不到该键 → **恒真 fail-open**（暗发门恒开·关不掉）。
 * 故凡 AgentCore 经 DataCore entitlement 校验的 BLOCK 级暗发键（defaultOn:false），
 * 若只在 DataCore 注册而漏注册 AgentCore → agentcore 侧 `featureEnabled` 恒真 → 暗发失效、无法回退。
 * 反向：只在 AgentCore 注册而漏 DataCore（权威源）→ 该键在 resolved set 里永不出现 → 端点恒 404。
 *
 * ⛔ 比对集**派生·非手工策展**（复验 BLOCK 根因：手工清单正是漏键根源——L2-1 式 fail-open 键漏守）。
 * enforced = ① AgentCore registry 里 BLOCK/defaultOn:false 键（镜像集·每个都应与 DataCore 权威一致）
 *          ∪ ② AgentCore 源码里经 entitlement 真消费的键（isEnabled/featureEnabled 第二实参字面）
 *              ∩ DataCore 里 BLOCK/defaultOn:false 键（= 真暗发键·排除偶然消费的 VIEW/defaultOn:true 键）。
 *   ①保证每个 agentcore 镜像键对齐 DataCore；②即便 agentcore **删了注册但仍在消费**（真 fail-open）也被逮
 *     （registered 集丢了它·但 consumed∩dcBlockOff 仍含它 → agentcore 缺 → 红）。
 *   pending 天然处理：DataCore-only 的 BLOCK/off 键（agentcore 既未注册也未消费）不入 enforced → 不误红
 *     （如某键 agentcore 侧接线尚未落地）；一旦 agentcore 注册或消费它 → 自动纳入硬校验。
 * 判红：enforced 键任一侧缺注册、或 level/defaultOn 与 {BLOCK,false} 不符 → EXIT=1。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门·堵未注册恒真陷阱类回归）。
 * 用法：node scripts/check-feature-parity.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const absPath = (rel) => fileURLToPath(new URL(rel, root));
const read = (rel) => readFileSync(absPath(rel), "utf8");

const DATACORE_FEATURES = "apps/datacore/src/features.ts";
const AGENTCORE_REGISTRY = "apps/agentcore/src/features/registry.ts";
const AGENTCORE_SRC = "apps/agentcore/src";

/**
 * 解析 FeatureDef 注册表源码 → Map<key, {level, defaultOn}>（逐行·两注册表均单行条目·去行注释免误判）。
 */
function parseRegistry(src) {
  const byKey = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    const km = line.match(/key:\s*"([^"]+)"/);
    if (!km) continue;
    const lm = line.match(/level:\s*"([^"]+)"/);
    const dm = line.match(/defaultOn:\s*(true|false)/);
    if (!lm || !dm) continue;
    byKey.set(km[1], { level: lm[1], defaultOn: dm[1] === "true" });
  }
  return byKey;
}

const isBlockOff = (d) => !!d && d.level === "BLOCK" && d.defaultOn === false;

/**
 * 派生 AgentCore 经 entitlement **真消费**的 feature 键集：扫全 agentcore/src *.ts，
 * 取 `isEnabled(<tenant>, "key", …)` / `featureEnabled(<set>, "key")` 第二实参字面。
 * （消费=fail-open 面：消费却漏注册即恒真陷阱·故消费键必须双注册。）
 */
function agentcoreConsumedKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = `${dir}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".ts")) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:isEnabled|featureEnabled)\(\s*[^,]+,\s*["']([a-z][a-z0-9_.]+)["']/g)) keys.add(m[1]);
      }
    }
  };
  walk(absPath(AGENTCORE_SRC));
  return keys;
}

/**
 * 纯校验核（可被 selftest 喂合成源·证有牙）。dc/ac = 注册表源码；consumed = agentcore 真消费键集。
 * 返回 { enforced:[], failures:[] }。
 */
function checkParity(datacoreSrc, agentcoreSrc, consumed) {
  const dc = parseRegistry(datacoreSrc);
  const ac = parseRegistry(agentcoreSrc);

  // 派生 enforced 集（非手工策展）。
  const enforced = new Set();
  for (const [k, d] of ac) if (isBlockOff(d)) enforced.add(k); // ① agentcore 镜像 BLOCK/off
  for (const k of consumed) if (isBlockOff(dc.get(k))) enforced.add(k); // ② 消费键 ∩ dc BLOCK/off（真暗发）

  const failures = [];
  for (const key of [...enforced].sort()) {
    const d = dc.get(key);
    const a = ac.get(key);
    // DataCore（权威源）必 BLOCK/off。
    if (!d) failures.push(`DataCore features.ts 缺跨系统暗发键 "${key}"（权威源缺 → resolved set 永不含该键 → 端点恒 404）`);
    else if (!isBlockOff(d)) failures.push(`"${key}" DataCore={level:${d.level},defaultOn:${d.defaultOn}}·应 {BLOCK,false}`);
    // AgentCore（镜像）必 BLOCK/off，否则 featureEnabled !def→return true 恒真 fail-open。
    if (!a) failures.push(`AgentCore registry.ts 缺跨系统暗发键 "${key}"（featureEnabled !def→return true 恒真 fail-open·暗发门关不掉${consumed.has(key) ? "·且该键正被消费" : ""}）`);
    else if (!isBlockOff(a)) failures.push(`"${key}" AgentCore={level:${a.level},defaultOn:${a.defaultOn}}·应 {BLOCK,false}（与 DataCore 权威不一致）`);
  }
  return { enforced: [...enforced].sort(), failures };
}

// ── 自测（有牙·green→red·不碰真文件）─────────────────────────────────────────
function selfTest() {
  const dcReal = read(DATACORE_FEATURES);
  const acReal = read(AGENTCORE_REGISTRY);
  const consumed = agentcoreConsumedKeys();
  const errs = [];

  // (a) 真基线：不该有 failures。
  const base = checkParity(dcReal, acReal, consumed);
  if (base.failures.length > 0) errs.push(`自测(a) 真基线不应有 failures：${base.failures.join(" / ")}`);
  // 覆盖面自证：复验点名的 3 个 fail-open 键必在 enforced（防手工漏守回潮）。
  for (const k of ["growth.requirement_graph", "growth.hidden_req", "sim.sandbox_render"]) {
    if (!base.enforced.includes(k)) errs.push(`自测(a) enforced 漏点名键 "${k}"（覆盖盲区回潮）`);
  }

  // (b) 合成删 agentcore decision.kernel 注册 → 必红（镜像键删）。
  const acNoKernel = acReal.split("\n").filter((l) => !/key:\s*"decision\.kernel"/.test(l)).join("\n");
  if (!checkParity(dcReal, acNoKernel, consumed).failures.some((f) => f.includes("decision.kernel"))) {
    errs.push("自测(b) 删 agentcore decision.kernel 未判红——门无牙");
  }

  // (c) 复验点名场景·根治齿：删 agentcore growth.requirement_graph **注册**但源码仍**消费** → 必红
  //     （registered 集丢它·consumed∩dcBlockOff 仍含它 → agentcore 缺 fail-open 被逮·手工清单漏的正是此类）。
  const acNoReqGraph = acReal.split("\n").filter((l) => !/key:\s*"growth\.requirement_graph"/.test(l)).join("\n");
  const dropped = checkParity(dcReal, acNoReqGraph, consumed); // consumed 仍含 growth.requirement_graph（真源码消费）
  if (!dropped.failures.some((f) => f.includes("growth.requirement_graph"))) {
    errs.push("自测(c) 删 agentcore growth.requirement_graph 注册（仍消费）未判红——消费派生无牙·fail-open 放行");
  }

  // (d) 合成篡改 datacore decision.kernel defaultOn:false→true → 必红。
  const dcTampered = dcReal.replace(/(\{ key: "decision\.kernel"[^\n]*defaultOn:\s*)false/, "$1true");
  if (dcTampered !== dcReal) {
    if (!checkParity(dcTampered, acReal, consumed).failures.some((f) => f.includes("decision.kernel") && f.includes("defaultOn"))) {
      errs.push("自测(d) 篡改 datacore decision.kernel defaultOn 未判红——门无牙");
    }
  } else errs.push("自测(d) 未能定位 datacore decision.kernel defaultOn 行（正则漂移）");

  return errs;
}

// ── 执行 ──────────────────────────────────────────────────────────────────────
const selfErrs = selfTest();
const consumed = agentcoreConsumedKeys();
const { enforced, failures } = checkParity(read(DATACORE_FEATURES), read(AGENTCORE_REGISTRY), consumed);

if (selfErrs.length || failures.length) {
  console.error("✗ feature-parity:check 失败：");
  for (const e of selfErrs) console.error("  - [自测] " + e);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ feature-parity:check 通过（派生 ${enforced.length} 跨系统暗发键双注册一致·门自测有牙·消费键 ${consumed.size}）`);
console.log(`  enforced: ${enforced.join(", ")}`);
