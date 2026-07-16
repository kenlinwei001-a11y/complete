import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const w = q.items.find(x => x.id === "WO-CAP-01-REALDEMAND");
if (w) w.reviewNote = "PASS(限本单scope无造假)但假推演未真正根治(agent a4fe6c67)。真解1/3:需求驱动因子(瓶颈工序/物料齐套/人力工时)逐值==demandCapacityTightness=65真绑供需·改需求真变(F1.5→89过阈)·可回退(关闸12/12红)·R6字节一致·常州不再决策染红。未解:设备OEE(82-87)/良率(61-66)仍扁平合成标LIVE·CAP-01按scope显式排除·OEE现取代util:line成决策级恒红主驱动·恒红12/12→7/12(残7红仍合成非真需求·看板仍一片红只是标签从瓶颈工序变设备OEE)。dev已诚实登记母体§8+AUDIT。须叠WO-FAKE-01+CAP-02+FAKE-05才真解。门全绿但盲区(genuine-sim从不真跑OEE/良率·扁平合成标LIVE绕过所有门)。";
const add = (o) => { if (!q.items.find(x => x.id === o.id)) q.items.push(Object.assign({ status: "TODO", owner: "", at: {} }, o)); };
add({
  id: "WO-FAKE-01", priority: "P0", deps: [], doc: "docs/AUDIT-solver-fake-residues.md",
  title: "完成假推演根治:risk_timeline设备OEE/良率去合成扁平(CAP-01显式漏·现OEE为决策恒红主驱动)",
  acceptance: { goal: "OEE/良率因子不再扁平合成标LIVE冒充真·决策级恒红真消。", criteria: [
    { id: "C1", type: "真跑", assert: "battery.ts:1264-1265 oee:equip/yield:process 加确定性per-base乘子(同util:line守R6)使随基地/真输入变·或无分化时dataMode下沉PARTIAL(诚实标演示均值非逐基地实测不标LIVE)。真curl risk_timeline{factor:设备OEE/良率}逐基地值不再恒定或标PARTIAL·决策级红卡数真降。" },
    { id: "C2", type: "test", assert: "同步放开solvers.test.ts:211-314对OEE/良率扁平均值钉死·确定性守。与WO-CAP-02同改battery.ts·dev协调避冲突(CAP-02先)。" },
    { id: "C3", type: "gate", assert: "genuine-sim/no-fake绿·R6字节一致·母体§8 G-SIM-FAKE更新OEE/良率已治。" } ],
    discipline: "确定性乘子非rng·additive。此单+CAP-02+FAKE-05落地=假推演真根治(用户不打折)。" }
});
add({
  id: "WO-FAKE-05", priority: "P1", deps: [], doc: "docs/AUDIT-solver-fake-residues.md",
  title: "堵根:门守dataMode值诚实(扁平合成标LIVE须被逮·防假推演复发)",
  acceptance: { goal: "三门盲区补上——solver恒报LIVE读扁平合成不再绕过门。", criteria: [
    { id: "C1", type: "gate自证", assert: "check-no-fake-data.mjs扩SMELL信号(本地hash如riskHashN/魔数系数/固定haircut/扁平种子标LIVE)·注入各类→门红自证。" },
    { id: "C2", type: "真跑·行为断言", assert: "genuine-sim §⑧加行为断言:扰动业务输入(改订单/需求/SOP)后声称LIVE的因子值须变·否则应标PARTIAL·覆盖设备OEE/良率(现扁平标LIVE须被本门逮红)。" },
    { id: "C3", type: "gate", assert: "新门/扩门CI绿·母体§7登记。" } ],
    discipline: "堵根=所有同类假推演被门自动逮防复发·additive。" }
});
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("TODO:", q.items.filter(x => x.status === "TODO").map(x => x.id + "(" + x.priority + ")").join(","));
