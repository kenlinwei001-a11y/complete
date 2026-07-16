import pkg from '/home/user/complete/.claude/worktrees/agent-ae8c049ffe741f721/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5251';
const SS = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const log = (...a) => console.log(...a);

const tickCalls = [];
const sessionCreates = [];
const branchCalls = [];
const compareCalls = [];

const out = { phase0:{}, cap04_n1:{}, cap04_n7:{}, cap05:{} };

async function countTimeline(page){
  return await page.evaluate(() => {
    const tl = document.querySelector('[data-testid="sandbox-timeline"]');
    if(!tl) return -1;
    const strip = tl.querySelector('[data-testid="sim-heat-strip"]');
    if(!strip) return -2;
    return strip.querySelectorAll(':scope > span').length;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args:['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on('response', async (res) => {
    const u = res.url();
    try {
      if (/\/a\/v1\/sim\/sessions$/.test(u) && res.request().method()==='POST') {
        const j = await res.json(); sessionCreates.push(j.id);
      } else if (/\/a\/v1\/sim\/sessions\/[^/]+\/tick$/.test(u) && res.request().method()==='POST') {
        let reqN=null; try{ reqN=JSON.parse(res.request().postData()||'{}').n; }catch{}
        let cur=null; try{ cur=(await res.json()).curTick; }catch{}
        tickCalls.push({ url:u.replace(BASE,''), reqN, curTick:cur, ts:Date.now() });
      } else if (/\/a\/v1\/sim\/sessions\/[^/]+\/branch$/.test(u) && res.request().method()==='POST') {
        let j=null; try{ j=await res.json(); }catch{}
        branchCalls.push(j?.id ?? null);
      } else if (/\/a\/v1\/sim\/compare\?/.test(u)) {
        let j=null; try{ j=await res.json(); }catch{}
        compareCalls.push({ url:u.replace(BASE,''), a:j?.a, b:j?.b });
      }
    } catch {}
  });

  await page.goto(BASE + '/', { waitUntil:'networkidle' });
  await page.fill('#login-tenant','demo');
  await page.fill('#login-username','admin');
  await page.fill('#login-password','demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL(u => !/login/.test(u.toString()), { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(800);

  await page.goto(BASE + '/v/sim-sandbox', { waitUntil:'networkidle' });
  await page.waitForSelector('[data-testid="sandbox-view"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="sandbox-cur-tick"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="sandbox-tick-btn"]');
    return b && !b.disabled;
  }, { timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(500);

  const curTick0 = await page.textContent('[data-testid="sandbox-cur-tick"]');
  const nDefault = await page.inputValue('[data-testid="sandbox-tick-days"]');
  const tl0 = await countTimeline(page);
  const btnLabel0 = await page.textContent('[data-testid="sandbox-tick-btn"]');
  out.phase0 = { curTick: curTick0.trim(), nInputDefault: nDefault, timelineSpans: tl0, tickBtnLabel: btnLabel0.trim(), sessionId: sessionCreates[0] ?? null };
  log('PHASE0', JSON.stringify(out.phase0));
  await page.screenshot({ path: SS + '/shot-0-initial.png' });

  // CAP-04 default N=1
  const tickCallsBefore = tickCalls.length;
  await page.click('[data-testid="sandbox-tick-btn"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="sandbox-cur-tick"]').textContent.trim() === '1', { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(600);
  const curTickN1 = (await page.textContent('[data-testid="sandbox-cur-tick"]')).trim();
  const tlN1 = await countTimeline(page);
  const n1Calls = tickCalls.slice(tickCallsBefore);
  out.cap04_n1 = { curTickAfter: curTickN1, tickCallsMade: n1Calls.length, callCurTicks: n1Calls.map(c=>c.curTick), callReqN: n1Calls.map(c=>c.reqN), timelineSpans: tlN1, timelineDelta: tlN1 - tl0 };
  log('CAP04-N1', JSON.stringify(out.cap04_n1));

  // reload → fresh session
  await page.goto(BASE + '/v/sim-sandbox', { waitUntil:'networkidle' });
  await page.waitForSelector('[data-testid="sandbox-view"]');
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="sandbox-tick-btn"]');
    return b && !b.disabled && document.querySelector('[data-testid="sandbox-cur-tick"]').textContent.trim()==='0';
  }, { timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(500);
  const sessionN7 = sessionCreates[sessionCreates.length-1] ?? null;
  const curTickFresh = (await page.textContent('[data-testid="sandbox-cur-tick"]')).trim();
  const tlFresh = await countTimeline(page);

  // CAP-04 N=7
  await page.fill('[data-testid="sandbox-tick-days"]', '7');
  const nAfterFill = await page.inputValue('[data-testid="sandbox-tick-days"]');
  const btnLabelN7 = (await page.textContent('[data-testid="sandbox-tick-btn"]')).trim();
  const tickCallsBefore7 = tickCalls.length;
  await page.click('[data-testid="sandbox-tick-btn"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="sandbox-cur-tick"]').textContent.trim() === '7', { timeout: 30000 }).catch(()=>{});
  await page.waitForTimeout(800);
  const curTickN7 = (await page.textContent('[data-testid="sandbox-cur-tick"]')).trim();
  const tlN7 = await countTimeline(page);
  const n7Calls = tickCalls.slice(tickCallsBefore7);
  out.cap04_n7 = {
    freshSessionCurTick: curTickFresh, freshTimelineSpans: tlFresh,
    nInputSet: nAfterFill, tickBtnLabel: btnLabelN7,
    curTickAfter: curTickN7, tickCallsMade: n7Calls.length,
    callReqN: n7Calls.map(c=>c.reqN), callCurTicks: n7Calls.map(c=>c.curTick),
    timelineSpans: tlN7, timelineDelta: tlN7 - tlFresh,
    sessionId: sessionN7,
  };
  log('CAP04-N7', JSON.stringify(out.cap04_n7));
  await page.screenshot({ path: SS + '/shot-1-tick7.png' });

  // CAP-05 branch
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForTimeout(300);
  const compareBefore = compareCalls.length;
  await page.click('[data-testid="sandbox-branch-btn"]');
  await page.waitForSelector('[data-testid="sandbox-compare-card"]', { timeout: 20000 }).catch(()=>{});
  await page.waitForSelector('[data-testid="sim-compare-panel"]', { timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(1200);

  const card = await page.$('[data-testid="sandbox-compare-card"]');
  const vp = page.viewportSize();
  let inViewport=null, box=null, docTop=null, scrollY=null, intersects=null;
  if (card) {
    box = await card.boundingBox();
    // manual viewport-intersection (isIntersectingViewport absent in this pw-core build)
    intersects = box ? (box.y + box.height > 0 && box.y < vp.height) : false;
    const m = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sandbox-compare-card"]');
      const r = el.getBoundingClientRect();
      return { rectTop: r.top, scrollY: window.scrollY, docTop: r.top + window.scrollY, innerH: window.innerHeight };
    });
    docTop = m.docTop; scrollY = m.scrollY;
    inViewport = box ? (box.y >= 0 && box.y < vp.height) : false;
  }
  const tableVals = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid^="sim-compare-row-"]')];
    return rows.map(tr => {
      const tick = tr.getAttribute('data-testid').replace('sim-compare-row-','');
      const a = tr.querySelector(`[data-testid="sim-compare-a-${tick}"]`)?.textContent ?? null;
      const b = tr.querySelector(`[data-testid="sim-compare-b-${tick}"]`)?.textContent ?? null;
      const d = tr.querySelector(`[data-testid="sim-compare-diff-${tick}"]`)?.textContent ?? null;
      return { tick, a, b, diff:d };
    });
  });
  const cmp = compareCalls[compareCalls.length-1] ?? null;
  out.cap05 = {
    branchChildId: branchCalls[branchCalls.length-1] ?? null,
    compareEndpointHit: compareCalls.length > compareBefore,
    compareUrl: cmp?.url ?? null,
    aSeriesTicks: cmp?.a?.map(s=>s.tick) ?? null,
    bSeriesTicks: cmp?.b?.map(s=>s.tick) ?? null,
    viewport: vp, cardBoundingBox: box, isIntersectingViewport: intersects,
    inViewportByBox: inViewport, cardDocTop: docTop, pageScrollY: scrollY,
    tableRows: tableVals,
  };
  log('CAP05', JSON.stringify(out.cap05));
  await page.screenshot({ path: SS + '/shot-2-branch-compare.png' });
  await page.screenshot({ path: SS + '/shot-2-branch-full.png', fullPage: true });

  log('\n===RESULT-JSON===');
  log(JSON.stringify(out));
  // also dump raw compare series for oracle cross-check
  log('===COMPARE-RAW===');
  log(JSON.stringify({ session: sessionN7, child: branchCalls[branchCalls.length-1], a: cmp?.a, b: cmp?.b }));
  await browser.close();
})().catch(e => { console.error('SCRIPT-ERR', e); process.exit(1); });
