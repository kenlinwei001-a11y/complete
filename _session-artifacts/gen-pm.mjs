import fs from "node:fs";
const D = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/pm-data.json","utf8"));
const esc = s => String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const html = `<div id="app"></div>
<script>
const DATA = ${JSON.stringify(D)};
</script>
<style>
:root{--bg:#0e1420;--panel:#161f2e;--panel2:#1d2838;--bd:#2a3648;--bd2:#374559;--txt:#eef2f8;--mut:#9fabbd;--mut2:#6f7d90;--acc:#5b7cfa;--done:#37b98a;--built:#4f8cf7;--wip:#e3a13a;--todo:#8a97a8;--blocked:#e0626c;--mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;--sans:"Inter","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#f4f7fb;--panel:#fff;--panel2:#f0f4f9;--bd:#dde4ee;--bd2:#c7d1de;--txt:#141d2b;--mut:#5a6878;--mut2:#8a98a8}}
:root[data-theme="dark"]{--bg:#0e1420;--panel:#161f2e;--panel2:#1d2838;--bd:#2a3648;--txt:#eef2f8;--mut:#9fabbd}
:root[data-theme="light"]{--bg:#f4f7fb;--panel:#fff;--panel2:#f0f4f9;--bd:#dde4ee;--txt:#141d2b;--mut:#5a6878}
*{box-sizing:border-box}body{margin:0}
#app{font-family:var(--sans);background:var(--bg);color:var(--txt);min-height:100vh;padding:26px clamp(14px,4vw,42px);line-height:1.5}
h1{font-size:22px;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--mut);font-size:12.5px;margin-bottom:20px}
.sub b{color:var(--txt);font-family:var(--mono)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.tile{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:12px 14px}
.tile .n{font-size:26px;font-weight:750;font-family:var(--mono);line-height:1;font-variant-numeric:tabular-nums}
.tile .l{font-size:11px;color:var(--mut);margin-top:5px}
.bar{height:9px;border-radius:6px;background:var(--panel2);overflow:hidden;display:flex;margin:8px 0 20px;border:1px solid var(--bd)}
.bar i{display:block;height:100%}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px}
.chip{font-size:11.5px;padding:5px 11px;border-radius:20px;border:1px solid var(--bd);color:var(--mut);cursor:pointer;background:var(--panel);user-select:none;transition:.12s}
.chip:hover{border-color:var(--bd2)}
.chip.on{background:var(--acc);border-color:var(--acc);color:#fff}
.chip .c{font-family:var(--mono);opacity:.8;margin-left:4px}
.owners{font-size:11.5px;color:var(--mut);margin-bottom:18px}
.owners span{margin-right:14px}.owners b{color:var(--txt);font-family:var(--mono)}
.grp{margin:22px 0 8px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px}
.grp .pill{font-size:10px}
.wo{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:11px 13px;margin-bottom:8px;display:grid;grid-template-columns:auto auto 1fr;gap:6px 10px;align-items:baseline}
.wo:hover{border-color:var(--bd2)}
.pill{font-size:10px;font-weight:650;padding:2px 8px;border-radius:5px;white-space:nowrap;font-family:var(--mono)}
.p-DONE{background:rgba(55,185,138,.16);color:var(--done)}.p-BUILT{background:rgba(79,140,247,.16);color:var(--built)}.p-WIP{background:rgba(227,161,58,.18);color:var(--wip)}.p-TODO{background:rgba(138,151,168,.16);color:var(--todo)}.p-BLOCKED{background:rgba(224,98,108,.16);color:var(--blocked)}.p-OPEN{background:rgba(138,151,168,.16);color:var(--todo)}
.wo .id{font-family:var(--mono);font-size:12px;font-weight:600;grid-column:2}
.wo .meta{grid-column:3;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.wo .prio{font-size:10px;font-family:var(--mono);color:var(--mut2);border:1px solid var(--bd);border-radius:4px;padding:1px 5px}
.wo .own{font-size:10.5px;color:var(--acc);font-family:var(--mono)}
.wo .ttl{grid-column:1/-1;font-size:12.5px;color:var(--txt);margin-top:2px}
.wo .acc{grid-column:1/-1;font-size:11px;color:var(--mut);margin-top:3px;border-left:2px solid var(--bd2);padding-left:8px}
.wo .dep{font-size:10px;color:var(--mut2);font-family:var(--mono)}
.foot{color:var(--mut2);font-size:11px;margin-top:24px;border-top:1px solid var(--bd);padding-top:12px;line-height:1.7}
.foot code{font-family:var(--mono);color:var(--mut);background:var(--panel2);padding:1px 5px;border-radius:4px}
</style>
<script>
const ORD=["BLOCKED","WIP","BUILT","TODO","OPEN","DONE"];
const LBL={DONE:"已复验 DONE",BUILT:"待复验 BUILT",WIP:"在建 WIP",TODO:"待做 TODO",OPEN:"待做 OPEN",BLOCKED:"阻塞 BLOCKED"};
const COL={DONE:"var(--done)",BUILT:"var(--built)",WIP:"var(--wip)",TODO:"var(--todo)",OPEN:"var(--todo)",BLOCKED:"var(--blocked)"};
let filter=null;
function e(s){return String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function render(){
 const app=document.getElementById("app");
 const by=DATA.by, tot=DATA.total;
 const segs=ORD.filter(s=>by[s]).map(s=>'<i style="width:'+(100*by[s]/tot)+'%;background:'+COL[s]+'"></i>').join("");
 const tiles=[["总工单",tot,"var(--txt)"],["已复验",by.DONE||0,"var(--done)"],["待复验",by.BUILT||0,"var(--built)"],["在建",by.WIP||0,"var(--wip)"],["待做",(by.TODO||0)+(by.OPEN||0),"var(--todo)"],["阻塞",by.BLOCKED||0,"var(--blocked)"]]
   .map(([l,n,c])=>'<div class="tile"><div class="n" style="color:'+c+'">'+n+'</div><div class="l">'+l+'</div></div>').join("");
 const chips=ORD.filter(s=>by[s]).map(s=>'<span class="chip '+(filter===s?"on":"")+'" data-s="'+s+'">'+LBL[s]+'<span class="c">'+by[s]+'</span></span>').join("");
 const owners=Object.entries(DATA.owners).sort((a,b)=>b[1]-a[1]).map(([o,n])=>'<span>'+e(o)+' <b>'+n+'</b></span>').join("");
 const shown=ORD.filter(s=>by[s]&&(!filter||filter===s));
 let list="";
 for(const s of shown){
   const rows=DATA.rows.filter(r=>r.status===s);
   if(!rows.length)continue;
   list+='<div class="grp"><span class="pill p-'+s+'">'+LBL[s]+'</span><span style="color:var(--mut);font-weight:400;font-size:12px">'+rows.length+' 单</span></div>';
   for(const r of rows){
     const dep=(r.deps&&r.deps.length)?'<span class="dep">deps: '+r.deps.map(e).join(", ")+'</span>':"";
     const own=r.owner?'<span class="own">@'+e(r.owner)+'</span>':'<span class="own" style="color:var(--mut2)">未认领</span>';
     const acc=r.acc?'<div class="acc">'+e(r.acc)+(r.acc.length>=300?"…":"")+'</div>':(r.note?'<div class="acc" style="border-color:var(--bd)">'+e(r.note)+'</div>':"");
     list+='<div class="wo"><span class="pill p-'+s+'">'+s+'</span><span class="id">'+e(r.id)+'</span>'+
       '<span class="meta"><span class="prio">'+e(r.priority)+'</span>'+own+dep+'</span>'+
       '<div class="ttl">'+e(r.title)+'</div>'+acc+'</div>';
   }
 }
 app.innerHTML='<h1>锂电智造决策中台 · 工单看板</h1>'+
   '<div class="sub">快照 @ <b>'+e(DATA.head)+'</b> · 共 '+tot+' 单 · 真实时源 = repo <b>docs/work-queue.json</b>（每次 dev 推送即更新）</div>'+
   '<div class="tiles">'+tiles+'</div><div class="bar">'+segs+'</div>'+
   '<div class="chips">'+chips+'</div>'+
   '<div class="owners">负责人分布：'+owners+'</div>'+
   list+
   '<div class="foot">状态语义：<code>DONE</code> 审核方真复验通过 · <code>BUILT</code> dev 报完成待审核方复验 · <code>WIP</code> 在建 · <code>TODO</code> 待做 · <code>BLOCKED</code> 阻塞（依赖/门红）。<br>本页为快照；PM 代理请直接读仓库 <code>docs/work-queue.json</code> 获实时态。点状态芯片筛选。</div>';
 app.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{filter=filter===c.dataset.s?null:c.dataset.s;render()});
}
render();
</script>`;
fs.writeFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/pm-dashboard.html",html);
console.log("dashboard written, bytes:",html.length);
