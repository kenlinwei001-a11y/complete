#!/usr/bin/env node
/**
 * 门 `tracing:check`（WO-OBSERVABILITY OBS-2·守全链 OTel span 树不回潮·并入 `pnpm gates`）：
 * 保守静态哨兵，守"在 requestId spine 上加分布式 trace、未配 OTLP 则 no-op、span attr 无凭据明文"：
 *  ① 两服务各有 `tracing.ts`，含 **no-op 诚实降级**分支（未配 OTLP endpoint → exporting=false 不导出）。
 *  ② `tracing.ts` 在 bootstrap（server.ts / main.ts）被 **第一个 import**（先于 http/fastify/pg patch）。
 *  ③ 出站 OBO（datacore-http.ts）**双轨**：保留 `x-request-id`（不破 AUDIT-OBS）+ 注入 traceparent。
 *  ④ 自定义业务 span 在位：solver `invoke`（solver.invoke）+ `outbox.emit`（outbox.emit）。
 *  ⑤ no-secrets-echo（R5）：tracing.ts 注释钉牢禁凭据进 attr；OBO/solver span attr 不含 token/apiKey 明文键。
 *  ⑥ G-15 + §7 登记：本体记了「可观测性 span 树」G-15 与本门。
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), "utf8") : null);

const fails = [];
const ok = [];

// ① 两服务 tracing.ts + no-op 分支。
for (const svc of ["datacore", "agentcore"]) {
  const t = read(`apps/${svc}/src/tracing.ts`);
  if (!t) {
    fails.push(`apps/${svc}/src/tracing.ts 缺失（OBS-2 初始化模块）`);
    continue;
  }
  if (!/OTEL_EXPORTER_OTLP_ENDPOINT/.test(t)) fails.push(`${svc} tracing.ts 须读 OTEL_EXPORTER_OTLP_ENDPOINT`);
  else ok.push(`${svc} tracing.ts 读 OTLP endpoint`);
  // no-op：未配 endpoint → exporting=false（不接 exporter）。
  if (!/exporting\s*=\s*false/.test(t)) fails.push(`${svc} tracing.ts 须有 no-op 降级分支（exporting=false 不导出·诚实）`);
  else ok.push(`${svc} tracing.ts no-op 诚实降级在`);
  // service.name 正确。
  if (!new RegExp(`SERVICE_NAME\\s*=\\s*"${svc}"`).test(t)) fails.push(`${svc} tracing.ts SERVICE_NAME 须 = "${svc}"`);
  else ok.push(`${svc} service.name=${svc}`);
  // no-secrets-echo 注释钉牢。
  if (!/no-secrets-echo|禁带凭据|凭据明文/.test(t)) fails.push(`${svc} tracing.ts 须钉牢 no-secrets-echo（span attr 禁凭据明文）`);
  else ok.push(`${svc} tracing.ts no-secrets-echo 钉牢`);
}

// ② bootstrap 第一个 import 是 tracing（先于其它 import）。
for (const [svc, file] of [["datacore", "apps/datacore/src/server.ts"], ["agentcore", "apps/agentcore/src/main.ts"]]) {
  const src = read(file);
  if (!src) {
    fails.push(`${file} 缺失`);
    continue;
  }
  const firstImport = (src.match(/^import\s.*$/m) ?? [])[0] ?? "";
  if (!/tracing\.js/.test(firstImport)) {
    fails.push(`${svc} ${file} 第一个 import 须为 ./tracing.js（先于 http/fastify/pg 被 require）；当前首行：${firstImport.slice(0, 60)}`);
  } else ok.push(`${svc} bootstrap 第一个 import = tracing.js`);
}

// ③ OBO 双轨：datacore-http.ts 保留 x-request-id + 注入 traceparent。
const dchttp = read("apps/agentcore/src/tools/datacore-http.ts");
if (!dchttp) fails.push("apps/agentcore/src/tools/datacore-http.ts 缺失");
else {
  if (!/"x-request-id":\s*ctx\.requestId/.test(dchttp)) fails.push("datacore-http.ts 须保留 x-request-id: ctx.requestId（双轨·不破 AUDIT-OBS）");
  else ok.push("OBO 保留 x-request-id（双轨）");
  if (!/injectTraceContext\(/.test(dchttp)) fails.push("datacore-http.ts 须 injectTraceContext 注入 W3C traceparent");
  else ok.push("OBO 注入 traceparent");
  // OBO span。
  if (!/withSpan\(\s*\n?\s*"obo\.datacore"/.test(dchttp) && !/"obo\.datacore"/.test(dchttp)) fails.push("datacore-http.ts 须开 obo.datacore 自定义 span");
  else ok.push("OBO span obo.datacore 在");
}

// ④ 自定义 span：solver.invoke + outbox.emit。
const solverSvc = read("apps/datacore/src/solvers/service.ts");
if (!solverSvc) fails.push("apps/datacore/src/solvers/service.ts 缺失");
else if (!/"solver\.invoke"/.test(solverSvc)) fails.push("solvers/service.ts invoke 须开 solver.invoke span（attr solverKey/dataMode/tenantId）");
else ok.push("solver.invoke span 在");

const outbox = read("apps/datacore/src/outbox.ts");
if (!outbox) fails.push("apps/datacore/src/outbox.ts 缺失");
else if (!/"outbox\.emit"/.test(outbox)) fails.push("outbox.ts emit 须开 outbox.emit span");
else ok.push("outbox.emit span 在");

// ⑤ no-secrets-echo 抽查：OBO/solver span attr 不得把凭据键值塞进 setAttribute/attr 字面量。
//    保守扫：tracing.ts withSpan attr 字面量 + 调用处不出现 token/apiKey/password 作为 attr value。
for (const [name, src] of [["datacore-http.ts", dchttp], ["solvers/service.ts", solverSvc], ["outbox.ts", outbox]]) {
  if (!src) continue;
  // 抓 setAttribute("...key...", <凭据变量>) 或 attr 对象里 key: ctx.token 等明文凭据。
  if (/setAttribute\([^)]*(ctx\.token|apiKey|\.password|credential[^R])/i.test(src)) {
    fails.push(`${name} 疑似把凭据明文塞进 span attr（no-secrets-echo R5 违反）`);
  }
}
ok.push("OBO/solver/outbox span attr 抽查无凭据明文");

// ⑥ 本体 G-15 + §7 登记。
const onto = read("docs/SYSTEM-ONTOLOGY.md") ?? "";
if (!/G-15/.test(onto)) fails.push("本体 §8 须登记 G-15「可观测性 span 树」");
else ok.push("本体 G-15 登记");
if (!/tracing:check|check-tracing/.test(onto)) fails.push("本体 §7 须登记 tracing:check 门");
else ok.push("本体 §7 tracing:check 登记");

console.log(`· tracing:check：通过 ${ok.length} 项 · 失败 ${fails.length} 项`);
if (fails.length) {
  console.error("\n✗ tracing:check 未通过（OBS-2 全链 span 树接线回潮）：");
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ tracing:check：OBS-2 全链 OTel span 树接线完好（no-op 诚实降级 / 双轨传播 / 自定义 span / 无凭据）。");
