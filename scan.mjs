import fs from "node:fs";
import path from "node:path";
const root = process.argv[2] || "apps/frontend-shell/src";
const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):(/\.(ts|tsx)$/.test(e.name)&&files.push(p));}})(root);
function strip(src){
  let out="",i=0,mode="code",q="";
  while(i<src.length){
    const c=src[i],n=src[i+1];
    if(mode==="code"){
      if(c==="/"&&n==="/"){mode="line";i+=2;continue;}
      if(c==="/"&&n==="*"){mode="block";i+=2;continue;}
      if(c==='"'||c==="'"||c==="`"){mode="str";q=c;out+=c;i++;continue;}
      out+=c;i++;continue;
    }
    if(mode==="line"){ if(c==="\n"){mode="code";out+="\n";} i++; continue; }
    if(mode==="block"){ if(c==="*"&&n==="/"){mode="code";i+=2;} else {if(c==="\n")out+="\n"; i++;} continue; }
    if(mode==="str"){ if(c==="\\"){out+=c+(n??"");i+=2;continue;} if(c===q){mode="code";} out+=c;i++;continue; }
  }
  return out;
}
const re=/(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-\/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs)\:\d+/g;
let total=0; const byFile={};
for(const f of files){
  const s=strip(fs.readFileSync(f,"utf8"));
  s.split("\n").forEach((l,idx)=>{
    const m=l.match(re);
    if(m){ total+=m.length; (byFile[f] ||= []).push([idx+1,m.join(" | "),l.trim().slice(0,200)]); }
  });
}
for(const [f,rows] of Object.entries(byFile).sort((a,b)=>b[1].length-a[1].length)) console.log(`${rows.length}\t${f}`);
console.log("TOTAL_MATCH_LINES", Object.values(byFile).reduce((a,b)=>a+b.length,0), "TOTAL_HITS", total, "FILES", files.length);
fs.writeFileSync("scan-out.json", JSON.stringify(byFile,null,1));
