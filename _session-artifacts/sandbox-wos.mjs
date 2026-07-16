import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const add = (o) => { let it=q.items.find(x=>x.id===o.id); if(!it){it={at:{}};q.items.push(it);} Object.assign(it,o); it.at=(it.at&&typeof it.at==="object")?it.at:{}; };
const S=[
 {id:"WO-SANDBOX-CONFIG-COVERAGE",pri:"P1",deps:[],doc:"docs/WO-SANDBOX-CONFIG-COVERAGE.md",
  title:"S0·沙盘配套纳入gap覆盖(propagation_rule/state_var两kind·后端·全套前置)",
  note:"[沙盘重建·S0·全套前置·后端不碰前端·dev3] 主PRD diffGap已就绪。additive两kind·无迁移·复用sim_propagation_rule表。回退:摘两provisioner+枚举。"},
 {id:"WO-SANDBOX-AS-RENDER-TARGET",pri:"P1",deps:["WO-SANDBOX-CONFIG-COVERAGE"],doc:"docs/WO-SANDBOX-AS-RENDER-TARGET.md",
  title:"S1·沙盘→时序推演意图落地渲染器(五触发归一·情景四原型·答案先行·MVP=shock短程)",
  note:"[沙盘重建·S1·依赖S0·触主链绞杀式暗发·dev3] MVP=shock短程+状态级结论;hold/60天须待S6接地才上线。复用CAP-06裁剪·保留CAP-07型号面板。回退:feature sim.sandbox_render关=回旧路径(未删)。"},
 {id:"WO-SANDBOX-TRUST-BADGE",pri:"P2",deps:["WO-SANDBOX-CONFIG-COVERAGE"],doc:"docs/DISPATCH-sandbox-reconstruction.md",
  title:"S2·沙盘每数字dataMode徽标(LIVE/合成/未校准)+收编CAP-10沙盘RiskTop3标注统一",
  note:"[沙盘重建·S2·可∥S1·dev3] 接CAP-03只补披露层。收编:CAP-10的沙盘RiskTop3实测/估算标注矛盾由本单dataMode判据统一收。回退:关feature=不显徽标。"},
 {id:"WO-SANDBOX-BRANCH-INJECT",pri:"P2",deps:["WO-SANDBOX-AS-RENDER-TARGET"],doc:"docs/WO-SANDBOX-BRANCH-INJECT.md",
  title:"S3·分支注入不同应对+对比换决策维(交付/成本/齐套)",
  note:"[沙盘重建·S3·依赖S1·dev3] 接CAP-05补差量。SimComparePanel(FAKE-08已修tickMean其上)。回退:白名单·关=回容器分支。"},
 {id:"WO-SANDBOX-RADAR-COLLAPSE",pri:"P2",deps:[],doc:"docs/WO-SANDBOX-RADAR-COLLAPSE.md",
  title:"S4·三雷达合一(维度换人话)+L0-L4折一句人话(砍竞品形式膨胀)",
  note:"[沙盘重建·S4·可∥S1·纯前端·dev3] REVIEW拒绝copy竞品形式的标志一刀。回退:纯视觉可回退。"},
 {id:"WO-SANDBOX-TICK-CALENDAR",pri:"P2",deps:["WO-SANDBOX-AS-RENDER-TARGET"],doc:"docs/WO-SANDBOX-TICK-CALENDAR.md",
  title:"S5·tick↔业务时间(到第N周/里程碑)+时间轴事件标注+节点归因",
  note:"[沙盘重建·S5·依赖S1·dev3] 接CAP-04补差量。消费引擎PropagationTrace。回退:additive。"},
 {id:"WO-SANDBOX-TEMPORAL-GROUNDING",pri:"P2",deps:["WO-SANDBOX-AS-RENDER-TARGET"],doc:"docs/WO-SANDBOX-TEMPORAL-GROUNDING.md",
  title:"S6·时序接地五件套(外生驱动/overlay/hold守恒/约束/回放)+根治CAP-09 tick冻结",
  note:"[沙盘重建·S6·依赖S1 MVP·上线门禁·dev3] 外生驱动真源逐tick喂引擎=根治CAP-09(传导规则零载体致头部冻结)。回退:feature sim.temporal_grounding关=回v1.1。"},
];
S.forEach(s=>add({id:s.id,title:s.title,doc:s.doc,priority:s.pri,status:"TODO",owner:"",deps:s.deps,note:s.note,lane:"LaneS-sandbox",assignedDev:"dev3"}));
// 收编 CAP-09 → 折入 S6(parked·Dev-1勿band-aid)
const c9=q.items.find(x=>x.id==="WO-CAP-09-SANDBOX-TICK-LIVE");
if(c9){c9.priority="P3";c9.deps=["WO-SANDBOX-TEMPORAL-GROUNDING"];c9.note="[收编·根治并入沙盘重建S6·Dev-1勿band-aid·S6 DONE时一并复验闭]";}
// 收编 CAP-10 → 沙盘标注部分入S2·本单只留risk-board敞口
const c10=q.items.find(x=>x.id==="WO-CAP-10-RISK-EXPOSURE-HONEST");
if(c10){c10.title="风险看板敞口误导:越线0却挂整单敞口+敞口按缺口折算+格式转亿(sandbox标注部分已折入S2)";c10.note="[收编·沙盘RiskTop3标注部分→S2统一收·本单只留risk-board敞口折算(C1)+格式转亿(C3)·C2标注已移交S2·Dev-1]";}
fs.writeFileSync(p, JSON.stringify(q,null,2)+"\n");
const c={};q.items.forEach(x=>c[x.status]=(c[x.status]||0)+1);
console.log("counts:",JSON.stringify(c));
console.log("沙盘7单+CAP收编 done");
