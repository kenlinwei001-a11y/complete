// WO-MULTISRC-FUSION-DOMAIN · FDE 真跑驱动（亲手用一遍·真 HTTP·非测试绿）。
// 真起 datacore（内存 SEED_DEMO 等价）→ 注同一 Order 多源(ERP 交期 vs MES 交期) + 某源虚报产能 →
// 经真 HTTP POST /a/v1/solvers/multisource_fusion/invoke 融合 → GET /a/v1/fused-objects + /a/v1/audit-log 复盘。
// 复用 tests 的 buildApp 构造（同真求解器/审计/仓储管线），但经真 fetch over 127.0.0.1 出证。
import { buildApp } from "../apps/datacore/dist/app.js";
import { loadConfig } from "../apps/datacore/dist/config.js";
import { createMemoryRepos } from "../apps/datacore/dist/repo/memory.js";
import { LocalFsBlobStore } from "../apps/datacore/dist/blob.js";
import { ScriptedLlmClient } from "../apps/datacore/dist/llm.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TENANT = "demo";
const H = { "content-type": "application/json", "X-Debug-User": "demo:planner01:admin" };

function ty(key, props) {
  return {
    id: `ot_${TENANT}_${key}`, tenantId: TENANT, key, displayName: key, domain: "sales", version: 1, status: "ACTIVE",
    derivedProperties: [], sourceBindings: [], properties: props,
  };
}

async function main() {
  const blobDir = await mkdtemp(join(tmpdir(), "fde-fuse-"));
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "dev" });
  const repos = createMemoryRepos();
  const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });

  // --- 注多源对象（经 SolverBinding 之上：各源真实类型，融合时经 sources 字段映射归一到 role）---
  // ① 同一 Order SO-3391：ERP 报乐观交期 09-01，MES 因产能不足报实际交期 09-20（交期风险两源各执一词）。
  await repos.ontologyTypes.put(ty("ErpOrder", [
    { propKey: "so", dataType: "string", isPrimaryKey: true },
    { propKey: "due", dataType: "string", isPrimaryKey: false },
    { propKey: "asOf", dataType: "string", isPrimaryKey: false },
  ]));
  await repos.ontologyTypes.put(ty("MesOrder", [
    { propKey: "so", dataType: "string", isPrimaryKey: true },
    { propKey: "due", dataType: "string", isPrimaryKey: false },
    { propKey: "asOf", dataType: "string", isPrimaryKey: false },
  ]));
  await repos.objects.put({ id: "erp1", tenantId: TENANT, type: "ErpOrder", origin: { type: "MANUAL" }, props: { so: "SO-3391", due: "2026-09-01", asOf: "2026-06-10" } });
  await repos.objects.put({ id: "mes1", tenantId: TENANT, type: "MesOrder", origin: { type: "MANUAL" }, props: { so: "SO-3391", due: "2026-09-20", asOf: "2026-06-25" } });

  // ② 常州基地产能虚报：SCADA 实测 100 / MES 实测 105 / 基地自报 200（虚报好看）→ 测谎命中。
  const capTy = (key) => ({ ...ty(key, [
    { propKey: "base", dataType: "string", isPrimaryKey: true },
    { propKey: "capacity", dataType: "number", isPrimaryKey: false },
  ]), domain: "mfg" });
  await repos.ontologyTypes.put(capTy("ScadaCap"));
  await repos.ontologyTypes.put(capTy("MesCap"));
  await repos.ontologyTypes.put(capTy("SelfReportCap"));
  await repos.objects.put({ id: "sc1", tenantId: TENANT, type: "ScadaCap", origin: { type: "MANUAL" }, props: { base: "常州", capacity: 100 } });
  await repos.objects.put({ id: "mc1", tenantId: TENANT, type: "MesCap", origin: { type: "MANUAL" }, props: { base: "常州", capacity: 105 } });
  await repos.objects.put({ id: "rc1", tenantId: TENANT, type: "SelfReportCap", origin: { type: "MANUAL" }, props: { base: "常州", capacity: 200 } });

  const base = await built.app.listen({ port: 0, host: "127.0.0.1" });
  const url = (p) => `${base}${p}`;
  const post = async (p, body) => (await fetch(url(p), { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  const get = async (p) => (await fetch(url(p), { headers: H })).json();

  const out = (label, obj) => console.log(`\n#### ${label}\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``);

  console.log("# WO-MULTISRC-FUSION-DOMAIN · FDE 真跑证据（真 HTTP over 127.0.0.1）\n");
  console.log(`> 真起 datacore（buildApp·内存仓储）监听 ${base}·X-Debug-User: demo:planner01:admin\n`);

  // ---- 场景1：同一 Order 多源交期各执一词 → 交期风险带两源仲裁（答案标明取哪源/为何·置信反映一致性）----
  const fuse1 = await post("/a/v1/solvers/multisource_fusion/invoke", { args: {
    role: "order", fields: ["due"],
    sources: [
      { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1, asOfField: "asOf" },
      { sourceLabel: "MES", typeKey: "MesOrder", authority: 3, asOfField: "asOf" },
    ],
    defaultStrategy: "AUTHORITY",
  }});
  out("场景1 · POST /a/v1/solvers/multisource_fusion/invoke（订单交期两源仲裁）", fuse1);

  // ---- 场景2：某源虚报产能 → 测谎 SUSPECT + 置信降级（不照单全收）----
  const fuse2 = await post("/a/v1/solvers/multisource_fusion/invoke", { args: {
    role: "base_capacity", fields: ["capacity"],
    sources: [
      { sourceLabel: "SCADA", typeKey: "ScadaCap", authority: 3 },
      { sourceLabel: "MES", typeKey: "MesCap", authority: 2 },
      { sourceLabel: "SELF", typeKey: "SelfReportCap", authority: 1 },
    ],
    suspectThreshold: 0.15,
  }});
  out("场景2 · POST .../invoke（常州产能：基地自报 200 vs 实测 100/105 → 测谎 SUSPECT）", fuse2);

  // ---- AUDIT 留痕可查（复盘）----
  const fused = await get("/a/v1/fused-objects?verdict=SUSPECT");
  out("AUDIT-1 · GET /a/v1/fused-objects?verdict=SUSPECT（融合态快照复盘：取哪源/为何/测谎证据）", fused);
  const audit = await get("/a/v1/audit-log?target=FusedObject");
  out("AUDIT-2 · GET /a/v1/audit-log?target=FusedObject（append-only 审计：actor/取哪源/为何/置信）", audit);

  // ---- R6 确定性：重跑场景1 字节一致 ----
  const fuse1b = await post("/a/v1/solvers/multisource_fusion/invoke", { args: {
    role: "order", fields: ["due"],
    sources: [
      { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1, asOfField: "asOf" },
      { sourceLabel: "MES", typeKey: "MesOrder", authority: 3, asOfField: "asOf" },
    ],
    defaultStrategy: "AUTHORITY",
  }});
  console.log(`\n#### R6 确定性：场景1 重跑与首跑字节一致 = ${JSON.stringify(fuse1) === JSON.stringify(fuse1b)}`);

  await built.app.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
