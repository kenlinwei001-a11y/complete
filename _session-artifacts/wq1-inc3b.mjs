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
console.log("提交·按 testid 精确捕获逐字流/思考中/AnswerCard 切换");
let streamSeen=false, reasonSeen=false, answerSeen=false;
for(let i=0;i<40;i++){
  await sleep(4000);
  const streamN=await page.locator('[data-testid^="task-streaming-"]').count().catch(()=>0);
  const reasonN=await page.locator('[data-testid^="task-reasoning-"]').count().catch(()=>0);
  const answerN=await page.locator('[data-testid^="answer-card"], [class*="answerCard"], [class*="AnswerCard"]').count().catch(()=>0);
  if(streamN>0 && !streamSeen){streamSeen=true; console.log(`  [t+${el()}s] ✓ 逐字流预览出现(task-streaming) — 终答前实时可见`); await page.screenshot({path:`${OUT}/wq1i3b-streaming.png`,fullPage:true});}
  if(reasonN>0 && !reasonSeen){reasonSeen=true; console.log(`  [t+${el()}s] ✓ 「思考中」可折叠出现(task-reasoning·Kimi reasoning_content)`);}
  // answer.final → AnswerCard 换：streaming 消失 + answer 文本出现
  const body=await page.locator("body").innerText().catch(()=>"");
  const hasAnswerText=/已完成|探索推理·未结构化收尾|改进建议|综合评估[\s\S]{30,}|韧性[\s\S]{30,}/.test(body) && (body.match(/常州|韧性|设备|物料/g)||[]).length>=3;
  if(streamN===0 && (answerN>0 || hasAnswerText) && (streamSeen||i>10)){
    answerSeen=true;
    console.log(`  [t+${el()}s] ✓ answer.final 到 → 切 AnswerCard(逐字流隐去)`);
    await page.screenshot({path:`${OUT}/wq1i3b-answercard.png`,fullPage:true});
    const dead=/未能产出回答/.test(body);
    const fallback=/探索推理·未结构化收尾/.test(body);
    console.log(`  §3③: ${dead?"❌仍死答『未能产出回答』":"✓非死答"}${fallback?"·标『探索推理·未结构化收尾』(兜底真分析)":""}`);
    const conv=(body.split("查询对话")[1]||body).split("\n").map(s=>s.trim()).filter(s=>s.length>15);
    console.log("  终答:", conv.slice(0,4).join(" / ").slice(0,260));
    break;
  }
}
console.log(`\n判据: (a)逐字流 task-streaming=${streamSeen?"✓":"✗"} · 思考中折叠 task-reasoning=${reasonSeen?"✓":"✗"} · AnswerCard 切换=${answerSeen?"✓":"?"}`);
await browser.close();
