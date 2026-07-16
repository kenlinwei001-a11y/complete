import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const laneA = ["WO-L1A-1","WO-L1A-2","WO-L1A-3","WO-L1B-1","WO-L1B-2","WO-L1B-3","WO-L1B-4","WO-L1B-5","WO-L1B-SAGA"];
const laneB = ["WO-L2-1","WO-L2-2","WO-L2-3","WO-L2-4","WO-L2-5","WO-L1.5-1","WO-L1.5-2","WO-L1.5-3","WO-L1.5-4","WO-L1.5-5"];
const tag = (ids, lane, dev) => ids.forEach(id => {
  const it = q.items.find(x => x.id === id);
  if (!it) { console.log("MISSING", id); return; }
  it.priority = "P1";
  it.lane = lane; it.assignedDev = dev;
  it.note = ("[" + lane + "·" + dev + "·见 docs/DISPATCH-2DEV-SPINE.md·只认领本lane·claim " + id + " " + dev + "] " + (it.note || "")).slice(0, 260);
});
tag(laneA, "LaneA", "dev1");
tag(laneB, "LaneB", "dev2");
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("LaneA(dev1):", laneA.join(","));
console.log("LaneB(dev2):", laneB.join(","));
