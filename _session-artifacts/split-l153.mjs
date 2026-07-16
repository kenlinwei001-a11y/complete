import fs from "fs";
const p = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const l153 = q.items.find(i => i.id === "WO-L1.5-3");
if (!l153) { console.error("WO-L1.5-3 missing"); process.exit(1); }

// ① 重划 L1.5-3 = datacore 半（案例摄取接线 + CBR retrieve 端点）·不碰 agentcore
l153.title = "案例摄取接线(DataCore Decision→案例·L2端口) + CBR retrieve 端点(POST /a/v1/memory/cases/retrieve-similar·相似案例检索·datacore侧)";
l153.note = "[LaneB·dev2·datacore域·见 DISPATCH-2DEV-SPINE.md] 【审核方拆缝 2026-07-11】原含 agentcore 'retrieve_similar_cases 工具'(tools/registry+executor+clients+universal)跨 lane 撞 Dev-1/Dev-3——已拆出 WO-L1.5-3B 归 Lane A/Dev-1。本单只做 datacore 两半:①案例摄取(Decision→DecisionCase 旁路写) ②CBR retrieve 端点(相似检索·暗发键 memory.cbr_retrieve 注册 datacore features.ts·defaultOn:false)。⛔不碰 agentcore 任何文件。治 G-3b 写侧+读侧数据面。";

// ② 新建 L1.5-3B = agentcore retrieve_similar_cases 工具适配器 · Lane A/Dev-1
const exists = q.items.find(i => i.id === "WO-L1.5-3B");
if (!exists) {
  const idx = q.items.findIndex(i => i.id === "WO-L1.5-3");
  const l153b = {
    id: "WO-L1.5-3B",
    title: "agentcore retrieve_similar_cases 工具适配器(tools/registry+executor+clients+universal·薄 OBO 适配·调 datacore CBR retrieve 端点)",
    status: "TODO",
    priority: "P1",
    owner: "",
    deps: ["WO-L1.5-3"],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    note: "[LaneA·dev1·agentcore域·见 DISPATCH-2DEV-SPINE.md] 【审核方拆缝 2026-07-11·从 L1.5-3 拆出】理由:①架构铁律 CLAUDE.md『AgentCore 只经 DataCore 公开 REST 访问数据』→ retrieve_similar_cases 是松耦合薄适配器·必属 agentcore·经 OBO 透传调 L1.5-3 的 datacore CBR retrieve 端点·不在 agentcore 重算相似度。②分区铁律 只碰本 lane 文件域→ agentcore tools/* = Lane A = Dev-1。暗发纪律:工具注册进 registry 但**门控**(暗发键 memory.cbr_retrieve·**双注册** agentcore registry.ts + datacore features.ts·defaultOn:false)→关闸=不在 agent 可用工具集=agent 行为字节一致(NG6);开闸(翻闸)才 agent 先查案例库。治 G-3b 读侧 agent 闭环。",
    at: { created: new Date().toISOString() }
  };
  q.items.splice(idx + 1, 0, l153b);
  console.log("CREATED WO-L1.5-3B (Lane A/Dev-1·deps L1.5-3)");
} else {
  console.log("WO-L1.5-3B already exists — skip create");
}

q.meta = q.meta || {};
q.meta.lastActivity = { role: "review", cmd: "SPLIT", id: "WO-L1.5-3→+3B", at: new Date().toISOString() };
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const by = {}; for (const x of q.items) by[x.status] = (by[x.status] || 0) + 1;
console.log("counts:", JSON.stringify(by), "total:", q.items.length);
