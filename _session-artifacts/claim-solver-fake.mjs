import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const now = new Date().toISOString();
const addClaim = (o) => {
  let it = q.items.find(x => x.id === o.id);
  if (!it) { it = Object.assign({ status: "TODO", owner: "", at: {} }, o); q.items.push(it); }
  it.priority = "P0";
  it.status = "WIP";
  it.owner = "reviewer";
  it.at = it.at && typeof it.at === "object" ? it.at : {};
  it.at.wip = now;
};
addClaim({ id: "WO-FAKE-02", deps: [], doc: "docs/AUDIT-solver-fake-residues.md",
  title: "假推演:plan_rootcause季/年下钻去魔数投影(读真per-level Metric或PARTIAL)",
  acceptance: { goal: "季/年actual不再由月值×魔数0.97/1.04编造冒充LIVE。", criteria: [
    { id: "C1", type: "真跑", assert: "service.ts:861-871 季/年下钻改读真per-level Metric(对齐metric_rollup service.ts:1057)或投影档dataMode下沉PARTIAL标月值粒度投影非实测季/年。真curl plan_rootcause level=quarter/year→值非月值×魔数或标PARTIAL。" },
    { id: "C2", type: "gate", assert: "R6字节一致·四包test绿·genuine-sim/no-fake绿。" } ],
    discipline: "additive·KILL-MOCK-RED·审核方亲建(下场)。" } });
addClaim({ id: "WO-FAKE-03", deps: [], doc: "docs/AUDIT-solver-fake-residues.md",
  title: "假推演:risk_timeline处置责任人去hash(读真责任对象或显未指派)",
  acceptance: { goal: "责任人不再由hash(基地名)伪造。", criteria: [
    { id: "C1", type: "真跑", assert: "risk.ts:553-556 riskHashN + :588 责任人改读真组织/责任对象·无真源则显未指派(非hash造名)。真curl risk_timeline处置行责任人非hash选取。" },
    { id: "C2", type: "gate", assert: "R6·四包test绿·no-fake-data门(本地hash若被FAKE-05扩门覆盖则同步绿)。" } ],
    discipline: "additive·KILL-MOCK-RED·审核方亲建。" } });
addClaim({ id: "WO-FAKE-04", deps: [], doc: "docs/AUDIT-solver-fake-residues.md",
  title: "假推演:order_fullchain交期P90去固定haircut(收口mcP90Single)",
  acceptance: { goal: "P90不再=真产能×0.9固定haircut伪分位。", criteria: [
    { id: "C1", type: "真跑", assert: "service.ts:1177 order_fullchain P90改用mcP90Single(method-mc.ts已有便捷式·真种子化MC分位)去×0.9固定haircut。真curl P90走真分位非固定折算。" },
    { id: "C2", type: "gate", assert: "R6·四包test绿。" } ],
    discipline: "additive·KILL-MOCK-RED·审核方亲建。" } });
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("reviewer-claimed WIP:", q.items.filter(x => x.owner === "reviewer" && x.status === "WIP").map(x => x.id).join(", "));
