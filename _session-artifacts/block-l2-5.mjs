import fs from "fs";
const p = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const it = q.items.find(i => i.id === "WO-L2-5");
if (!it) { console.error("WO-L2-5 not found"); process.exit(1); }
it.status = "BLOCKED";
it.blockReason = "关4幂等FAIL: decision/service.ts adopt()(约:111-151)无 already-adopted 守卫·重复采纳静默双写(连采2次→2 Decision+2 ActionDraft 均DRAFT挂同一packageId·旧记录沦孤儿未标SUPERSEDED·两次均200无警告)·且 service.ts:109 注释自称'采纳幂等以最新为准'与实现不符。真实影响:用户二次点采纳→S2审批队列多一张重复待批草稿+问责台账多一条重复。最小修(adopt()头部拿到pkg后建Decision前·三选一):①幂等返回 if(pkg.status==='ADOPTED'&&pkg.decisionRef)return pkg; ②明确拒重复 throw validationError('该决策已采纳'); ③兑现'以最新为准':先标旧 decisionRef/actionDraftRefs 对应记录 SUPERSEDED 再建新。任一即满足门4非静默双写。务必补1条 re-adopt 单测守回归(现 decision-kernel-adopt.test.ts 4例未覆盖重采纳)。其余5关全绿:R4采纳正门(真产Decision+ActionDraft·DRAFT非EXECUTED·payload逐值===求解器draftPayload非合成)/本体回写§2.H(DecisionPackage+CBR家族非空壳)/切片无漂移有牙/暗发Entitlement双注册齐(decision.kernel+act.adopt-to-draft两侧)/门+测试20绿+contracts-only-shared。";
it.at = it.at || {};
it.at.blocked = new Date().toISOString();
q.meta = q.meta || {};
q.meta.lastActivity = { role: "review", cmd: "BLOCKED", id: "WO-L2-5", at: new Date().toISOString() };
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const by = {}; for (const x of q.items) by[x.status] = (by[x.status] || 0) + 1;
console.log("OK WO-L2-5 → BLOCKED");
console.log("counts:", JSON.stringify(by));
