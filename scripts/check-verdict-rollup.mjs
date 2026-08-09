import fs from "node:fs";
const FILES=["docs/CHECK-SPEC-AUT.md","docs/CHECK-DSL-CMP.md","docs/CHECK-RT-GOV.md","docs/CHECK-MIG-XR.md"];
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
fs.writeFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/verdict-rows.json",JSON.stringify(rows));
