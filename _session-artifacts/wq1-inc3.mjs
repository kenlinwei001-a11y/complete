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
console.log("提交开放式 Path B 问句(测 a 逐字流 + b §3③ 收敛):", (await dock.count())?"输入框✓":"✗");
await dock.click().catch(()=>{}); await dock.fill(Q).catch(()=>{}); await dock.press("Enter").catch(()=>{});
const t0=Date.now(); const el=()=>((Date.now()-t0)/1000).toFixed(0);
let sawStreaming=false, sawThinking=false, snaps=0;
for(let i=0;i<28;i++){
  await sleep(5000);
  const b=await page.locator("body").innerText().catch(()=>"");
  // 检测逐字流(streamingText 实时预览) + 思考中(reasoningText 折叠)
  const thinking=/思考中|思考·|推理中|reasoning|思考过程/.test(b);
  const streaming=/生成中|流式|实时|预览|▌|逐字/.test(b) || (b.includes("仍在执行")===false && /常州|韧性|设备|物料|订单/.test(b.split("查询对话")[1]||""));
  if(thinking && !sawThinking){sawThinking=true; console.log(`  [t+${el()}s] 出现「思考中」折叠(reasoningText 可见) ✓`); await page.screenshot({path:`${OUT}/wq1i3-thinking.png`,fullPage:true}); snaps++;}
  if(streaming && !sawStreaming){sawStreaming=true; console.log(`  [t+${el()}s] 出现终答逐字流预览(streamingText) ✓`); await page.screenshot({path:`${OUT}/wq1i3-streaming.png`,fullPage:true}); snaps++;}
  // 收敛检测
  const done=/已完成|完成|建议|结论|探索推理|未结构化收尾|未能产出回答/.test(b);
  const deadAnswer=/未能产出回答/.test(b);
  const realConverge=/探索推理·未结构化收尾|韧性|改进建议|设备[\s\S]{0,40}物料|建议/.test(b) && !deadAnswer;
  if(i>=3 && done){
    console.log(`  [t+${el()}s] 收敛: ${deadAnswer?"❌仍死答(未能产出回答)":"✓真分析"}${/探索推理·未结构化收尾/.test(b)?"(标『探索推理·未结构化收尾』·§3③兜底)":""}`);
    await page.screenshot({path:`${OUT}/wq1i3-final.png`,fullPage:true});
    // 抓终答片段
    const conv=(b.split("查询对话")[1]||b).split("\n").map(s=>s.trim()).filter(s=>s.length>8 && !/规划与平衡|推演|台账|数据接入|建模|场景启动|经营驾驶/.test(s));
    console.log("  终答片段:", conv.slice(-6).join(" / ").slice(0,300));
    break;
  }
}
console.log(`\n判据: (a)逐字流渲染=${sawStreaming?"✓":"?"} · 思考中折叠=${sawThinking?"✓":"?"} · (b)§3③ 非死答=见上`);
console.log(`截图: wq1i3-thinking · wq1i3-streaming · wq1i3-final (snaps=${snaps})`);
await browser.close();
