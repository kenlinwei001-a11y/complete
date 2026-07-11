#!/usr/bin/env node
/**
 * 门 `feature-parity:check`（堵根门·防"未注册键恒真陷阱"·系统性根治 L2-1/L1B-3 同类复发）：
 * 守**跨系统暗发 feature 键**在 DataCore(features.ts·权威源) ↔ AgentCore(registry.ts·镜像) 双注册一致。
 *
 * 根因（agentcore/src/features/registry.ts:183 `featureEnabled`）：
 *   if (!def) return true;   ← BY_KEY 里查不到该键 → **恒真 fail-open**（暗发门恒开·关不掉）。
 * 故凡 AgentCore 经 DataCore entitlement 校验的 BLOCK 级暗发键（defaultOn:false），
 * 若只在 DataCore 注册而漏注册 AgentCore → agentcore 侧 `featureEnabled` 恒真 → 暗发失效、无法回退。
 * 反向：只在 AgentCore 注册而漏 DataCore（权威源）→ 该键在 resolved set 里永不出现 → 端点恒 404。
 * 两类都靠人肉复验抓（L2-1 缺 agentcore 侧 decision.kernel·L1B-3 缺 datacore 侧 qos.workflow_dag）→ 立门自动逮。
 *
 * 范围（**显式** CROSS_SYSTEM 清单·不全量硬扫免误红）：仅列 AgentCore 经 DataCore entitlement 门控的
 * 脊柱暗发键（BLOCK·defaultOn:false）。VIEW/ACTION 类、单系统本地键、defaultOn:true 不在此门。
 * 判红：任一侧缺注册、或 level/defaultOn 不一致 → EXIT=1。
 * pending：某键 agentcore 侧接线属他 lane 未落地（如 memory.cbr_retrieve 归 Dev-1·WO-L1.5-3B）→ 声明 pending
 *   → agentcore 缺该键时**告警不判红**（不跨 lane 误伤）；一旦 agentcore 落地该键 → 自动升为硬校验 + 提示可清 pending 标。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门·堵 G 未注册恒真陷阱）。
 * 用法：node scripts/check-feature-parity.mjs
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => readFileSync(abs(rel), "utf8");

const DATACORE_FEATURES = "apps/datacore/src/features.ts";
const AGENTCORE_REGISTRY = "apps/agentcore/src/features/registry.ts";

/**
 * 跨系统暗发键权威清单（显式·脊柱·BLOCK·defaultOn:false）。
 * 每加一个 AgentCore 经 DataCore entitlement 门控的暗发键 → 此处登记一行（双注册守门自此对它生效）。
 * pending：agentcore 侧接线尚未落地（他 lane WO）→ 缺 agentcore 注册时告警不判红。
 */
const CROSS_SYSTEM = [
  { key: "decision.kernel", level: "BLOCK", defaultOn: false },
  { key: "qos.workflow_dag", level: "BLOCK", defaultOn: false },
  { key: "qos.exec_planner", level: "BLOCK", defaultOn: false },
  { key: "growth.pre_analysis", level: "BLOCK", defaultOn: false },
  { key: "memory.cbr", level: "BLOCK", defaultOn: false },
  // agentcore 侧 retrieve 工具适配器归 Dev-1（WO-L1.5-3B）·尚未注册 → pending（缺 agentcore 告警不判红·落地即硬校验）。
  { key: "memory.cbr_retrieve", level: "BLOCK", defaultOn: false, pending: "WO-L1.5-3B (Dev-1·agentcore retrieve tool)" },
];

/**
 * 解析 FeatureDef 注册表源码 → Map<key, {level, defaultOn}>。
 * 逐行匹配 `{ key: "X", ... level: "Y", ... defaultOn: Z ... }`（两注册表均单行条目）。
 * 仅取真源码（去 `//` 行注释）避免注释里的示例键误判为已注册。
 */
function parseRegistry(src) {
  const byKey = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\/\/.*$/, ""); // 去行尾注释（注释里 key: "…" 不算注册）
    const km = line.match(/key:\s*"([^"]+)"/);
    if (!km) continue;
    const lm = line.match(/level:\s*"([^"]+)"/);
    const dm = line.match(/defaultOn:\s*(true|false)/);
    if (!lm || !dm) continue; // 非完整单行 FeatureDef 条目
    byKey.set(km[1], { level: lm[1], defaultOn: dm[1] === "true" });
  }
  return byKey;
}

/**
 * 纯校验核（可被 selftest 喂合成源·证有牙）：比对两侧注册表。
 * 返回 { failures:[], warnings:[] }。
 */
function checkParity(datacoreSrc, agentcoreSrc) {
  const dc = parseRegistry(datacoreSrc);
  const ac = parseRegistry(agentcoreSrc);
  const failures = [];
  const warnings = [];

  for (const spec of CROSS_SYSTEM) {
    const d = dc.get(spec.key);
    const a = ac.get(spec.key);

    // 1) DataCore（权威源）——必须注册且 level/defaultOn 与声明一致（无 pending 豁免·权威源在本 lane）。
    if (!d) {
      failures.push(`DataCore features.ts 缺跨系统暗发键 "${spec.key}"（权威源缺 → resolved set 永不含该键 → 端点恒 404）`);
    } else {
      if (d.level !== spec.level) failures.push(`"${spec.key}" DataCore level=${d.level}·应=${spec.level}`);
      if (d.defaultOn !== spec.defaultOn) failures.push(`"${spec.key}" DataCore defaultOn=${d.defaultOn}·应=${spec.defaultOn}（暗发须 defaultOn:false）`);
    }

    // 2) AgentCore（镜像）——须注册（否则 featureEnabled `!def→return true` 恒真 fail-open·暗发失效）。
    if (!a) {
      if (spec.pending) {
        warnings.push(`"${spec.key}" AgentCore 未注册（pending ${spec.pending}）——落地前告警不判红；落地即须双注册一致`);
      } else {
        failures.push(`AgentCore registry.ts 缺跨系统暗发键 "${spec.key}"（featureEnabled !def→return true 恒真 fail-open·暗发门关不掉）`);
      }
    } else {
      if (a.level !== spec.level) failures.push(`"${spec.key}" AgentCore level=${a.level}·应=${spec.level}（与 DataCore 权威不一致）`);
      if (a.defaultOn !== spec.defaultOn) failures.push(`"${spec.key}" AgentCore defaultOn=${a.defaultOn}·应=${spec.defaultOn}（与 DataCore 权威不一致）`);
      if (spec.pending) warnings.push(`"${spec.key}" AgentCore 已注册但清单仍标 pending（${spec.pending}）——可移除该 pending 标·转硬校验`);
    }
  }
  return { failures, warnings };
}

// ── 自测（有牙·green→red·不碰真文件）：合成"删 agentcore 一键"必被抓；补回必绿 ──────────────
function selfTest() {
  const dcReal = read(DATACORE_FEATURES);
  const acReal = read(AGENTCORE_REGISTRY);
  const errs = [];

  // (a) 真基线：不该有 failures（warnings 允许·pending）。
  const base = checkParity(dcReal, acReal);
  if (base.failures.length > 0) errs.push(`自测(a) 真基线不应有 failures：${base.failures.join(" / ")}`);

  // (b) 合成删除 agentcore 侧 decision.kernel（硬键·非 pending）→ 必判红。
  const acDropped = acReal.split("\n").filter((l) => !/key:\s*"decision\.kernel"/.test(l)).join("\n");
  const dropped = checkParity(dcReal, acDropped);
  if (!dropped.failures.some((f) => f.includes("decision.kernel"))) {
    errs.push("自测(b) 删 agentcore decision.kernel 未判红——门无牙");
  }

  // (c) 合成篡改 datacore 侧 defaultOn:false→true（暗发被翻默认开）→ 必判红。
  const dcTampered = dcReal.replace(
    /(\{ key: "decision\.kernel"[^\n]*defaultOn:\s*)false/,
    "$1true",
  );
  if (dcTampered !== dcReal) {
    const tampered = checkParity(dcTampered, acReal);
    if (!tampered.failures.some((f) => f.includes("decision.kernel") && f.includes("defaultOn"))) {
      errs.push("自测(c) 篡改 datacore decision.kernel defaultOn 未判红——门无牙");
    }
  } else {
    errs.push("自测(c) 未能定位 datacore decision.kernel defaultOn 行（正则漂移）");
  }

  return errs;
}

// ── 执行 ──────────────────────────────────────────────────────────────────────
const selfErrs = selfTest();
const { failures, warnings } = checkParity(read(DATACORE_FEATURES), read(AGENTCORE_REGISTRY));

for (const w of warnings) console.warn("  ⚠ " + w);

if (selfErrs.length || failures.length) {
  console.error("✗ feature-parity:check 失败：");
  for (const e of selfErrs) console.error("  - [自测] " + e);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ feature-parity:check 通过（${CROSS_SYSTEM.length} 跨系统暗发键双注册一致·门自测有牙·${warnings.length} pending 告警）`);
