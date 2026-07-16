import fs from "fs";
const p="/home/user/complete/docs/work-queue.json";
const q=JSON.parse(fs.readFileSync(p,"utf8"));
let it=q.items.find(x=>x.id==="WO-THEME-SWITCH-U8");
if(!it){it={at:{}};q.items.push(it);}
Object.assign(it,{
  id:"WO-THEME-SWITCH-U8",title:"轨O历史欠账:主题/配色开关(浅色↔黑曜石·功能本体未建)",
  doc:"docs/COVERAGE-user-requirements-vs-tracking.md",priority:"P3",status:"TODO",owner:"",deps:[],lane:"frontend-polish",
  note:"[历史欠账U8·独立复验agent a1863224真浏览器+全源码扫双证仍缺] 全CSS零data-theme/prefers-color-scheme·tokens.css纯暗色单:root·全tsx零toggle组件·无主题偏好页·localStorage仅auth无主题·theme.ts::applyTheme只后端下发token非用户可切。",
  acceptance:{goal:"用户可切浅色↔黑曜石并持久化·语义域色theme-invariant。",criteria:[
    {id:"C1",type:"真跑",assert:"tokens.css加`[data-theme=light]`浅色token组+header ThemeToggle+localStorage持久化。真浏览器:切浅色→document.documentElement[data-theme=light]·CSS真换色·刷新记住。"},
    {id:"C2",type:"真跑",assert:"收口硬编码十六进制色走token·语义域色(风险红/利好绿等)theme-invariant两主题一致。css-vars门绿。"},
    {id:"C3",type:"gate",assert:"frontend回归绿·additive·暗色为默认(关=现状)。"}],
    discipline:"additive·审核方欠账复验出单·dev建·reviewer复验。"}
});
fs.writeFileSync(p,JSON.stringify(q,null,2)+"\n");
const c={};q.items.forEach(x=>c[x.status]=(c[x.status]||0)+1);
console.log("counts:",JSON.stringify(c));
console.log("WO-THEME-SWITCH-U8:",q.items.find(x=>x.id==="WO-THEME-SWITCH-U8").status+"·P3");
