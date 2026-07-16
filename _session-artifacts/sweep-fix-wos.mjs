import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));

// —— 1) 富化 FAKE-08：并入 agent A 真跑逐值证据（finding A）——
const f08 = q.items.find(x => x.id === "WO-FAKE-08");
if (f08) {
  f08.note = ((f08.note ? f08.note + " " : "") +
    "[复验实证·agent aa972508] 真浏览器逐值坐实:沙盘多场景对比'全局态'显3339.5/8682.7/9952.2/10823.8/11272.9(差+7933.3·A/B热度条整条通红),同世界主面板'全局态'仅47.3;tick0刚分支即A=B=3339.5 vs 主KPI 47.3=铁证。根因确认SimComparePanel.tsx tickMean(L16-29)裸Σ所有stateVar÷值数·未做computeGlobalKpi的无界变量剔除+量纲归一·被totalDemand(≈160万)污染。修法=复用computeGlobalKpi/carrierMean(≤100过滤)。").slice(0, 900);
}

// —— 2) 新 fix-WO：沙盘推进无可见响应（finding B/E/G·假推演铁律·最高优先）——
const nowAt = {};
const addOrSet = (o) => {
  let it = q.items.find(x => x.id === o.id);
  if (!it) { it = { status: "TODO", owner: "", at: {} }; q.items.push(it); }
  Object.assign(it, o);
  it.at = (it.at && typeof it.at === "object") ? it.at : {};
};

addOrSet({
  id: "WO-CAP-09-SANDBOX-TICK-LIVE",
  title: "假推演:推演沙盘推进tick后头部KPI全冻结(传导规则指向零载体stateVar·核心动作零可见响应)",
  doc: "docs/AUDIT-frontend-fake-residues.md",
  priority: "P0",
  status: "TODO",
  owner: "",
  deps: [],
  note: "复验agent aa972508真跑证:tick 0→5→10头部KPI纹丝不动(全局47.3/利用率94.3/totalDemand1600000.0/demandDelta0.3全冻结)。基地负责人点'推进N天'零可见效果=坐实用户'不知每个功能解决什么问题'。疑因:3条传导规则target=Base.loadIndex/Model.demandLoad·载体对象数=0(carrierMean恒0.0)·propagation算了被显示门挡;显示的utilization/demandDelta/totalDemand是source变量不传导。dev先确认根因再修。",
  acceptance: {
    goal: "沙盘'推进N天'后头部至少一项决策相关KPI随tick确定性真变化(非冻结·非合成扰动)。",
    criteria: [
      { id: "C1", type: "真跑", assert: "定位传导规则种子(target=Base.loadIndex/Model.demandLoad零载体)与SandboxView carrierMean/显示门(L95-111附近)。改法二选一:①传导规则改指有真载体的stateVar;②loadIndex/demandLoad在快照上真物化载体对象。真起DC/AC/前端·base_manager登录·填天数N点推进→头部KPI逐值记tick0/5/10须出现确定性差异(附三点数值)。绝不注入合成扰动凑变化(KILL-MOCK-RED)。" },
      { id: "C2", type: "真渲染", assert: "需求负载/负载指数KPI:无载体对象时显'—'(诚实无数据)非'0.0'(finding E)。" },
      { id: "C3", type: "真渲染", assert: "就绪认证'✗暂不可进入推演'时应同步禁用tick/分支按钮或改文案(finding G·当前可点自相矛盾)。" },
      { id: "C4", type: "gate", assert: "R6确定性(同seed同tick同值)·frontend回归全绿·sandbox propagateTick既有测试不破。" }
    ],
    discipline: "additive·KILL-MOCK-RED·审核方复验出单·dev建·reviewer复验(分权)。"
  }
});

// —— 3) 新 fix-WO：risk敞口/诚实标注 误导（finding C/I/D/F·P1）——
addOrSet({
  id: "WO-CAP-10-RISK-EXPOSURE-HONEST",
  title: "误导:风险看板越线0却挂整单43亿敞口 + 同源风险一处'实测'一处'估算'标注矛盾",
  doc: "docs/AUDIT-frontend-fake-residues.md",
  priority: "P1",
  status: "TODO",
  owner: "",
  deps: [],
  note: "复验agent aa972508真跑证:①(C)决策摘要'越线基地0'却'营收敞口4320000万(43.2亿)';点日格弹窗'缺口≈0.0776万套(≈776套近零)'却把整单SO-3445(方形-NCM 44万套/敞口968000万)标'受影响+1天'·近零缺口→数十亿敞口不成比例。②(I)沙盘RiskTop3标常州·瓶颈工序84'估算·无实测',而/v/risk同一risk_timeline常州标'实测当前65(LIVE)'·同源两视图相反诚实标(RiskTop3用topLive顶层SYNTHETIC→false全灰,RiskBoardView用卡级dataMode)。",
  acceptance: {
    goal: "敞口与缺口成比例·同源风险诚实标一致·金额可读。",
    criteria: [
      { id: "C1", type: "真跑", assert: "(finding C)越线0/crossDay=null时不把整单营收挂'受影响敞口';敞口按真缺口比例折算(近零缺口→近零敞口)。真curl+真渲染:SO-3445缺口0.0776万套→敞口逐值应≈比例折算值非968000万整单。RiskBoardView.tsx敞口L33-78。" },
      { id: "C2", type: "真渲染", assert: "(finding I)RiskTop3(SandboxView L495-544)与RiskBoardView.cardDecisionMode的dataMode判据统一(都走卡级dataMode)·同一常州风险不再一处'实测'一处'估算·无实测'。" },
      { id: "C3", type: "真渲染", assert: "(finding D)营收敞口显示转亿(如43.2亿)非裸'4320000万'·决策者可读。" },
      { id: "C4", type: "gate", assert: "frontend回归全绿·additive·不改后端risk_timeline真值口径(仅前端展示/折算)。" }
    ],
    discipline: "additive·KILL-MOCK-RED·审核方复验出单·dev建·reviewer复验(分权)。"
  }
});

fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("新增fix-WO:", ["WO-CAP-09-SANDBOX-TICK-LIVE","WO-CAP-10-RISK-EXPOSURE-HONEST"].map(id=>{const it=q.items.find(x=>x.id===id);return id+"["+it.status+"·"+it.priority+"]";}).join(", "));
console.log("FAKE-08 note len:", (q.items.find(x=>x.id==="WO-FAKE-08")?.note||"").length);
