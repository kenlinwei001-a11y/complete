import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const it = q.items.find(x => x.id === "WO-FAKE-05");
if (it) {
  it.status = "TODO";
  it.owner = "";
  it.priority = "P0";
  it.at = (it.at && typeof it.at === "object") ? it.at : {};
  delete it.at.wip;
  it.note = "审核方交还dev建（分权：reviewer只复验不下场·避免自建自审）。堵根门·假推演铁律最高优先，dev优先接此单。";
}
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("FAKE-05:", JSON.stringify(q.items.find(x=>x.id==="WO-FAKE-05")?.status)+"@"+(q.items.find(x=>x.id==="WO-FAKE-05")?.owner||"''"));
