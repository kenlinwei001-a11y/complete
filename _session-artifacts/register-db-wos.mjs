import fs from "fs";
const p = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const now = new Date().toISOString();
const AUDIT = "docs/AUDIT-databuilder-genuine-construction-DELTA.md";
const DISPATCH = "docs/DISPATCH-databuilder-upgrade.md";
const wos = [
  { id: "WO-DB-CLOSURE-HARDEN", priority: "P1", deps: ["WO-MERGE-03"], doc: DISPATCH,
    title: "闭包/verify据实(洞C/D·最痛):closure验切片非空且解析出minNodes(非只看domain)+ValidationTrace据实判(BUILD_STATIC/无结论数字→NOT_PASS·crossValidation不同义反复)+green→red门",
    note: "[LaneB·datacore·DISPATCH-databuilder-upgrade.md] 最高优先·假绿(gatePassed+ALL_PASS双绿灯能在切片空/推演没跑下同时点亮·KILL-MOCK-RED核心形态)。验证硬化部分link-无关先落暴露真相;'按LLM链路真生成paths'部分依赖LINK-STABILIZE(①②强耦合·合并复验)。复用check-requirement-graph.mjs门模板。回写母体§8 G-BUILD-SHELL/G-BUILD-VERIFY闭。green→red:植入domain有值paths:[]类型→闭包应报空;BUILD_STATIC无数字→NUMERIC NOT_PASS。" },
  { id: "WO-DB-LINK-STABILIZE", priority: "P1", deps: ["WO-DB-CLOSURE-HARDEN"], doc: DISPATCH,
    title: "链路派生稳定(洞E):LLM链路输出+确定性FK兜底补链(复用modeling detectFkCandidates uniqueRate≥0.95)+覆盖度门+接现成slice-planner planSlice真BFS多跳·治多跳偶发断链",
    note: "[LaneB·datacore·DISPATCH] 供CLOSURE-HARDEN的'按真链路生成非空paths'。H3复用非重写(接现成slice-planner.ts:69 planSlice)。green→red:LLM丢链→FK补→门绿·关兜底→红。①②强耦合合并复验。" },
  { id: "WO-DB-LLM-REQUIRED-NO-FLOOR", priority: "P1", deps: ["WO-DB-LINK-STABILIZE"], doc: "docs/WO-DB-LLM-REQUIRED-NO-FLOOR.md",
    title: "取消comprehend无-LLM地板降级(G-COMPREHEND-FLOOR):无绑定/失败/未理解→诚实报错不建(LLM_PURPOSE_UNBOUND/COMPREHEND_NOT_UNDERSTOOD)·堵service.ts:86-102主+:952次两调用点",
    note: "[LaneB·datacore·用户钉死红线] ⚠硬前置:先跑全量测试sweep定≥14+测清单(WO只认3·实测runStory/comprehend触≥14 datacore+agentcore scaffold含comprehend-floor-a2)+CI/demo LLM绑定/flag端到端airtight(SEED_DEMO+docker demo+离线信创三态)·否则一落地破4包全绿。兼顾:DC_COMPREHEND_DETERMINISTIC flag(默认false·留地板满足RL9)+comprehendedBy:FLOOR契约标注。回写§8 G-COMPREHEND-FLOOR闭。green→red:改回地板→非电池故事产电池域→门红。" },
  { id: "WO-DB-BSTACK-DERIVE", priority: "P2", deps: ["WO-DB-LLM-REQUIRED-NO-FLOOR"], doc: DISPATCH,
    title: "B栈按故事真派生(洞B):workflow多步/条件·agent prompt含故事上下文·skill真资源(非模板fan-out)·可能扩LlmComprehendSchema采编排提示(additive)",
    note: "[LaneB·datacore·DISPATCH] ⚠沙盘划界:绝不派生propagation_rule/state_var(S0§3.4归RG/S1·防双写contracts/databuilder.ts:437)。green→red:两复杂度悬殊故事→workflow.steps/agent.prompt字节相同→红。" },
  { id: "WO-DB-MODELING-WIRE", priority: "P2", deps: ["WO-MERGE-03"], doc: DISPATCH,
    title: "故事发动机接A3 deriveModelingSuggestion:上传数据即从列/FK真派生类型/链路(现只/admin/modeling独立用·故事路零引用)",
    note: "[LaneB·datacore·DISPATCH·最干净·可并行候选] 纯复用modeling.ts:89·与MERGE数据先行对齐(须协同MERGE-03)。green→red:上传数据→应从列/FK派生类型;现不派生→红。" },
  { id: "WO-DB-FIVE-ACT-UX", priority: "P2", deps: ["WO-DB-CLOSURE-HARDEN", "WO-DB-LLM-REQUIRED-NO-FLOOR"], doc: DISPATCH,
    title: "五幕向导(§3):理解确认门(覆盖度%+读不懂原句红高亮可拒)+真绿才绿(BUILD_STATIC显灰未验证)·暴露洞C/D假绿给人",
    note: "[Lane frontend·DISPATCH] 须①③后端已落(要有诚实ValidationTrace/comprehendedBy可显)·⚠撞MERGE前端(DataBuilderPage.tsx)须协同·垫后。UX不替代真派生(只暴露塌方)。真浏览器验收(铁律0.4)。" },
];
let n = 0;
for (const w of wos) {
  if (q.items.find(i => i.id === w.id)) { console.log("· exists", w.id); continue; }
  q.items.push({ ...w, status: "TODO", owner: "", at: { created: now } });
  console.log("CREATED", w.id, "deps:", JSON.stringify(w.deps));
  n++;
}
q.meta = q.meta || {};
q.meta.lastActivity = { role: "review", cmd: "REGISTER(db-upgrade)", id: `${n}单`, at: now };
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const by = {}; for (const x of q.items) by[x.status] = (by[x.status] || 0) + 1;
console.log("counts:", JSON.stringify(by), "total:", q.items.length);
