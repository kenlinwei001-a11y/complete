import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant","demo"); await page.fill("#login-username","admin"); await page.fill("#login-password","demo1234");
await page.click('button[type="submit"]'); await page.waitForURL((u)=>!u.pathname.includes("/login"),{timeout:15000}); await sleep(1500);
await page.evaluate(()=>{window.history.pushState({},"","/admin/modeling");window.dispatchEvent(new PopStateEvent("popstate"));});
await sleep(3500);
// 打开 DAG <details>
const dag = page.locator('[data-testid="modeling-pipeline-dag"]');
const dagExists = await dag.count();
try { await dag.locator("summary").click(); await sleep(800); } catch {}
// 数数节点
const dsN = await page.locator('[data-testid^="pp-ds-"]').count();
const procN = await page.locator('[data-testid^="pp-proc-"]').count();
const tyN = await page.locator('[data-testid^="pp-ty-"]').count();
// 列标题
const body1 = (await page.locator("body").textContent())||"";
const hasTitles = ["数据集","数据处理","实体","本体库"].filter(t=>body1.includes(t));
await page.screenshot({ path:`${OUT}/p1-dag.png`, fullPage:true });
console.log("DAG details存在:",dagExists,"| 数据集节点",dsN,"数据处理",procN,"实体",tyN,"| 列标题命中",JSON.stringify(hasTitles));
// 点 数据处理_Order 出真映射
let mappingShown=0, sampleMappings="";
try {
  const proc = page.locator('[data-testid="pp-proc-Order"]');
  if (await proc.count()) { await proc.click(); await sleep(1200); }
  else { await page.locator('[data-testid^="pp-proc-"]').first().click(); await sleep(1200); }
  const body2 = (await page.locator("body").textContent())||"";
  // 映射表行(箭头 → 或 字段名)
  const arrows = (body2.match(/→|->/g)||[]).length;
  // 抓含 . 的字段映射片段
  const mm = [...body2.matchAll(/([a-zA-Z_]+)\s*(→|->)\s*([a-zA-Z_]+)/g)].map(m=>m[0]).slice(0,6);
  mappingShown = arrows; sampleMappings = JSON.stringify(mm);
} catch(e){ console.log("click proc err",String(e).slice(0,80)); }
await page.screenshot({ path:`${OUT}/p1-dag-mapping.png`, fullPage:true });
console.log("点数据处理后: 箭头/映射数",mappingShown,"| 样本",sampleMappings);
await browser.close();
