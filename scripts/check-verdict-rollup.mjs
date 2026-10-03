/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-verdict-rollup.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/* 扫描面现算（WO-GATE-ROSTER-SWEEP-2，2026-08-18）：docs/CHECK-*.md 全量枚举，一个文件名都不手抄。
 * 判据：「这个集合会随仓库演进而变吗？」—— 明天新增一份判定档案（CHECK-新域.md）就该自动进汇总，
 * 手抄名单会让它永远不进、永远漏。旧形态写死 4 份，正撞上断点 G-GATE-ROSTER-HANDCOPIED。
 * 注意 `CHECKLIST-skill-4209.md` 不匹配（前缀是 CHECKLIST- 不是 CHECK-），刻意排除——它是清单不是判定档案。 */
const FILES = fs.readdirSync("docs").filter((f) => /^CHECK-.*\.md$/.test(f)).sort().map((f) => `docs/${f}`);
if (FILES.length < 4) {
  console.error(`⛔ 门自己瞎了：docs/CHECK-*.md 只枚举到 ${FILES.length} 份（下界 4）——枚举塌陷，不是档案没了。`);
  process.exit(2);
}
const ID_RE=/^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9.]+)*$/;
const SYMS=["✅","🔗","⚠️","❌","⛔","◐"];
function cells(l){const t=l.trim(); if(!(t.startsWith("|")&&t.endsWith("|")))return null;
  const b=t.slice(1,-1),out=[];let cur="";
  for(let i=0;i<b.length;i++){const ch=b[i];
    if(ch==="\\"&&b[i+1]==="|"){cur+="|";i++;continue;}
    if(ch==="|"){out.push(cur.trim());cur="";continue;} cur+=ch;}
  out.push(cur.trim());return out;}
function parseVerdict(c){const f=[],seen=new Set();
  for(let i=0;i<c.length;i++)for(const s of SYMS)if(c.startsWith(s,i)&&!seen.has(s)){seen.add(s);f.push({s,i});}
  if(!f.length)return null; f.sort((a,b)=>a.i-b.i);
  return {primary:f[0].s,all:f.map(x=>x.s),composite:f.length>1};}
const HDR=/^(档|判定|结论|档次)$/;
const perFile={},rows=[];
for(const f of FILES){
  const t={"✅":0,"🔗":0,"⚠️":0,"❌":0,"⛔":0,"◐":0,_composite:0,_noVerdict:0,_total:0,_noHdr:0};
  let vcol=-1;
  for(const [i,line] of fs.readFileSync(f,"utf8").split("\n").entries()){
    const c=cells(line); if(!c) continue;
    // 表头行：更新当前表的判定列
    const h=c.findIndex(x=>HDR.test(x.replace(/[`*]/g,"").trim()));
    if(h>=0){vcol=h;continue;}
    if(c.length<2) continue;
    const id=c[0].replace(/[`*]/g,"").trim();
    if(!ID_RE.test(id)||!/\d/.test(id)||id.length<2) continue;
    let v=null;
    if(vcol>=0&&vcol<c.length) v=parseVerdict(c[vcol]);
    if(!v){for(let k=1;k<Math.min(c.length,6);k++){const x=parseVerdict(c[k]);if(x){v=x;break;}}}
    t._total++;
    if(!v){t._noVerdict++;rows.push({f,line:i+1,id,v:null});continue;}
    t[v.primary]++; if(v.composite)t._composite++;
    rows.push({f,line:i+1,id,v:v.primary,all:v.all,composite:v.composite});
  }
  perFile[f]=t;
}
const CAN=[["docs/CHECK-SPEC-AUT.md","SK-SPEC-L1-3","❌"],["docs/CHECK-SPEC-AUT.md","SK-SPEC-L1-1","✅"],
 ["docs/CHECK-SPEC-AUT.md","SK-SPEC-M1","❌"],["docs/CHECK-SPEC-AUT.md","SK-SPEC-M3","🔗"],
 ["docs/CHECK-DSL-CMP.md","D009","❌"],["docs/CHECK-DSL-CMP.md","D013","✅"],["docs/CHECK-DSL-CMP.md","C103","✅"],["docs/CHECK-DSL-CMP.md","C104","❌"],
 ["docs/CHECK-RT-GOV.md","RT-020","🔗"],["docs/CHECK-RT-GOV.md","RT-022","❌"],["docs/CHECK-RT-GOV.md","RT-083","✅"],
 ["docs/CHECK-MIG-XR.md","SK-MIG-19","✅"],["docs/CHECK-MIG-XR.md","SK-MIG-20","⛔"]];
let ok=true;
for(const [f,id,w] of CAN){const h=rows.find(r=>r.f===f&&r.id===id);const g=h?h.v:"(未抽到)";if(g!==w)ok=false;
  console.log(`金丝雀 ${id.padEnd(14)} 期望 ${w} 实测 ${g} ${g===w?"OK":"✗"}`);}
if(!ok){console.log("\n⛔ 金丝雀不中 ⇒ 提取器坏了，数字不许当结论");process.exit(2);}
console.log("");
const g={"✅":0,"🔗":0,"⚠️":0,"❌":0,"⛔":0,"◐":0,_composite:0,_noVerdict:0,_total:0};
console.log("| 文档 | 条目 | ✅ | 🔗 | ⚠️/◐ | ❌ | ⛔ | 复合 | 未定档 |");
console.log("|---|---|---|---|---|---|---|---|---|");
for(const f of FILES){const t=perFile[f];for(const k of Object.keys(g))g[k]+=t[k]??0;
  console.log(`| ${f.replace("docs/CHECK-","").replace(".md","")} | ${t._total} | ${t["✅"]} | ${t["🔗"]} | ${t["⚠️"]+t["◐"]} | ${t["❌"]} | ${t["⛔"]} | ${t._composite} | ${t._noVerdict} |`);}
console.log(`| **合计** | **${g._total}** | ${g["✅"]} | ${g["🔗"]} | ${g["⚠️"]+g["◐"]} | ${g["❌"]} | ${g["⛔"]} | ${g._composite} | ${g._noVerdict} |`);
const den=g._total-g["⛔"]-g._noVerdict;
console.log(`\n有效判定基数 = ${g._total} - ⛔${g["⛔"]} - 未定档${g._noVerdict} = ${den}`);
console.log(`  ✅ 真满足   ${g["✅"]}  ${(g["✅"]/den*100).toFixed(1)}%`);
console.log(`  🔗 接线不全 ${g["🔗"]}  ${(g["🔗"]/den*100).toFixed(1)}%`);
console.log(`  ⚠️/◐ 只有test/部分 ${g["⚠️"]+g["◐"]}  ${((g["⚠️"]+g["◐"])/den*100).toFixed(1)}%`);
console.log(`  ❌ 无承载物 ${g["❌"]}  ${(g["❌"]/den*100).toFixed(1)}%`);
if(g._noVerdict){console.log("\n未定档行：");for(const r of rows.filter(r=>!r.v))console.log(`  ${r.f}:${r.line}  ${r.id}`);}
// 调试快照（best-effort）：原写死原作者容器 scratchpad 路径，换台机器必 ENOENT 把门砸成 RC=2（假「工具坏了」）。
// 快照只是排查副产物，写不出不影响判定 —— 改放 os.tmpdir() 并吞掉写入失败（WO-GATE-ROSTER-SWEEP-2 修）。
try { fs.writeFileSync(path.join(os.tmpdir(), "verdict-rows.json"), JSON.stringify(rows)); } catch { /* 快照写不出 ≠ 门坏了 */ }
