import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));

// FAKE-05 → DONE (PASS·门真堵根)
const f05 = q.items.find(x => x.id === "WO-FAKE-05");
if (f05) {
  f05.status = "DONE";
  f05.at = (f05.at && typeof f05.at === "object") ? f05.at : {};
  f05.at.done = "2026-07-11";
  f05.reviewNote = "PASS 独立对抗真跑(agent a438f43·40工具13min):门真有牙真堵根。C2行为断言§⑧b真调dist riskTimeline——注入①扁平合成标LIVE(value:92,live:true弃读oee_current)→逮EXIT=1'峰值92不随真输入Equipment.oee_current变·扁平冒充G-DM-1假推演回潮';注入②冻结LIVE同逮(良率74);覆盖OEE+良率。C1静态门SMELL扩\\b\\w*[Hh]ash\\w*\\((逮任意hash命名含本地riskHashN)+createHash/digest豁免+COMMENT_RE+内置gate自证(牙齿钝→EXIT2·实证钝回hashString-only门自红)。互补铁证:扁平常量下C1保持绿(静态不可见)→必须C2兜=二门互补非冗余。移除全注入→双绿·git status空·HEAD e71472d(诚实lp.oeeBase+(1-avg)*lp.oeeK还原)=精准逮假非无脑常红。§7母体L657/L701+切片07-gates L20/L64登记全。BLOCK三条件(无牙/误报/未登记)均不成立。1非阻断(C1 Id豁免过宽)→WO-GATE-ID-TIGHTEN跟进。";
}

// 非阻断加固 WO：C1 LEGIT id-豁免过宽 → hash(xxxId)作实参绕过静态扫
const now = {};
let it = q.items.find(x => x.id === "WO-GATE-ID-TIGHTEN");
if (!it) { it = { at: {} }; q.items.push(it); }
Object.assign(it, {
  id: "WO-GATE-ID-TIGHTEN",
  title: "假推演门加固(非阻断):check-no-fake-data C1 收紧 id-豁免(hash(xxxId)作实参不再被放行)",
  doc: "docs/AUDIT-solver-fake-residues.md",
  priority: "P2",
  status: "TODO",
  owner: "",
  deps: [],
  note: "FAKE-05复验(agent a438f43)非阻断发现:C1 LEGIT正则 `_?id\\b|Id\\b` 过宽——`hash(baseId)`(id作实参)整行被当id用途豁免·hash伪造与…Id/…id同行者绕过C1静态扫(baseId/orderId/tenantId求解器极常见)。当前0现实依赖(10 SMELL行:6注释+4由version/bucket/createHash/digest豁免)·C2行为断言命名无关兜底OEE/良率·canonical R4(owner用riskHashN(base)非baseId)仍被逮→故非阻断。但C2无行为断言的其它求解器若出hash(orderId)式伪造会双绕。",
  acceptance: {
    goal: "hash(xxxId)作实参不再被C1 id-豁免放行·同时不误伤 const xxxId=hash(x) 合法赋值。",
    criteria: [
      { id: "C1", type: "真跑", assert: "check-no-fake-data.mjs LEGIT的`_?id\\b|Id\\b`收紧为id作赋值目标锚定(如`\\b(?:const|let|var)\\s+\\w*[Ii]d\\b|\\w*[Ii]d\\s*[=:]`)。注入`hash(baseId)`标live→门必逮RED;`const nodeId=hash(x)`合法赋值→仍绿不误伤。内置gate自证块加此对样本(mustCatch/mustPass)。" },
      { id: "C2", type: "gate", assert: "净树跑no-fake-data绿(现10 SMELL行收紧后不新增误报)·四包test不破·R6。" }
    ],
    discipline: "additive·纯门加固·审核方复验出单·dev建·reviewer复验。"
  }
});

fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("FAKE-05:", q.items.find(x=>x.id==="WO-FAKE-05")?.status);
console.log("新增:", q.items.find(x=>x.id==="WO-GATE-ID-TIGHTEN")?.id + "[" + q.items.find(x=>x.id==="WO-GATE-ID-TIGHTEN")?.priority + "]");
