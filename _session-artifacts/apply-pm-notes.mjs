import fs from "fs";
const P = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(P, "utf8"));
const items = Array.isArray(q) ? q : (q.items || []);
const byId = Object.fromEntries(items.map((x) => [x.id, x]));
const TAG = "[PM跟进2026-07-12]"; // idempotency guard
const add = (id, txt) => {
  const it = byId[id];
  if (!it) { console.log("MISS", id); return; }
  if ((it.note || "").includes(txt.trim().slice(0, 24))) { console.log("skip(dup)", id); return; }
  it.note = (it.note || "") + txt;
  console.log("noted", id);
};
// Task1 催复验 BUILT(owner=reviewer-exec/空)
add("WO-CAPSIM-REPLICA", " " + TAG + " P0·BUILT(今日V2返工)·已真浏览器复验(真Chromium/真登录planner/14项DOM断言+A/B截图对照·剥离4层平台自加层达结构对齐)→待用户1:1视觉签收决定DONE或继续优化(验证已由执行者完成)。");
add("WO-DATAMODE-UNIFY-PROVENANCE", " " + TAG + " P2·BUILT(今日)·owner空·无人认领复验→请审核方安排真浏览器复验(铁律0.4逐值对照后端provenance)→DONE或BLOCK。⚠CAPSIM§7 KILL-MOCK-RED验收前置(修合成materialized值冒充LIVE决策红)·优先级高。");
// Task2 解阻塞 BLOCKED(note+@owner·不改status)
add("WO-CAP-09-SANDBOX-TICK-LIVE", " " + TAG + " 解阻塞裁决:dep(TEMPORAL-GROUNDING)已DONE·非依赖阻塞·系审核方逐值BLOCK(磁贴全冻)。scope:本单修SandboxView(/v/sim-sandbox)tick-live——IF SandboxView随CAPSIM统一surface退役→应fold(勿修将死视图·close或re-scope到统一surface);IF保留→需真修冻结根因。前置=先确认SandboxView存废。@审核方 定scope后再动。");
add("WO-RC1-CLOSURE-SCOPE", " " + TAG + " dev3已精确定位并正确让给Dev-1(byte-baseline红线·commit 2af56f4)→@Dev-1认领:FORWARD修battery.ts:1527/1541/1546补Quote/Action类型(移demo-provenance字节基线+observability分母43→45需同补切片·高风险)或observability修(ErpOrder/MesOrder/SrmOrder建切片root)。审核方不硬扛字节风险(非其域)。");
add("WO-RC2-DEFAULT-FEED", " " + TAG + " 解阻塞裁决:无依赖阻塞·系审核方逐值BLOCK(开箱不配置=死基线·feeds=[]·utilization 16tick全93.0886冻)。谁动:根因在前端2调用点(SandboxView:999+SimInitWizard:142)createSimSession未传grounding/feedSpecs。铁律裁:开箱无真feed→诚实静止+引导配置(勿后端注入合成feed冒充活体·违G-DM-1);真fix=前端从真源传feedSpecs+无源诚实空态。@前端owner(现空·待认领)。属沙盘端到端可用性根因(与RC1同族)。");
// Task3 SA-4/5/6 依赖提醒(已被dev1推成BUILT·更新口径)
for (const id of ["WO-SA-4", "WO-SA-5", "WO-SA-6"]) add(id, " " + TAG + " dev1已BUILT(台账字段Base/Line/Equipment·datacore 1282绿·双向对齐门绿)。dep=WO-SA-3亦BUILT未DONE→建议按dep链先复验SA-3再SA-4/5/6·整批待审核方真复验(字段对齐docx Part1台账·逐值对照)→DONE或BLOCK。");
// dev2 DB批 真跑复验trace(建议DONE·不flip)
add("WO-DB-MODELING-WIRE", " [审核方复验2026-07-12·真跑] worktree真起datacore memory·pnpm test 1278绿·真上传CALB factory/production_line/equipment.csv→派生Factory/ProductionLine(factory_id FK)/Equipment(line_id FK)链100%来自上传列名·对齐CALB doc§3.3/§3.5·非硬编码。判定=DERIVE(道B✓)·非G2直导(objects.json importer是独立feature-gated admin端点·未接story引擎)。green→red(modeling-wire.test.ts③)真。CONCERN(轻·非derive缺陷):派生类型domain=unassigned→STRICT停诚实NO_SLICE(PROVISIONAL达SUCCEEDED)·归属属MERGE-03。→建议DONE·待审核方授权flip。");
add("WO-DB-LINK-STABILIZE", " [审核方复验2026-07-12·真跑] deriveSliceHops+FK名兜底(comprehend.ts:290)·planSlice真BFS maxHops6复用非重写。link-stabilize.test.ts①ref→真hops②LLM丢链→FK兜底非空③兜底OFF+丢链→hops[](红·真牙齿)④R6多跳。真跑Factory root→[ProductionLine_factory_id_ref,Equipment_line_id_ref]非空多跳·恒空切片已治。→建议DONE·待授权flip。");
add("WO-DB-BSTACK-DERIVE", " [审核方复验2026-07-12·真跑] deriveBStack(comprehend.ts:342)·步骤随scope/args变·沙盘边界守(propagationRuleNeeds/stateVarNeeds恒[]·不双写S1/RG)。bstack-derive.test.ts①异复杂度→字节不同workflow②多scope→resolve_slice③prompt含story marker④propagation恒空⑤R6。真跑prompt含「锂电基地产线设备产能健康推演」。→建议DONE·待授权flip。");
fs.writeFileSync(P, JSON.stringify(q, null, 2) + "\n");
console.log("WRITTEN");
