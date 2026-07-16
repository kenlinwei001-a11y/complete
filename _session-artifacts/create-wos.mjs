import fs from "fs";
const P = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(P, "utf8"));
const items = Array.isArray(q) ? q : (q.items || []);
const byId = Object.fromEntries(items.map((x) => [x.id, x]));
const NOW = "2026-07-12T15:10:00.000Z";
function add(wo) {
  if (byId[wo.id]) { console.log("exists(skip)", wo.id); return; }
  const full = { priority: wo.p, deps: wo.deps || [], status: wo.status || "TODO",
    owner: wo.owner || "", at: wo.owner && wo.status === "WIP" ? { created: NOW, wip: NOW } : { created: NOW },
    id: wo.id, title: wo.title, note: wo.note };
  items.push(full); byId[wo.id] = full; console.log("created", wo.id, wo.status || "TODO", wo.owner || "-");
}
// ── 3 派给空闲 dev（CAPSIM 1:1 三 workstream 的 B/C + 解 BLOCKED 根）──
add({ id: "WO-CAPSIM-FRONTEND-PARITY", p: "P1", status: "WIP", owner: "dev1",
  title: "CAPSIM 前端交互/视图 parity(补 backend-real gap 漏项):QA真agt_risk调用+富逐日hover+四增强+导出+配色档裁定",
  note: "[审核方派dev1·2026-07-12·用户评估补漏·真代码核验RiskBoardView.tsx] 铁律0.4命门:①QaPanel现纯前端正则(tsx:811-814 /客户|谁/.test)零agent调用·答案派生本地card→改真调 agt_risk(经QOS或直端点)·答案来自真agent。②逐日圆点hover现仅原生title(tsx:730)→富弹窗showDayTip(日期+T+d+当日值+事件脉冲+受影响订单明细表·参照HTML:2547)。③四增强:多方案topN+比较矩阵(现MitigationCards无对比)/缺失分类面板(未实现)/全元素悬浮溯源(RiskHoverTrigger现仅包factor chip tsx:325→扩全元素)/InferenceProcessPanel(tsx:452存在·须验内容接真provenance非写死)。④导出最终规划button(疑缺·参照HTML:3491)。⑤配色档:现#43B7D7/#E8B54A/#E0626C vs 参照#62BE77/#D2B04C/#DD7E9E(原铁律颜色走tokens·像素1:1需调token·待用户定)。真浏览器逐值:QA答案=真agent输出·hover=真事件/订单。禁前端写死。注:订单聚合tab(tsx:257-260)+经营看板inline(tsx:516)V2已接·非本单。" });
add({ id: "WO-DATAMODE-DERIVECELLMODE-FIX", p: "P2", status: "WIP", owner: "dev2",
  title: "修 deriveCellMode 漏 MATERIALIZED-from-synthetic → demo 102/102 全标LIVE(合成物化冒充实测·解TRUST-BADGE-BE BLOCK)",
  note: "[审核方派dev2·2026-07-12·DATAMODE-UNIFY复验发现根bug] deriveCellMode 未识别合成物化态(materialized-from-synthetic)→demo 102/102 单元格全标LIVE=合成冒充实测(违铁律0.4/G-DM-1)。修:识别 synthetic-origin materialized→标 SYNTHETIC/MATERIALIZED 非 LIVE。解 WO-SANDBOX-TRUST-BADGE-BE(WIP·审核co-verify BLOCK)。真跑逐值:合成源物化单元格标合成非实测·green→red锁。" });
add({ id: "WO-QOS-CLASSIFY-REBALANCE", p: "P1", status: "WIP", owner: "dev4",
  title: "QOS分类器示例再平衡:signal_propagation_q/shared_bottleneck_q 补足示例·解'未来30天瓶颈影响交付'误路由→'缺乏方案比对'",
  note: "[审核方派dev4·2026-07-12·用户精确根因·修正早前LLM凭据粗诊断] 原始bug问句'未来30天每个瓶颈会影响订单的交付?'误路由。根因=what_if_displacement_q 有3示例·signal_propagation_q/shared_bottleneck_q 各仅1→语义重叠→误路由 plan_what_if_displacement_q_v1→multi_plan_compare报'缺乏方案比对'。修:给 signal_propagation_q/shared_bottleneck_q 补≥3区分性示例或加消歧规则。真跑复现该问句→应路由 signal_propagation 非 displacement。" });
// ── CAPSIM 后端密度（executor·sub-agent 正跑）──
add({ id: "WO-CAPSIM-BACKEND-DENSITY", p: "P0", status: "WIP", owner: "reviewer-exec",
  title: "CAPSIM 后端真数据密度:种真OEE/利用率/良率+抬需求缺口→risk_timeline真出8越线卡/多因素/17行(零前端造假·守seed42基线)",
  note: "[审核方执行者·2026-07-12·sub-agent prototyping中] gap分析:链路几乎全真·差seed真数据热度。P0-1种真OEE/利用率/良率时序·P0-2抬≥8 base×factor真需求缺口·P1-3 risk_timeline出factors[]·P2-5真时延→C09横幅。严守不破坏基线(seed42字节parity·debattery/genuine-sim绿·不搬参照值)。真跑证≥6越线卡dataMode=LIVE。approach出后交审核方复验→提交或转dev4生产。" });
// ── 7 项"你亲点·无WO"补登(防沉没·TODO 未认领)──
add({ id: "WO-DEBT-A3-MULTIHOP-SLICE", p: "P1", title: "14域参考运营本体+域内/跨域两库+多跳切片规划器+切片索引复用(🔴FDE核心'富多跳切片'载体)",
  note: "[补登防沉没·2026-07-12] DEBT A3·用户亲点最新需求·整块未动(仅 slice-planner BFS 雏形)。最大单块。是FDE富多跳切片的载体。" });
add({ id: "WO-DEBT-A4-OBJECT-BROWSER", p: "P2", title: "对象/类型浏览器管理页(admin)",
  note: "[补登防沉没·2026-07-12] DEBT A4·用户实测'找不到'·至今无 admin 对象浏览页。" });
add({ id: "WO-DEBT-A5-FDE-NODEGRAPH", p: "P2", title: "FDE编排工作流可观测节点图(有保证终态)",
  note: "[补登防沉没·2026-07-12] DEBT A5·无可观测 FDE 节点图。" });
add({ id: "WO-DEBT-A15-LOADTEST", p: "P2", title: "工业级压测(规模/并发/负载)",
  note: "[补登防沉没·2026-07-12] DEBT A15·用户原话'你做了工业级压测吗'·现仅功能单测·无规模/并发/负载。" });
add({ id: "WO-DEBT-A16-E2E-CI", p: "P3", title: "真浏览器UI E2E进CI(脚本已9/9过·待用户拍板进CI vs 夜间)",
  note: "[补登防沉没·2026-07-12] DEBT A16·🔒待用户拍板 CI vs 夜间。" });
add({ id: "WO-U12-GRAPH-QUERY-LOWCODE", p: "P2", title: "图查询低代码/平台查询语言/Query→Skill绑定",
  note: "[补登防沉没·2026-07-12] U12·诚实 RESERVED·后端整块未建·前端未画假壳。" });
add({ id: "WO-EDS-6PHASE-EPIC", p: "P1", title: "6-phase EDS 三条道总epic(道A导入Phase1-3/道B派生本体/道C能力装载)",
  note: "[补登防沉没·2026-07-12] 6-phase EDS·仅评审稿(REVIEW-6phase-eds-value.md)+源文件落档(reference-datafields-CALB.txt/reference-sysdata-EDS-6phase.txt)·无总epic。部件散LaneB(DB-DERIVE-DECISION-FIELDS WIP/DB-MODELING-WIRE BUILT/IMPORT-REPLACE-SYNTHETIC BUILT)。本单=串起总账+补缺件。" });
fs.writeFileSync(P, JSON.stringify(q, null, 2) + "\n");
console.log("TOTAL items now:", items.length);
