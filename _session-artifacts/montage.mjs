#!/usr/bin/env node
// Build three-way comparison montages (竞品 | 我的设计 | 实际系统) per screen, via Chromium render.
import fs from "node:fs";
import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const DIR = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const M = `${DIR}/competitor-docx/word/media`;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const b64 = (p) => {
  const ext = p.endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${fs.readFileSync(p).toString("base64")}`;
};

// row: [screen title, competitor img, my mockup img, actual img, verdict line]
const ROWS = [
  ["① 推演沙盘主屏（北极星）", `${M}/image1.jpg`, `${DIR}/sandbox-mockup.png`, `${DIR}/actual-sandbox.png`,
    "竞品=拓扑+健康/信任双雷达+主动AI指挥台；我的设计=三栏齐；实际=空世界(0状态变量/0传导)，只剩小三角雷达+被动输入框"],
  ["② 就绪认证 L0–L4", `${M}/image6.jpg`, `${DIR}/mockup-readiness.png`, `${DIR}/actual-sandbox.png`,
    "竞品=L0-L4 stepper+L4三元组+100/100可进入；我的设计=stepper+三元组；实际=只有'L1已配置/29%/暂不可进入'一行+小三角"],
  ["③ 初始化向导 / 范围预检", `${M}/image7.jpg`, `${DIR}/mockup-init.png`, `${DIR}/actual-sandbox.png`,
    "竞品=3步向导(时间→范围→预检)+世界完整度清单；我的设计=3步向导；实际=无向导(自动init)，右图即实际沙盘无任何向导"],
  ["④ 本体建模工作台", `${M}/image2.jpg`, `${DIR}/mockup-modeling.png`, `${DIR}/actual-modeling.png`,
    "竞品=低代码数据管道节点图(源表→处理→实体/链接)+L0-L4认证+AI;我的设计=节点图;实际=空状态'暂无本体'+两个按钮"],
  ["⑤ 逐对象就绪（对象浏览器）", `${M}/image5.jpg`, `${DIR}/mockup-entity.png`, `${DIR}/actual-objecttypes.png`,
    "竞品=单对象Order就绪75/100+结构/知识/行为分解+行动编辑;我的设计=逐对象就绪;实际=文本表(类型/属性/主键/物化数),无逐对象就绪%"],
];

const cell = (label, color, src) => `
  <div style="flex:1;min-width:0">
    <div style="background:${color};color:#fff;font:600 15px/1.6 sans-serif;padding:6px 12px;border-radius:6px 6px 0 0">${label}</div>
    <div style="background:#0b0e14;padding:8px;border:1px solid #1c2433;border-top:none;border-radius:0 0 6px 6px">
      <img src="${src}" style="width:100%;display:block;border-radius:3px"/>
    </div>
  </div>`;

const rowsHtml = ROWS.map(([title, c, m, a, verdict], i) => `
  <section id="row${i}" style="background:#070a10;padding:18px;border-radius:12px;margin-bottom:22px;border:1px solid #1c2433">
    <h2 style="color:#e8eef7;font:700 22px/1.3 sans-serif;margin:0 0 4px">${title}</h2>
    <p style="color:#9fb0c8;font:400 14px/1.5 sans-serif;margin:0 0 14px">${verdict}</p>
    <div style="display:flex;gap:14px;align-items:flex-start">
      ${cell("竞品 OntoFlow（参考产品）", "#b4232a", b64(c))}
      ${cell("我的设计（PRD / mockup）", "#1d5fb8", b64(m))}
      ${cell("实际系统（当前分支已开发）", "#1f7a44", b64(a))}
    </div>
  </section>`).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#04060a;padding:24px;width:2000px">
${rowsHtml}
</body></html>`;

fs.writeFileSync(`${DIR}/montage.html`, html);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 2048, height: 1200 }, deviceScaleFactor: 1.4 });
await page.setContent(html, { waitUntil: "networkidle" });
for (let i = 0; i < ROWS.length; i++) {
  const el = page.locator(`#row${i}`);
  await el.screenshot({ path: `${DIR}/compare-${i + 1}.png` });
  console.log(`compare-${i + 1}.png  <-  ${ROWS[i][0]}`);
}
await browser.close();
console.log("done");
