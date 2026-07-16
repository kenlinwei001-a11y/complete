import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1050 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}).catch(()=>{}); await sleep(2000);
await page.evaluate(()=>{window.history.pushState({},"","/v/dashboard");window.dispatchEvent(new PopStateEvent("popstate"));}); await sleep(3000);
const dock=page.locator('[data-testid="query-dock-bar"] input, input[aria-label="查询输入"]').first();
const Q="综合评估常州基地的运营韧性，结合设备、物料、订单三方面给出三条改进建议。";
await dock.click().catch(()=>{}); await dock.fill(Q).catch(()=>{}); await dock.press("Enter").catch(()=>{});
const t0=Date.now(); const el=()=>((Date.now()-t0)/1000).toFixed(0);
console.log("T2/T3/T4 整合捕获（280s 窗口·等终答 AnswerCard 切换 + §3③ 收尾层）");
let streamSeen=false, reasonSeen=false, answerSeen=false;
for(let i=0;i<70;i++){
  await sleep(4000);
  const streamN=await page.locator('[data-testid^="task-streaming-"]').count().catch(()=>0);
  const reasonN=await page.locator('[data-testid^="task-reasoning-"]').count().catch(()=>0);
  if(streamN>0 && !streamSeen){streamSeen=true; console.log(`  [t+${el()}s] ✓ 逐字流(task-streaming)`);}
  if(reasonN>0 && !reasonSeen){reasonSeen=true; console.log(`  [t+${el()}s] ✓ 思考折叠(task-reasoning)`);}
  const body=await page.locator("body").innerText().catch(()=>"");
  // 终答到达：streaming 容器消失 + 出现实质答复文本（含"建议/韧性/设备/物料"≥3 关键词）或兜底标记
  const kw=(body.match(/常州|韧性|设备|物料|订单|建议|改进/g)||[]).length;
  const finalMarkers=/未能产出回答|探索推理·未结构化收尾|改进建议|三条建议/.test(body);
  if(streamN===0 && streamSeen && (finalMarkers || kw>=4)){
    answerSeen=true;
    console.log(`  [t+${el()}s] ✓ answer.final → 切 AnswerCard(逐字流隐去)`);
    await page.screenshot({path:`${OUT}/wq1i3c-final.png`,fullPage:true});
    const dead=/未能产出回答/.test(body);
    const floor=/探索推理·未结构化收尾/.test(body);
    console.log(`  §3③ 收尾层: ${dead?"❌死答『未能产出回答』":floor?"◐floor『探索推理·未结构化收尾』(原始推理·T2重述未触发或失败)":"✓T2结构化重述(直接结构化答复·非floor)"}`);
    // 抓终答正文
    const conv=(body.split("查询对话")[1]||body).split("\n").map(s=>s.trim()).filter(s=>s.length>12 && !/规划|平衡|推演|台账|数据接入|建模|场景|驾驶|思考中|正在生成|探索模式/.test(s));
    console.log("  终答正文:", conv.slice(0,5).join(" / ").slice(0,320));
    break;
  }
}
console.log(`\n判据: 逐字流=${streamSeen?"✓":"✗"} · 思考折叠=${reasonSeen?"✓":"✗"} · AnswerCard切换=${answerSeen?"✓":"✗(超窗未converge)"}`);
await browser.close();
